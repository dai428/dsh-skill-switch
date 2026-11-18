/**
 * Functional test for the plugin's Host half, driven through a fake Cordis
 * context that records what the plugin registers.
 *
 * It exercises the real `apply()` from `../index.js`: the command handler, the
 * board it reports, the OFF twin, and the level-filtered prompt text.
 *
 * Run with the DSH Electron binary in Node mode:
 * ELECTRON_RUN_AS_NODE=1 "<DSH NEXT.exe>" this-file.mjs
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const plugin = await import(pathToFileURL(path.join(HERE, '..', 'index.js')).href)

const BODY = [
  'Rules that always apply.',
  '| Level | What change |',
  '|-------|------------|',
  '| **lite** | keep articles + full sentences |',
  '| **ultra** | bare fragments |',
  '- lite: "Your component re-renders because it allocates."',
  '- ultra: "Inline obj prop, new ref."',
  'Never drop not/never/no.',
].join('\n')

/**
 * A fake context: just enough Cordis surface for `apply()`.
 * @param options - the skills the fake registry reports.
 * @returns the fake context plus the recorded registrations.
 */
function fakeHost(options) {
  const recorded = {
    skills: [],
    sections: [],
    commands: [],
    scopedFibers: [],
    listeners: new Map(),
  }
  const commandRecords = options.commandRecords ?? []
  const agent = {
    id: 'session-test',
    session: { snapshotEvents: () => commandRecords },
    ctx: {
      inject(deps, callback) {
        const scoped = {
          skills: {
            register(skill) {
              recorded.skills.push({ ...skill, scope: 'agent' })
              return () => {}
            },
          },
          systemPrompt: {
            section(section) {
              recorded.sections.push({ ...section, scope: 'agent' })
              return () => {}
            },
          },
        }
        const fiber = { dispose: async () => {}, deps }
        callback(scoped)
        recorded.scopedFibers.push(fiber)
        return fiber
      },
    },
  }
  const ctx = {
    logger: { warn: message => recorded.warnings?.push?.(message) },
    on(name, listener) {
      const list = recorded.listeners.get(name) ?? []
      list.push(listener)
      recorded.listeners.set(name, list)
      return () => {}
    },
    inject(deps, callback) {
      if (deps.includes('commands')) {
        const scoped = {
          commands: {
            register(definition) {
              recorded.commands.push(definition)
              return () => {}
            },
          },
        }
        callback(scoped)
        return { dispose: async () => {} }
      }
      // The web-server branch is irrelevant to this test.
      return { dispose: async () => {} }
    },
    skills: {
      async list() {
        return options.visible
      },
      async get(name) {
        const found = options.visible.find(skill => skill.name === name)
        return found === undefined ? undefined : { ...found, content: BODY }
      },
    },
  }
  return { ctx, recorded, agent, commandRecords }
}

/** One `/skill-switch …` record, the shape `dsh-commands` writes. */
const record = args => ({ type: 'command/run', seq: 1, time: 0, data: { name: plugin.COMMAND_NAME, args } })

async function scenario(name, commandRecords, expectations) {
  const visible = [{
    name: 'caveman',
    description: 'terse talk',
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: 'caveman',
  }]
  const host = fakeHost({ visible, commandRecords })
  host.visible = visible
  plugin.apply(host.ctx, {
    skills: {
      caveman: { title: 'Caveman', levels: ['lite', 'full', 'ultra'], defaultEnabled: false },
    },
  })
  // `agent/created` is the hook the plugin applies state on.
  for (const listener of host.recorded.listeners.get('agent/created') ?? []) {
    await listener({ agent: host.agent })
  }
  const outcome = {
    skills: host.recorded.skills,
    sections: host.recorded.sections,
    commands: host.recorded.commands,
  }
  console.log(`--- ${name}`)
  console.log('  twins :', outcome.skills.map(skill => `${skill.name}:model=${skill.invocation.modelInvocable}`))
  console.log('  sections:', outcome.sections.map(section => `${section.name}=${JSON.stringify(section.text.slice(0, 28))}`))
  expectations(outcome, host)
  return { host, outcome }
}

// 1. Default (never switched): the skill stays available, nothing is injected.
await scenario('default: available on request, nothing standing', [], ({ skills, sections }, host) => {
  assert.equal(skills.length, 0, 'no twin: the skill must stay in the catalog')
  assert.equal(sections.length, 0, 'and no standing ruleset is injected')
  // The catalog entry itself is untouched, which is the point: the user can
  // still invoke the skill when they want it.
  assert.equal(host.visible[0].invocation.modelInvocable, true, 'still model-invocable')
})

// 2. ON at the default level: the ruleset becomes standing.
await scenario('on: standing ruleset at the default level', [record('caveman on')], ({ skills, sections }) => {
  assert.equal(skills.length, 0, 'the catalog is untouched: on is about standing rules')
  assert.equal(sections.length, 1, 'one section carries the standing ruleset')
  assert.equal(sections[0].name, 'caveman', 'under the name the owner uses')
  const text = sections[0].text
  assert.ok(text.startsWith('SKILL "Caveman" ACTIVE'), 'the switch announces itself')
  assert.ok(text.includes('level: full'), 'an "on" switch resolves to a concrete level')
  assert.ok(text.includes('Never drop not/never/no.'), 'the body is the skill’s own text')
})

// 3. A level: the body, trimmed to that level.
await scenario('level ultra: filtered body', [record('caveman ultra')], ({ skills, sections }) => {
  assert.equal(skills.length, 0, 'a level keeps the catalog untouched too')
  assert.equal(sections.length, 1, 'one section carries the level')
  const text = sections[0].text
  assert.ok(text.startsWith('SKILL "Caveman" ACTIVE — level: ultra'), 'the level is announced')
  assert.ok(text.includes('bare fragments'), "this level's table row survives")
  assert.ok(!text.includes('keep articles + full sentences'), "another level's row is dropped")
  assert.ok(text.includes('Inline obj prop, new ref.'), "this level's example survives")
  assert.ok(!text.includes('Your component re-renders'), "another level's example is dropped")
  assert.ok(text.includes('Never drop not/never/no.'), 'a level-independent rule always survives')
})

// 4. OFF returns to request-only.
await scenario('off: back to request-only', [record('caveman on'), record('caveman off')], (outcome) => {
  assert.equal(outcome.skills.length, 0, 'the catalog was never touched')
  assert.equal(outcome.sections.length, 0, 'the standing ruleset is gone, the skill is not')
})

// 5. The registered command reports and rejects bad input.
{
  const host = fakeHost({
    visible: [{
      name: 'caveman',
      description: 'terse talk',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: 'caveman',
    }],
  })
  plugin.apply(host.ctx, { skills: { caveman: { title: 'Caveman', levels: ['lite', 'full', 'ultra'] } } })
  const command = host.recorded.commands.find(item => item.name === plugin.COMMAND_NAME)
  assert.ok(command !== undefined, 'the command is registered')
  console.log('--- command')
  const usage = await command.handler({ rawInput: '', agent: host.agent })
  console.log('  empty input ->', usage.kind, JSON.stringify(usage.text))
  assert.equal(usage.kind, 'error', 'empty input is refused')

  const badLevel = await command.handler({ rawInput: 'caveman turbo', agent: host.agent })
  console.log('  unknown level ->', badLevel.kind, JSON.stringify(badLevel.text))
  assert.equal(badLevel.kind, 'error', 'an undeclared level is refused')

  // The record is appended by dsh-commands BEFORE the handler runs, so the
  // test has to add it the same way.
  host.commandRecords.push(record('caveman lite'))
  const applied = await command.handler({ rawInput: 'caveman lite', agent: host.agent })
  console.log('  caveman lite ->', applied.kind, JSON.stringify(applied.text))
  assert.equal(applied.kind, 'success', 'a valid level is accepted')
  assert.ok(applied.text.includes('(lite)'), 'the settlement names the level')
}

console.log('ALL CHECKS PASSED')
