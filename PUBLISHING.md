# Publishing dsh-skill-switch

Everything that does not need an account is done. Three scripts do the rest; each
one takes a token from the environment and exits without writing anything when
you pass `--dry-run`.

## Why scripts instead of `git push` and a browser

This machine cannot reach the GitHub web host. Measured here:

| host | result |
|---|---|
| `github.com`, `github.com/login` | `connect ETIMEDOUT 20.6.7.17:443` (21 s) |
| `raw.githubusercontent.com` | `read ECONNRESET` (12 s) |
| `api.github.com` | 200 (387 ms) |
| `uploads.github.com` | 302 (619 ms) |
| `objects.githubusercontent.com` | 404 (2.5 s) |
| `registry.npmjs.org` | 404 for `dsh-skill-switch` (name is free) |
| `www.npmjs.com` | 200 |

So logging in through a browser is not possible here — the login page never
loads. The REST API works, and it covers everything a push would do: create the
repo, upload every blob, commit, set topics, cut a release, upload the asset,
fork the registry, open the pull request. No git remote, no `gh`, no browser.

## 0. Done

- Package `dsh-skill-switch` 1.0.0, `engines.dsh: ">=0.2.2-rc.2 <0.3.0"` (a plain
  `>=0.2.0` does **not** match the running `0.2.2-rc.3`).
- `dsh.bundle.patch` + `dsh.client` + `publishConfig.access` + `license` + `files`.
- `dist/dsh-skill-switch-1.0.0.tgz` — 18 files, 37883 bytes, install-verified.
- Five test suites green.
- `assets/icon-180.png` (raster, GitHub-hosted, market-legal).
- Local commit `d1802ea`, 22 tracked files.

## 1. GitHub repository

```powershell
cd 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\skill-switch'
$env:GITHUB_TOKEN = 'ghp_...'          # classic token with `repo`, or fine-grained with Contents + Administration + Releases: read/write

node tools/publish-github.mjs --owner <login> --dry-run   # lists every file, creates nothing
node tools/publish-github.mjs --owner <login>
```

What it does, in order: `GET /user` (fails fast on a bad token) → creates the
public repo if missing → uploads one blob per tracked file → one root commit with
the local commit message → `refs/heads/main` → `default_branch` → topics
(`dsh-plugin`, `dsh`, `deepseek-harness`, `skills`) → release `v1.0.0` → uploads
the tarball as **`dsh-skill-switch.tgz`** (version-free on purpose: `latest/download/`
takes the filename literally, so a versioned asset 404s after the next release).

Re-running is safe: blobs are content-addressed, the commit is appended to
`main`, and an existing release or asset is skipped rather than duplicated.

## 2. npm

```powershell
$env:NPM_TOKEN = 'npm_...'             # automation token with publish rights
node tools/publish-npm.mjs --dry-run
node tools/publish-npm.mjs
```

The token goes into a throwaway `.npmrc` under `%TEMP%` and is handed to npm via
`--userconfig`, so it never lands in your real `.npmrc` and never appears in a
logged command line. Publish to npm and users install prebuilt — no
`allowBuilds` approval, which is the friction the registry docs warn about.

## 3. Tarball — done

`dist/dsh-skill-switch-1.0.0.tgz`, 18 files, 37883 bytes. Verified by removing the
plugin from the profile and reinstalling from the tarball alone:

```
plugin_manager remove_bundle dsh-skill-switch
plugin_manager install_bundle ...\dist\dsh-skill-switch-1.0.0.tgz
# => pnpm: + dsh-skill-switch 1.0.0   (a real package, not a link)
# => slot occupants unchanged: todo 0 / goal 10 / skill-switch 15 / queue 20
```

Anyone can install it without any of the above:

```
dsh plugin add ./dsh-skill-switch-1.0.0.tgz
```

## 4. Market listing

The market does not host entries. `dshmarket` reads
`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`, generated from
`github.com/awesome-dsh-plugin/awesome-dsh-plugin` — one YAML per plugin under
`data/plugins/<owner>__<repo>.yml`, added by pull request.

```powershell
node tools/publish-market.mjs --owner <login> --dry-run
node tools/publish-market.mjs --owner <login>
```

It forks the registry, commits the single YAML on a branch, and opens the PR. It
prints two pre-flight results the CI would otherwise fail on: repository age (the
check needs **1 day**) and whether `dsh.bundle` is declared (the top rejection
reason). If the repo is younger than a day it warns and continues — the CI re-runs
on a fresh snapshot.

### Differentiation from the existing entry

The catalog already lists `@jacksun1994/dsh-skill-switcher` (category `skill`).
Both switch skills, so review will ask what is new. The honest differences:

| | dsh-skill-switcher | dsh-skill-switch (this) |
|---|---|---|
| Writes to disk | rewrites SKILL.md invocation fields | never writes a skill file |
| Scope | host-wide | per Session |
| Effect of "on" | changes who may invoke it | injects the ruleset so every reply follows it |
| Levels | none | filtered body per level (caveman: lite → wenyan-ultra) |
| Persistence | file state | Session log, survives resume/fork |

The submission text leads with the level picker and "no file writes" — that is the
part not covered yet.

## 5. After publishing

- [ ] repo exists, `main` pushed, topics set
- [ ] release `v1.0.0` with `dsh-skill-switch.tgz` attached
- [ ] `npm view dsh-skill-switch version` → `1.0.0`
- [ ] market PR opened
- [ ] replace `OWNER` in `contrib/OWNER__dsh-skill-switch.yml` (the live copy is
      generated by `publish-market.mjs`; the file here is only a template)
- [ ] add `repository` / `bugs` / `homepage` to `package.json`, then bump the
      version and re-pack — publishing metadata then editing it leaves npm and the
      repo disagreeing
