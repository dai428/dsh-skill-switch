// Publishes the plugin to the public npm registry.
//
// Usage:
//   $env:NPM_TOKEN = 'npm_...'
//   node tools/publish-npm.mjs --dry-run
//   node tools/publish-npm.mjs
//   $env:NPM_OTP = '123456'; node tools/publish-npm.mjs
//
// The registry rejects publishes from a token without 2FA bypass unless the
// one-time code rides along, so NPM_OTP is forwarded as npm's --otp flag.
//
// The token is written to a throwaway .npmrc inside the temp directory and
// passed to npm through --userconfig, so nothing lands in the user's real
// .npmrc and the token never appears on a command line that gets logged.

import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const REGISTRY = 'https://registry.npmjs.org/';
const ROOT = path.resolve(import.meta.dirname, '..');
// npm.cmd cannot be spawned without a shell on Windows, so run npm's CLI
// entrypoint with the current node instead of shelling out to the shim.
const NPM_CLI = process.env.NPM_CLI ?? 'C:\\Tools\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const TOKEN = process.env.NPM_TOKEN;
// npm publishes without a 2FA-bypass token need the live code for this request.
const OTP = process.env.NPM_OTP;

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!TOKEN && !DRY) fail('missing NPM_TOKEN (an npm automation token with publish rights)');

console.log(`package:  ${manifest.name}@${manifest.version}`);
console.log(`registry: ${REGISTRY}`);
console.log(`license:  ${manifest.license}`);
console.log(`engines:  node ${manifest.engines.node}, dsh ${manifest.engines.dsh}`);

function run(npmArgs, extraEnv = {}) {
  return execFileSync(process.execPath, [NPM_CLI, ...npmArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extraEnv },
  });
}

const packed = JSON.parse(run(['pack', '--dry-run', '--json', '--registry', REGISTRY]))[0];
console.log(`\n${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} unpacked:`);
for (const file of packed.files) console.log(`  ${String(file.size).padStart(7)}  ${file.path}`);

if (DRY) {
  console.log('\ndry run: nothing was published');
  process.exit(0);
}

// An unpublished name returns 404 - anything else means we would be overwriting.
const probe = await fetch(`${REGISTRY}${manifest.name.replace('/', '%2F')}`).catch((error) => {
  fail(`cannot reach ${REGISTRY}: ${error.message}`);
});
console.log(`\nexisting versions: ${probe.status === 404 ? 'none (name is free)' : probe.status}`);
if (probe.status === 200) {
  const meta = await probe.json();
  if (meta.versions?.[manifest.version]) {
    fail(`${manifest.name}@${manifest.version} is already published - bump the version first`);
  }
  console.log(`will add ${manifest.version} to ${Object.keys(meta.versions ?? {}).length} existing versions`);
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-npmrc-'));
const npmrc = path.join(dir, '.npmrc');
try {
  writeFileSync(npmrc, `registry=${REGISTRY}\n//registry.npmjs.org/:_authToken=${TOKEN}\n`, 'utf8');
  const publishArgs = ['publish', '--userconfig', npmrc, '--registry', REGISTRY];
  if (OTP) publishArgs.push('--otp', OTP);
  const out = run(publishArgs, {
    npm_config_registry: REGISTRY,
  });
  console.log(out.trim());
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const tarball = path.join(ROOT, 'dist', `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`);
const shasum = existsSync(tarball)
  ? createHash('sha1').update(readFileSync(tarball)).digest('hex')
  : 'not packed yet';
console.log(`\nhttps://www.npmjs.com/package/${manifest.name} (tarball sha1 ${shasum})`);
