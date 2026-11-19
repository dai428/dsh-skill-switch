// Opens the listing PR against the curated registry that the DSH market reads.
//
// Usage:
//   $env:GITHUB_TOKEN = 'ghp_...'
//   node tools/publish-market.mjs --owner <login> --dry-run
//   node tools/publish-market.mjs --owner <login>
//
// The market does not host plugin entries itself: dshmarket reads
// https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json, which is generated
// from github.com/awesome-dsh-plugin/awesome-dsh-plugin. One YAML file per
// plugin under data/plugins/<owner>__<repo>.yml, added by pull request.

import https from 'node:https';

const UPSTREAM_OWNER = 'awesome-dsh-plugin';
const UPSTREAM_REPO = 'awesome-dsh-plugin';
const REPO = 'dsh-skill-switch';
const NPM_NAME = '@zhangwansen123/dsh-skill-switch';
const BRANCH = 'add-dsh-skill-switch';

const args = process.argv.slice(2);
const argv = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const DRY = args.includes('--dry-run');
const OWNER = argv('--owner');
const TOKEN = process.env.GITHUB_TOKEN ?? argv('--token');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!OWNER) fail('missing --owner <github login>');
if (!TOKEN && !DRY) fail('missing GITHUB_TOKEN');

function request(method, host, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request({
      method,
      host,
      path: urlPath,
      timeout: 30000,
      headers: {
        'User-Agent': 'dsh-skill-switch-publisher',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
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
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`${urlPath} timed out`)));
    if (payload) req.write(payload);
    req.end();
  });
}

const api = (method, urlPath, body) => request(method, 'api.github.com', urlPath, body);

async function apiChecked(method, urlPath, body, allow = []) {
  const res = await api(method, urlPath, body);
  if (res.status >= 400 && !allow.includes(res.status)) {
    throw new Error(`${method} ${urlPath} -> ${res.status} ${res.json?.message ?? res.text.slice(0, 200)}`);
  }
  return res;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// contributing.md: description.en is the only required prose field, one
// sentence, ends with a period, no marketing. A colon-space forces quoting.
const entry = `url: https://github.com/${OWNER}/${REPO}
name: ${OWNER}/${REPO}
category: skill
description:
  en: 'Switch a skill on for every reply in one session at a chosen level, without changing any SKILL.md file.'
  zh: '在会话里把一个技能按选定挡位常驻开启，让每次回答自动生效，且不改动任何 SKILL.md 文件。'
icon: https://raw.githubusercontent.com/${OWNER}/${REPO}/main/assets/icon-180.png
`;

const filePath = `data/plugins/${OWNER}__${REPO}.yml`;

console.log(`registry: ${UPSTREAM_OWNER}/${UPSTREAM_REPO}`);
console.log(`entry:    ${filePath}`);
console.log(`\n${entry}`);

if (DRY) {
  console.log('dry run: nothing was written');
  process.exit(0);
}

const who = await api('GET', '/user');
if (who.status === 401) fail('token rejected (401 Bad credentials)');
const login = who.json.login;
console.log(`token:    authenticated as ${login}`);

// Guard rails the registry's CI enforces, checked before opening a PR.
const meta = await api('GET', `/repos/${OWNER}/${REPO}`);
if (meta.status === 404) fail(`${OWNER}/${REPO} does not exist yet - run publish-github.mjs first`);
const created = new Date(meta.json.created_at);
const ageHours = (Date.now() - created.getTime()) / 3600000;
console.log(`repo:     created ${created.toISOString()} (${ageHours.toFixed(1)}h ago)`);
if (ageHours < 24) {
  console.log('warning:  the registry CI rejects repositories younger than 1 day;');
  console.log('          the check re-runs on a fresh snapshot, so retry later if it fails');
}
// raw.githubusercontent.com does not answer this machine's TLS stack (ECONNRESET),
// so the manifest is read through the contents API instead.
const manifest = await api('GET', `/repos/${OWNER}/${REPO}/contents/package.json`);
if (manifest.status === 200) {
  const parsed = JSON.parse(Buffer.from(manifest.json.content, 'base64').toString('utf8'));
  console.log(`manifest: dsh.bundle ${parsed.dsh?.bundle ? 'declared' : 'MISSING - this is the top rejection reason'}`);
} else {
  console.log(`manifest: could not read package.json through the contents API (${manifest.status})`);
}

// Fork, branch, commit one file, open the PR.
const upstream = await api('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}`);
if (upstream.status !== 200) fail(`cannot read ${UPSTREAM_OWNER}/${UPSTREAM_REPO} -> ${upstream.status}`);
const base = upstream.json.default_branch;
const baseRef = await api('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/git/ref/heads/${base}`);
if (baseRef.status !== 200) fail(`cannot read ${base} -> ${baseRef.status}`);
const baseSha = baseRef.json.object.sha;

let fork = await api('GET', `/repos/${login}/${UPSTREAM_REPO}`);
if (fork.status === 404) {
  await apiChecked('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`, { default_branch_only: true });
  console.log(`forked to ${login}/${UPSTREAM_REPO}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(3000);
    fork = await api('GET', `/repos/${login}/${UPSTREAM_REPO}`);
    if (fork.status === 200) break;
  }
  if (fork.status !== 200) fail('fork did not appear within 60s');
} else {
  console.log(`fork:     ${login}/${UPSTREAM_REPO} already exists`);
}

const branchRef = await api('GET', `/repos/${login}/${UPSTREAM_REPO}/git/ref/heads/${BRANCH}`);
if (branchRef.status === 404) {
  await apiChecked('POST', `/repos/${login}/${UPSTREAM_REPO}/git/refs`, {
    ref: `refs/heads/${BRANCH}`,
    sha: baseSha,
  });
  console.log(`created branch ${BRANCH} at ${baseSha.slice(0, 7)}`);
} else {
  await apiChecked('PATCH', `/repos/${login}/${UPSTREAM_REPO}/git/refs/heads/${BRANCH}`, {
    sha: baseSha,
    force: true,
  });
  console.log(`reset branch ${BRANCH} to ${baseSha.slice(0, 7)}`);
}

const existing = await api('GET', `/repos/${login}/${UPSTREAM_REPO}/contents/${filePath}?ref=${BRANCH}`);
const put = await apiChecked('PUT', `/repos/${login}/${UPSTREAM_REPO}/contents/${filePath}`, {
  message: `Add ${REPO}`,
  content: Buffer.from(entry, 'utf8').toString('base64'),
  branch: BRANCH,
  ...(existing.status === 200 ? { sha: existing.json.sha } : {}),
});
console.log(`committed ${filePath} (${put.json.commit.sha.slice(0, 7)})`);

const openPrs = await api('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls?state=open&head=${login}:${BRANCH}`);
if (Array.isArray(openPrs.json) && openPrs.json.length > 0) {
  console.log(`pull request already open: ${openPrs.json[0].html_url}`);
  process.exit(0);
}

const pr = await apiChecked('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`, {
  title: `Add ${REPO}`,
  head: `${login}:${BRANCH}`,
  base,
  body: [
    `Adds \`${REPO}\` - per-session switches for agent skills.`,
    '',
    'One switch per skill beside the composer: **on** makes that skill apply to every reply at the level you pick, so you stop naming it each turn; **off** changes nothing and the skill stays callable on request.',
    '',
    'It never writes to `SKILL.md`. State is folded from the session log, so it survives resume and fork.',
    '',
    `- Repository: https://github.com/${OWNER}/${REPO}`,
    '- `package.json` declares `dsh.bundle` (patch in `cordis.patch.yml`) and `dsh.client`',
    `- Category: \`skill\``,
    '',
    'Also on npm as `' + NPM_NAME + '`.',
  ].join('\n'),
});
console.log(`\n${pr.json.html_url}`);
