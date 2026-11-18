/**
 * Skill switches for the composer: per-Session on/off plus an optional level
 * for skills that declare one.
 *
 * The Session log is the only source of truth. A switch is one
 * `/skill-switch <skill> <on|off> [level]` command, and `dsh-commands` already
 * records `command/run` for every resolved line, so this plugin derives its
 * state by folding those records instead of inventing a new event type.
 *
 * Two documented Harness shadowing rules make a switch real without touching
 * the plugin that owns the skill:
 *
 * - `ctx.skills.register()` files into the CALLING context's layer, and a read
 *   merges the scope chain with the nearest layer winning a duplicate name
 *   outright. Registering a disabled twin on `agent.ctx` therefore hides the
 *   global provider from that Session alone.
 * - `ctx.systemPrompt.section()` resolves the same way: a section with the
 *   same name in the Agent's layer replaces the global one. Empty text drops
 *   an always-on ruleset; a chosen level contributes the skill body filtered
 *   to that level.
 *
 * @module dsh-skill-switch
 */

/** Route the browser half reads for the switch board. */
export const LEVEL_ROUTE = '/skill-switch/state'

/** Command name a switch submits; also the log record this plugin folds. */
export const COMMAND_NAME = 'skill-switch'

/** Prompt order shared with the section a level shadows. */
const SECTION_ORDER = 700

/** Kebab-case skill name, the public grammar. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Pseudo-level that restores the owning plugin's own default. */
const DEFAULT_LEVEL = 'default'

/** Level that owns no rules of its own. */
const OFF_LEVEL = 'off'

/**
 * Skills with a first-class level model. A table entry supplies display copy,
 * the accepted level set, the level an "on" switch starts at, and the prompt
 * section to shadow; the body always comes from the skill provider, so an
 * upgraded skill keeps working.
 *
 * `defaultEnabled: false` is the point of the board: a skill stays available on
 * request, and switching it on is what makes it stand on its own without the
 * user having to name it every turn.
 */
const BUILTIN = {
  caveman: {
    title: 'Caveman',
    levels: ['lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra'],
    defaultLevel: 'full',
  },
}

/** Plugin name as it appears in the loader. */
export const name = 'skill-switch'

/** The registry is what this plugin reads and shadows; no other service is required. */
export const inject = ['skills']

/** Prompt section name an entry shadows; the skill name when unset. */
function sectionOf(skill, spec) {
  return typeof spec.section === 'string' && spec.section !== '' ? spec.section : skill
}

/**
 * Read the configured table defensively: the row is user-editable, and one
 * malformed entry must not cost the rest of the board.
 * @param config - the loader row's config.
 * @returns name → normalized entry.
 */
function tableOf(config) {
  const table = {}
  for (const [skill, spec] of Object.entries(BUILTIN)) {
    table[skill] = normalizeEntry(skill, spec)
  }
  const configured = config?.skills
  if (configured === null || typeof configured !== 'object' || Array.isArray(configured)) return table
  for (const [skill, spec] of Object.entries(configured)) {
    if (!SKILL_NAME.test(skill)) continue
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) continue
    const base = table[skill] ?? {}
    table[skill] = normalizeEntry(skill, { ...base, ...spec })
  }
  return table
}

/**
 * Normalize one configured entry.
 * @param skill - the skill name.
 * @param spec - configured or built-in fields.
 * @returns the entry the board and the switch read.
 */
function normalizeEntry(skill, spec) {
  const levels = Array.isArray(spec.levels)
    ? spec.levels.filter(level => typeof level === 'string' && level !== '' && level !== DEFAULT_LEVEL)
    : []
  // An "on" switch must stand for something concrete. A skill with levels
  // defaults to one of them; a skill without levels defaults to its own
  // standing rules, which this plugin does not manage, so "on" is meaningful
  // only as a level choice and its absence means the same as off.
  const fallbackLevel = levels.length === 0 ? null : levels.includes('full') ? 'full' : levels[0]
  return {
    name: skill,
    title: typeof spec.title === 'string' && spec.title !== '' ? spec.title : skill,
    levels,
    section: sectionOf(skill, spec),
    defaultEnabled: spec.defaultEnabled === true,
    defaultLevel: typeof spec.defaultLevel === 'string' && levels.includes(spec.defaultLevel)
      ? spec.defaultLevel
      : fallbackLevel,
  }
}

/**
 * Normalize a level token, mapping `default` to "no override".
 * @param token - one word from the command line.
 * @returns the level, `default`, or undefined when unrecognized.
 */
function normalizeLevel(token) {
  const value = String(token).trim().toLowerCase()
  if (value === DEFAULT_LEVEL) return DEFAULT_LEVEL
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return undefined
  return value
}

/**
 * Parse one command line into a switch patch.
 * @param input - the command's raw input.
 * @returns the target skill and its patch, or undefined for unusable input.
 */
function parseSwitch(input) {
  const parts = String(input ?? '').trim().split(/\s+/).filter(part => part !== '')
  const skill = parts[0]
  if (skill === undefined || !SKILL_NAME.test(skill)) return undefined
  const verb = (parts[1] ?? '').toLowerCase()
  if (verb === '') return undefined
  if (verb === 'on' || verb === 'off') {
    if (parts[2] === undefined) return { skill, patch: { enabled: verb === 'on' } }
    const level = normalizeLevel(parts[2])
    if (level === undefined) return undefined
    return { skill, patch: { enabled: verb === 'on', level } }
  }
  const level = normalizeLevel(verb)
  if (level === undefined) return undefined
  // A bare level implies the switch is on: choosing a level asks for it.
  return { skill, patch: { enabled: true, level } }
}

/**
 * Fold this plugin's command records from one Session log.
 * @param session - the Session whose committed events are read.
 * @returns skill name → { enabled?, level? }, newest record last.
 */
function stateOf(session) {
  const state = {}
  let events
  try {
    events = session.snapshotEvents()
  } catch {
    return state
  }
  for (const event of events) {
    if (event.type !== 'command/run') continue
    if (event.data.name !== COMMAND_NAME) continue
    const parsed = parseSwitch(event.data.args)
    if (parsed === undefined) continue
    state[parsed.skill] = { ...state[parsed.skill], ...parsed.patch }
  }
  return state
}

/**
 * Resolve one skill's effective switch.
 * @param entry - the configured entry.
 * @param state - the folded patch for this skill, when any.
 * @returns whether it is on and the level in force (null = owner default).
 */
function resolveEntry(entry, state) {
  const enabled = state?.enabled ?? entry.defaultEnabled
  const declared = state?.level ?? entry.defaultLevel
  return { enabled, level: declared === DEFAULT_LEVEL ? null : declared ?? null }
}

/**
 * Keep the body lines one level owns, dropping other levels' table rows and
 * worked examples. A line that names no level is an ordinary rule and stays.
 * @param body - skill markdown with frontmatter already removed.
 * @param levels - the accepted levels for this skill.
 * @param level - the level to keep.
 * @returns the filtered body.
 */
function filterBody(body, levels, level) {
  const known = new Set(levels)
  return body
    .split(/\r?\n/)
    .filter((line) => {
      const tableLabel = /^\|\s*\*\*(.+?)\*\*\s*\|/.exec(line)
      if (tableLabel !== null && tableLabel[1] !== undefined) {
        const label = tableLabel[1].trim().toLowerCase()
        if (known.has(label)) return label === level
      }
      const exampleLabel = /^-\s*([^:]+):\s*"/.exec(line)
      if (exampleLabel !== null && exampleLabel[1] !== undefined) {
        const label = exampleLabel[1].trim().toLowerCase()
        if (known.has(label)) return label === level
      }
      return true
    })
    .join('\n')
}

/**
 * Render the prompt text for one active level. Exported because it is the one
 * piece of the plugin a test can check without mounting a Host.
 * @param title - the skill's display name.
 * @param level - the level in force.
 * @param body - the skill body loaded from its provider.
 * @param levels - the accepted levels for this skill.
 * @returns the instruction block.
 */
export function renderLevel(title, level, body, levels) {
  return `SKILL "${title}" ACTIVE — level: ${level}\n\n${filterBody(body, levels, level)}`
}

/**
 * Mount the switch board.
 * @param ctx - the host context.
 * @param config - the row configuration.
 */
export function apply(ctx, config) {
  const table = tableOf(config)
  /** sessionId → { dispose(), errors: string[] } for the live shadow set. */
  const applied = new Map()

  /**
   * Read every skill the Session can see, joined with the table.
   * @param agent - the Session's live Agent.
   * @returns sorted board entries.
   */
  async function board(agent) {
    let visible = []
    if (agent !== undefined) {
      try {
        visible = await ctx.skills.list({ scope: agent })
      } catch (error) {
        visible = []
        void error
      }
    }
    const discovered = new Map(visible.map(skill => [skill.name, skill]))
    const names = new Set([...Object.keys(table), ...discovered.keys()])
    const state = agent === undefined ? {} : stateOf(agent.session)
    const entries = []
    for (const skill of names) {
      const spec = table[skill] ?? normalizeEntry(skill, {})
      const found = discovered.get(skill)
      // A configured skill the Session cannot see is not offered: switching it
      // would promise an effect nothing can deliver.
      if (found === undefined && spec.levels.length === 0) continue
      const resolved = resolveEntry(spec, state[skill])
      entries.push({
        name: spec.name,
        title: spec.title,
        description: found?.description ?? '',
        levels: spec.levels,
        enabled: resolved.enabled,
        level: resolved.level,
        live: found !== undefined,
      })
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Replace one Session's standing registrations from its current log state.
   *
   * "On" means the skill stands on its own: this plugin injects its ruleset as
   * a same-named prompt section, so the user never has to name the skill again.
   * "Off" means the skill is NOT taken away — it stays in the catalog and
   * remains loadable on request. That is the whole point of the switch, so an
   * off switch registers nothing at all.
   *
   * The registrations are made on a child fiber of the Agent's own context, so
   * they land in that Session's layer and disappear with the Agent; this
   * function additionally disposes them on a state change.
   * @param agent - the live Agent whose scope owns the registrations.
   * @returns the problems met while applying, for the board to report.
   */
  async function refresh(agent) {
    const sessionId = agent.id
    const previous = applied.get(sessionId)
    applied.delete(sessionId)
    if (previous !== undefined) await previous.dispose()

    const entries = await board(agent)
    const errors = []
    // Bodies are read before anything is registered, so a level change reads
    // the provider's own body rather than a shadow this plugin just installed.
    const bodies = new Map()
    for (const entry of entries) {
      if (!entry.enabled || entry.level === null) continue
      try {
        const definition = await ctx.skills.get(entry.name, { scope: agent })
        if (definition !== undefined) bodies.set(entry.name, definition.content)
      } catch (error) {
        errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // `agent.ctx` carries no inject of its own, so services are reached
    // through an explicit injection instead of a bare property read. The fiber
    // is a child of the Agent's context, so its registrations land in that
    // Session's layer and disappear with the Agent.
    const fiber = agent.ctx.inject(['skills', 'systemPrompt'], (scope) => {
      for (const entry of entries) {
        // An off switch changes nothing about the skill: it stays visible and
        // loadable on request, which is why it registers nothing.
        if (!entry.enabled) continue
        const spec = table[entry.name] ?? normalizeEntry(entry.name, {})
        const hasLevels = entry.levels.length > 0
        try {
          if (!hasLevels) {
            // No level model: "on" can only mean the skill's own standing
            // rules, which this plugin does not own. Nothing to register.
            continue
          }
          if (entry.level === null || entry.level === OFF_LEVEL) continue
          const body = bodies.get(entry.name)
          if (body === undefined) continue
          scope.systemPrompt.section({
            name: spec.section,
            order: SECTION_ORDER,
            text: renderLevel(entry.title, entry.level, body, entry.levels),
          })
        } catch (error) {
          errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })

    applied.set(sessionId, {
      errors,
      dispose: async () => {
        try {
          await fiber.dispose()
        } catch {
          // The Agent's own teardown may already have unwound the scope.
        }
      },
    })
    return errors
  }

  // A restored or freshly created Agent re-applies the switches it had.
  ctx.on('agent/created', async ({ agent }) => {
    try {
      const errors = await refresh(agent)
      for (const problem of errors) ctx.logger?.warn?.(`skill-switch: ${problem}`)
    } catch (error) {
      ctx.logger?.warn?.(`skill-switch: cannot apply state: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const live = applied.get(agent.id)
    applied.delete(agent.id)
    void live?.dispose()
  })

  ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      name: COMMAND_NAME,
      description: 'Turn a skill on or off for this Session, optionally at a level.',
      input: { hint: '<skill> <on|off> [level]' },
      handler: async (invocation) => {
        const parsed = parseSwitch(invocation.rawInput)
        if (parsed === undefined) {
          return {
            kind: 'error',
            text: `Usage: /${COMMAND_NAME} <skill> <on|off> [level], or /${COMMAND_NAME} <skill> <level>`,
          }
        }
        const entry = table[parsed.skill]
        const level = parsed.patch.level
        if (entry !== undefined && level !== undefined && level !== DEFAULT_LEVEL
          && level !== OFF_LEVEL && !entry.levels.includes(level)) {
          return {
            kind: 'error',
            text: `"${parsed.skill}" accepts ${entry.levels.join(', ') || 'no level'}; got "${level}"`,
          }
        }
        // The registry already appended this invocation's `command/run`, so the
        // rebuild reads the state it just wrote.
        const errors = await refresh(invocation.agent)
        const current = (await board(invocation.agent)).find(item => item.name === parsed.skill)
        const status = current === undefined
          ? parsed.skill
          : `${current.title}: ${current.enabled ? 'on' : 'off'}${current.level === null ? '' : ` (${current.level})`}`
        return errors.length === 0
          ? { kind: 'success', text: status }
          : { kind: 'error', text: `${status} — ${errors.join('; ')}` }
      },
    })
  })

  ctx.inject(['webServer', 'connection', 'agents'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: LEVEL_ROUTE,
      handler: (req, res) => {
        const rejection = scope.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.statusCode = rejection
          res.end()
          return
        }
        if (req.method !== undefined && req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }
        const url = new URL(req.url ?? LEVEL_ROUTE, 'http://localhost')
        const sessionId = url.searchParams.get('sessionId')
        const agent = sessionId === null ? undefined : scope.agents.get(sessionId)
        void board(agent).then((entries) => {
          const errors = agent === undefined ? [] : applied.get(agent.id)?.errors ?? []
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ skills: entries, errors }))
        }).catch((error) => {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        })
      },
    }), `skill-switch: GET ${LEVEL_ROUTE}`)
  })
}
