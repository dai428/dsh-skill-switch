# Publishing @zhangwansen123/dsh-skill-switch

Status: **published on all four channels.** This file records what it took, so a
later version can repeat it.

## Why scripts instead of `git push` and a browser

This machine originally could not reach the GitHub web host. Measured before the
proxy was switched on:

| host | result |
|---|---|
| `github.com`, `github.com/login` | `connect ETIMEDOUT 20.6.7.17:443` (21 s) |
| `raw.githubusercontent.com` | `read ECONNRESET` (12 s) |
| `api.github.com` | 200 (387 ms) |
| `uploads.github.com` | 302 (619 ms) |
| `registry.npmjs.org` | 200 |

With clash-verge running (`127.0.0.1:7897`) the web host answers, but the scripts
still talk straight to `api.github.com` **without** a proxy: tunneling CONNECT
through 7897 dies with `socket disconnected before secure TLS connection was
established`, while a direct connection works. Do not set `HTTPS_PROXY` for them.

## Channels

| channel | address |
|---|---|
| GitHub | https://github.com/dai428/dsh-skill-switch |
| Release | `v1.0.1` → asset `dsh-skill-switch.tgz` (version-free on purpose) |
| npm | `@zhangwansen123/dsh-skill-switch` |
| Market PR | https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16753 |

Install any of these ways:

```sh
dsh plugin add @zhangwansen123/dsh-skill-switch
dsh plugin add https://github.com/dai428/dsh-skill-switch/releases/latest/download/dsh-skill-switch.tgz
dsh plugin add ./zhangwansen123-dsh-skill-switch-1.0.1.tgz
```

## The rename, and why the names differ

npm rejected the plain name:

```
403 Package name too similar to existing package dsh-skillswitch;
try renaming your package to '@zhangwansen123/dsh-skill-switch'
```

So the npm name is scoped while the GitHub repository keeps `dsh-skill-switch`.
The client module id follows the package name (`@zhangwansen123/dsh-skill-switch`),
which matches how `@maci0/dsh-caveman` registers its client.

## Scripts

Each takes a token from the environment, and `--dry-run` writes nothing.

```powershell
cd 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\skill-switch'

$env:GITHUB_TOKEN = 'ghp_...'      # classic token, scope `repo`
$env:NPM_TOKEN    = 'npm_...'      # classic *Automation* token (must bypass 2FA)

node tools/publish-github.mjs --owner dai428 --dry-run
node tools/publish-github.mjs --owner dai428

node tools/publish-npm.mjs --dry-run
node tools/publish-npm.mjs

node tools/publish-market.mjs --owner dai428 --dry-run
node tools/publish-market.mjs --owner dai428
```

Newer npm granular tokens are refused with `Two-factor authentication or granular
access token with bypass 2fa enabled is required`; only a classic Automation token
goes through. The token is written to a throwaway `.npmrc` under `%TEMP%` and
handed to npm via `--userconfig`, so it never touches the real `.npmrc`.

## Gotchas that cost time

- **A repository with no commits has no git objects.** `POST /git/blobs` answers
  `409 Git Repository is empty`, and the ref lookup answers **409, not 404**, so
  the emptiness test must accept both. `publish-github.mjs` seeds the repo through
  `PUT /contents/LICENSE` first.
- `PUT /contents/{path}` wants the payload nested: `body: { message, content }`.
  Passing the object directly gives `400 Body should be a JSON object`.
- **An empty repo also breaks `PUT /contents`** unless the parent commit exists;
  the seed commit is then reused as the parent of the real tree.
- **raw.githubusercontent.com does not answer node's TLS stack here** even when
  the browser fetches the same URL fine (200, verified in-page). So verification
  reads `package.json` through the contents API, not raw.
- `npm publish` answered **202**, not 201, and the package document stayed 404 for
  about five minutes while the search index already listed it. It resolved on its
  own — do not re-publish on 202, poll instead.
- `node.exe` here is v22; the DSH runtime is v24. Tests must run under
  `ELECTRON_RUN_AS_NODE=1 "$env:DSH_NODE_EXECUTABLE"`.
- `npm.cmd` cannot be spawned without a shell on Windows (`EINVAL`); call
  `npm-cli.js` with the current node instead.
- `npm pack` must run with the plugin directory as the working directory,
  otherwise npm walks up and reports `ENOENT ... default-workspace\package.json`.

## Pre-flight the registry CI checks

The market's CI, in order: entry count → `dsh.bundle` declared → **repository at
least 1 day old** → `awesome-lint` and the site build. `publish-market.mjs` prints
the age and the `dsh.bundle` result before opening the PR. The listing YAML lives
at `data/plugins/dai428__dsh-skill-switch.yml`; `contrib/` holds the same file as
a reference copy.

## Differentiation from the existing entry

The catalog already lists `@jacksun1994/dsh-skill-switcher` (category `skill`).
Both switch skills, so review will ask what is new:

| | dsh-skill-switcher | dsh-skill-switch (this) |
|---|---|---|
| Writes to disk | rewrites SKILL.md invocation fields | never writes a skill file |
| Scope | host-wide | per Session |
| Effect of "on" | changes who may invoke it | injects the ruleset so every reply follows it |
| Levels | none | filtered body per level (caveman: lite → wenyan-ultra) |
| Persistence | file state | Session log, survives resume/fork |

## Releasing 1.0.2 and later

1. Bump `version` in `package.json` (the scripts read it; nothing else hardcodes it).
2. `node 'C:\Tools\nodejs\node_modules\npm\bin\npm-cli.js' pack --pack-destination dist`
3. Run the five tests under the Harness runtime.
4. `publish-npm.mjs`, then `publish-github.mjs` (it replaces the release asset in
   place and rewrites the notes when the install line moves).
5. Poll `https://registry.npmjs.org/@zhangwansen123%2Fdsh-skill-switch` until
   `dist-tags.latest` is the new version.
6. Bump the `version` inside the market entry only if the URL layout changes; the
   listing points at the repository, not at a version.

## After publishing

- [x] repo exists, `main` pushed, topics set
- [x] release with a version-free `dsh-skill-switch.tgz`
- [x] `@zhangwansen123/dsh-skill-switch` on npm
- [x] market PR opened
- [ ] market PR reviewed and merged (external; the entry appears within a day of merge)
