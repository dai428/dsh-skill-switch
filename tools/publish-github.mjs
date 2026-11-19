// Publishes the plugin to GitHub with nothing but a token: no `git push`, no
// browser. `github.com` (the web host) is unreachable from this machine, while
// `api.github.com`, `uploads.github.com` and `objects.githubusercontent.com`
// all answer, so the REST API is the only channel that works here.
//
// Usage:
//   $env:GITHUB_TOKEN = 'ghp_...'
//   node tools/publish-github.mjs --owner <login> --dry-run
//   node tools/publish-github.mjs --owner <login>
//
// --dry-run reads every file, checks the token and lists what it would send,
// without creating anything.

import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import https from 'node:https';
import path from 'node:path';

const REPO = 'dsh-skill-switch';
// npm's packaged filename drops the @scope/ and joins with a dash.
const NPM_NAME = '@zhangwansen123/dsh-skill-switch';
const TARBALL = `dist/${NPM_NAME.replace(/^@/, '').replace('/', '-')}-1.0.0.tgz`;
const RELEASE_ASSET = 'dsh-skill-switch.tgz';
const TOPICS = ['dsh-plugin', 'dsh', 'deepseek-harness', 'skills'];

const args = process.argv.slice(2);
const argv = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const DRY = args.includes('--dry-run');
const OWNER = argv('--owner');
const TOKEN = process.env.GITHUB_TOKEN ?? argv('--token');

if (!OWNER) fail('missing --owner <github login>');
if (!TOKEN && !DRY) fail('missing GITHUB_TOKEN (a fine-grained or classic token with repo scope)');

const ROOT = path.resolve(import.meta.dirname, '..');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function request(method, host, urlPath, { body = null, token = TOKEN, raw = false, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : raw ? body : Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request({
      method,
      host,
      path: urlPath,
      timeout: 30000,
      headers: {
        'User-Agent': 'dsh-skill-switch-publisher',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': raw ? 'application/gzip' : 'application/json' } : {}),
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`${host}${urlPath} timed out`)));
    if (payload) req.write(payload);
    req.end();
  });
}

const api = (method, urlPath, options) => request(method, 'api.github.com', urlPath, options);

async function apiChecked(method, urlPath, options, allow = []) {
  const res = await api(method, urlPath, options);
  if (res.status >= 400 && !allow.includes(res.status)) {
    const detail = res.json?.message ?? res.text.slice(0, 200);
    throw new Error(`${method} ${urlPath} -> ${res.status} ${detail}`);
  }
  return res;
}

// Files come from git's index so the repo and the commit cannot drift apart.
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function localTarball() {
  const abs = path.join(ROOT, TARBALL);
  try {
    statSync(abs);
  } catch {
    fail(`${TARBALL} is missing - run \`npm pack --pack-destination dist\` first`);
  }
  return abs;
}

function describe(file, buffer) {
  return {
    file,
    size: buffer.length,
    sha: createHash('sha256').update(buffer).digest('hex').slice(0, 12),
  };
}

async function main() {
  const files = trackedFiles();
  if (files.length === 0) fail('git tracks no files - run `git add -A` first');

  const blobs = files.map((file) => describe(file, readFileSync(path.join(ROOT, file))));
  const tarball = localTarball();

  console.log(`owner:   ${OWNER}`);
  console.log(`repo:    ${OWNER}/${REPO}`);
  console.log(`commit:  ${files.length} tracked files`);
  for (const blob of blobs) console.log(`  ${String(blob.size).padStart(7)}  ${blob.sha}  ${blob.file}`);
  console.log(`asset:   ${path.relative(ROOT, tarball)} (${statSync(tarball).size} bytes -> ${RELEASE_ASSET})`);

  const who = await api('GET', '/user');
  if (who.status === 401) fail('token rejected (401 Bad credentials)');
  if (who.status >= 400) fail(`GET /user -> ${who.status}`);
  console.log(`token:   authenticated as ${who.json.login}`);

  const existing = await api('GET', `/repos/${OWNER}/${REPO}`);
  const repoExists = existing.status === 200;
  console.log(`repo:    ${repoExists ? 'already exists' : 'will be created'}`);
  if (!repoExists && existing.status !== 404) {
    fail(`GET /repos/${OWNER}/${REPO} -> ${existing.status}`);
  }

  if (DRY) {
    console.log('\ndry run: nothing was written');
    return;
  }

  if (!repoExists) {
    await apiChecked('POST', '/user/repos', {
      body: {
        name: REPO,
        description: 'Per-session switches for DSH skills: turn one on once and its rules apply to every reply at the level you picked, without naming it again.',
        homepage: `https://github.com/${OWNER}/${REPO}`,
        private: false,
        has_issues: true,
        has_wiki: false,
        auto_init: false,
      },
    });
    console.log('created the repository');
  }

  // A repo with no commits has no git objects to hang a tree on: the blobs API
  // answers 409 "Git Repository is empty", and so does the ref lookup - not 404,
  // which is why the emptiness test has to accept both.
  const refProbe = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/main`);
  const empty = refProbe.status === 404 || refProbe.status === 409;
  if (empty) {
    const seed = blobs.find((blob) => blob.file === 'LICENSE') ?? blobs[0];
    await apiChecked('PUT', `/repos/${OWNER}/${REPO}/contents/${seed.file}`, {
      body: {
        message: 'Initial commit',
        content: readFileSync(path.join(ROOT, seed.file)).toString('base64'),
      },
    });
    console.log(`seeded the empty repository with ${seed.file}`);
  }

  // One commit for the whole tree: blob per file, then a single root commit.
  const tree = [];
  for (const blob of blobs) {
    const created = await apiChecked('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      body: { content: readFileSync(path.join(ROOT, blob.file)).toString('base64'), encoding: 'base64' },
    });
    tree.push({ path: blob.file, mode: '100644', type: 'blob', sha: created.json.sha });
  }
  console.log(`uploaded ${tree.length} blobs`);

  const newTree = await apiChecked('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
    body: { tree },
  });

  // Reuse the local commit message so the remote history reads the same.
  const message = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: ROOT, encoding: 'utf8' }).trim();
  // The seed commit from the contents API is the parent, so the tree replaces it
  // rather than dropping it from history.
  const parents = [];
  const branch = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/main`);
  if (branch.status === 200) parents.push(branch.json.object.sha);

  const commit = await apiChecked('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    body: { message, tree: newTree.json.sha, parents },
  });

  if (parents.length === 0) {
    await apiChecked('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      body: { ref: 'refs/heads/main', sha: commit.json.sha },
    });
  } else {
    await apiChecked('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/main`, {
      body: { sha: commit.json.sha, force: false },
    });
  }
  console.log(`pushed commit ${commit.json.sha.slice(0, 7)} to main`);

  // The default branch is only settable once a branch exists.
  await api('PATCH', `/repos/${OWNER}/${REPO}`, { body: { default_branch: 'main' } });
  await api('PUT', `/repos/${OWNER}/${REPO}/topics`, { body: { names: TOPICS } });
  console.log(`topics: ${TOPICS.join(', ')}`);

  // A release-hosted tarball is the install path that needs no build permission.
  const releaseBody = [
    'Turn a skill on for every reply in one session, at the level you pick.',
    '',
    'Install either way:',
    '',
    '```',
    `dsh plugin add ${NPM_NAME}`,
    'dsh plugin add https://github.com/' + OWNER + '/' + REPO + '/releases/latest/download/' + RELEASE_ASSET,
    '```',
  ].join('\n');
  let release = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/v1.0.0`);
  if (release.status === 404) {
    release = await apiChecked('POST', `/repos/${OWNER}/${REPO}/releases`, {
      body: {
        tag_name: 'v1.0.0',
        name: '@zhangwansen123/dsh-skill-switch 1.0.0',
        body: releaseBody,
      },
    });
    console.log('created release v1.0.0');
  } else {
    // The install line names the package, so a renamed package has to rewrite the
    // notes even though the tag and asset stay put.
    if (release.json.body !== releaseBody) {
      await apiChecked('PATCH', `/repos/${OWNER}/${REPO}/releases/${release.json.id}`, {
        body: { name: '@zhangwansen123/dsh-skill-switch 1.0.0', body: releaseBody },
      });
      console.log('updated release v1.0.0 notes');
    } else {
      console.log('release v1.0.0 already exists');
    }
  }

  const assets = await api('GET', `/repos/${OWNER}/${REPO}/releases/${release.json.id}/assets`);
  const published = Array.isArray(assets.json) ? assets.json : [];
  const previous = published.find((asset) => asset.name === RELEASE_ASSET);
  const wanted = statSync(tarball).size;
  if (previous && previous.size === wanted) {
    console.log(`asset ${RELEASE_ASSET} already uploaded (${wanted} bytes)`);
  } else {
    // The name is fixed for `latest/download/`, so a rebuilt tarball replaces the
    // old bytes instead of piling up a second asset with the same name.
    if (previous) {
      await apiChecked('DELETE', `/repos/${OWNER}/${REPO}/releases/assets/${previous.id}`);
      console.log(`removed stale ${RELEASE_ASSET} (${previous.size} bytes)`);
    }
    const upload = await request(
      'POST',
      'uploads.github.com',
      `/repos/${OWNER}/${REPO}/releases/${release.json.id}/assets?name=${RELEASE_ASSET}`,
      { body: readFileSync(tarball), raw: true, headers: { 'Content-Type': 'application/gzip' } },
    );
    if (upload.status >= 400) fail(`asset upload -> ${upload.status} ${upload.text.slice(0, 200)}`);
    console.log(`uploaded ${RELEASE_ASSET} (${wanted} bytes)`);
  }

  console.log(`\nhttps://github.com/${OWNER}/${REPO}`);
}

await main();
