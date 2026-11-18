# dsh-skill-switch

Per-session switches for DSH skills, beside the permission control in the composer.

The button reads **技能** (**Skills**) and appears only while a Session is open. Turn a skill on and its rules apply to every reply at the level you picked — you stop having to say "caveman mode" or "be brief" every turn. Turn it off and nothing is taken away: the skill stays in the catalog and still works whenever you or the model asks for it.

| | |
|---|---|
| **Where** | Composer tool row, right after the permission control. The board opens above the composer card, between the goal bar and the queue strip. |
| **On** | The skill's rules apply to every reply without you naming it again. |
| **Off** | Request-only. The skill stays in the catalog and still answers `/skill-name`. |
| **Scope** | One Session. Each Session keeps its own switches. |
| **Persistence** | The Session log: every switch is a `/skill-switch` command record, so it survives resume and fork. |
| **Adding skills** | Automatic. The board reads the Session skill catalog, so any installed skill appears without a plugin change. |

## Install

```sh
# from npm
dsh plugin add dsh-skill-switch

# from a tarball
dsh plugin add ./dsh-skill-switch-1.0.0.tgz

# from a checkout
dsh plugin add ./skill-switch
```

Or install it from the plugin market. No build step: the package ships its own sources and has no runtime dependencies.

Requires DSH `>=0.2.2-rc.2 <0.3.0`.

## The two states

The switch answers one question: **does this skill stand on its own?**

- **Off (the default).** The skill is available but passive. It appears in the skill catalog and in `/` suggestions, the model can load it, and you can invoke it with `/skill-name`. Nothing changes about how it worked before this plugin existed.
- **On.** The same skill additionally injects its ruleset into every request as a standing prompt section, at the level you picked.

Turning it back off removes only that standing section. The skill is never hidden or uninstalled.

## Levels

A skill that declares levels offers them while it is on. **默认** clears your pick and uses the skill's own default. The level decides which part of the skill's body becomes standing text: other levels' intensity rows and worked examples are dropped, and every level-independent rule stays.

The body always comes from the skill provider, never from a copy in this plugin, so upgrading the skill upgrades what the switch applies.

A skill with no level model still gets an on/off switch when this plugin's configuration names it; without levels its row reports **无挡位** and stays request-only.

## What you see

- The trigger summarizes the standing set: `技能 · ultra` for one levelled skill, `技能 · 常驻 2` for several.
- Each row shows its state (`按需`, `常驻`, or the active level) beside the switch.
- **正在应用…** while a switch is crossing the wire. Only that skill's controls are marked busy, so one switch never disables the rest of the board or drops keyboard focus.
- A refusal from the Host, in the Host's own words.
- Escape and a press outside the board both close it; opening it moves focus into it.

## Adding a skill

Rows come from the Session catalog, so a newly installed skill provider shows up without editing this plugin. A skill gets levels when this plugin's configuration names them:

```yaml
- id: skill-switch
  name: 'dsh-skill-switch'
  config:
    skills:
      caveman:
        title: Caveman
        levels: [lite, full, ultra, wenyan-lite, wenyan-full, wenyan-ultra]
        defaultEnabled: false
        defaultLevel: full
```

- `defaultEnabled: false` — every new Session starts request-only. Set it to `true` to have the skill standing from the first turn.
- `defaultLevel` — the level an "on" switch starts at; it falls back to `full` when the set has one, else to the first level.
- `section` — the prompt section a level shadows, when it differs from the skill name.

A skill with no configuration entry still appears on the board and can be switched; it simply has no levels to offer.

## Using it without the board

The board is a view over one command, so the same switches work from the composer:

```
/skill-switch caveman on
/skill-switch caveman ultra
/skill-switch caveman off
```

## How it is built

The Session log stays the only source of truth. Each switch is a `/skill-switch <skill> <on|off> [level]` command, so the existing `command/run` record carries it and resuming a Session restores the same board.

"On" is implemented with two documented Harness mechanisms instead of patching the owning plugin:

- `ctx.systemPrompt.section()` registers a section under the same name the skill's own ruleset uses. The Agent's scope layer wins that name, so the section replaces the owner's for this Session only: the level-filtered body while on, and nothing at all while off (this plugin registers nothing when off, which is why the skill stays untouched).
- `ctx.skills.get()` reads the body through the registry, so the text is always the installed skill's current content.

Registrations live on a child fiber of the Agent's context, so they are disposed both when the switch changes and when the Agent goes away.

The board reads its data from `GET /skill-switch/state?sessionId=…`, which uses the same connection-level rejection check as the rest of the Host. Nothing leaves the machine.

## Verification

Five runnable checks ship under `test/`. Each runs under the installed Harness runtime:

```
ELECTRON_RUN_AS_NODE=1 "<DSH NEXT.exe>" test/real-catalog.mjs
```

They read `DSH_INSTALL_DIR` from the environment, so run them from a shell DSH started (or set it to your DSH install directory). `real-catalog.mjs` also needs the `caveman` skill present in `~/.dsh/skills`.

- `real-catalog.mjs` mounts the shipped filesystem provider over the real `~/.dsh/skills` and proves the standing ruleset against the actual `caveman` file.
- `shadow.mjs` proves the two shadowing rules on the real `dsh-skill` and `dsh-system-prompt` services, including that a switch is fully reversible.
- `apply.mjs` drives this plugin's `apply()` through a fake Host: request-only default, standing on, level filtering, back to request-only, and command rejections.
- `route.mjs` calls the registered HTTP handler: live Session, unknown Session, wrong method, and a rejected peer.
- `client.mjs` renders the browser half: the trigger summary, the board, submitted command lines, the pending rule, Escape dismissal, and the Session-change guard.

`route.mjs` and `client.mjs` prove behaviour, not appearance. Looking at the running page is still the authority for layout, contrast, and narrow widths.

## Limits

- The board only offers skills the Session catalog reports.
- The board is Session-scoped by design; there is no global switch. Change `defaultEnabled` for that.
- Off means request-only. A skill that supplies something other than a same-named prompt section keeps whatever it does on its own.
- Only skills listed in the configuration get levels.

## License

MIT
