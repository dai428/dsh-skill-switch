/**
 * Standalone harness for the two shadowing rules the plugin depends on.
 *
 * It mounts the real `dsh-skill` and `dsh-system-prompt` services on a Cordis
 * root, registers a global `caveman` skill plus a global `caveman` prompt
 * section (the shape the real caveman plugin has), then uses the plugin's own
 * scoped-registration path to prove:
 *
 *   1. a twin registered on an Agent-scoped context hides that skill there and
 *      only there;
 *   2. a same-named scoped section replaces the global one, and empty text
 *      removes the ruleset;
 *   3. replacing or disposing the set is legal and restores the owner's view.
 *
 * Run with the DSH Electron binary in Node mode so the ASAR package tree
 * resolves: ELECTRON_RUN_AS_NODE=1 "<DSH NEXT.exe>" this-file.mjs
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.join(process.env.DSH_INSTALL_DIR, 'node_modules', '@deepseek-ai')
const load = spec => import(pathToFileURL(path.join(ROOT, spec, 'lib', 'index.js')).href)

const BODY = [
  'CAVEMAN BODY',
  '| Level | What change |',
  '|-------|------------|',
  '| **lite** | keep articles |',
  '| **ultra** | bare fragments |',
  '- lite: "Your component re-renders because it allocates."',
  '- ultra: "Inline obj prop, new ref."',
  'Never drop not/never/no.',
].join('\n')

const GLOBAL_TEXT = `CAVEMAN MODE ACTIVE - level: full\n\n${BODY}`
const LEVEL_TEXT = 'SKILL "Caveman" ACTIVE - level: ultra\n\nultra body'

/** Wait one macrotask so a just-started fiber can activate. */
const settle = () => new Promise(resolve => setTimeout(resolve, 30))

async function main() {
  const { Context } = await import(pathToFileURL(path.join(ROOT, 'cordis', 'lib', 'index.js')).href)
  const scope = await load('dsh-scope')
  const skill = await load('dsh-skill')
  const prompt = await load('dsh-system-prompt')

  const ctx = new Context()
  const skillRegistry = new skill.SkillRegistry(ctx)
  const systemPrompt = new prompt.SystemPrompt(ctx, {})
  await settle()

  assert.ok(ctx.skills, 'skill registry mounted')
  assert.ok(ctx.systemPrompt, 'prompt registry mounted')
  void skillRegistry
  void systemPrompt

  // The caveman shape: one skill provider plus one always-on prompt section.
  ctx.skills.registerProvider(() => ({
    name: 'caveman',
    list: () => Promise.resolve([{
      name: 'caveman',
      description: 'terse talk',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: 'caveman',
      rank: 600,
      locator: 'x',
    }]),
    get: () => Promise.resolve({
      name: 'caveman',
      description: 'terse talk',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: 'caveman',
      content: BODY,
    }),
  }))
  ctx.systemPrompt.section({ name: 'caveman', order: 700, text: GLOBAL_TEXT })
  await settle()

  const globalCatalog = await ctx.skills.list()
  assert.deepEqual(globalCatalog.map(s => s.name), ['caveman'], 'global catalog sees caveman')
  const globalPrompt = await ctx.systemPrompt.assemble()
  assert.ok(globalPrompt.sections.find(s => s.name === 'caveman').text.includes('CAVEMAN MODE ACTIVE'),
    'global ruleset present')

  // The Agent scope: `createScope` mints a context tagged with a scope key,
  // which is what `Agent.scope` does; agent.ctx inherits that tag.
  const agentKey = { id: 'agent-under-test' }
  const agentScope = scope.createScope(ctx, agentKey).ctx
  await settle()

  const beforeOff = await ctx.skills.list({ scope: agentKey })
  assert.equal(beforeOff.length, 1, 'agent sees the skill before switching')
  assert.equal(beforeOff[0].invocation.modelInvocable, true, 'and it is model-invocable')

  // OFF: an invisible twin in the Agent layer plus an empty same-named section.
  const offFiber = agentScope.inject(['skills', 'systemPrompt'], (scoped) => {
    scoped.skills.register({
      name: 'caveman',
      description: 'turned off for this session',
      invocation: { modelInvocable: false, userInvocable: false },
      content: '',
    })
    scoped.systemPrompt.section({ name: 'caveman', order: 700, text: '' })
  })
  await offFiber

  const agentCatalog = await ctx.skills.list({ scope: agentKey })
  const globalAfterOff = await ctx.skills.list()
  console.log('agent catalog after off:', agentCatalog.map(s => `${s.name}:model=${s.invocation.modelInvocable}`))
  console.log('global catalog after off:', globalAfterOff.map(s => `${s.name}:model=${s.invocation.modelInvocable}`))
  assert.equal(agentCatalog.length, 1, 'the twin replaces, never adds')
  assert.equal(agentCatalog[0].invocation.modelInvocable, false, 'agent twin is not model-invocable')
  assert.equal(globalAfterOff[0].invocation.modelInvocable, true, 'global skill untouched')

  const agentPrompt = await ctx.systemPrompt.assemble({ scope: agentKey })
  const agentSection = agentPrompt.sections.find(s => s.name === 'caveman')
  console.log('agent section after off:', JSON.stringify(agentSection?.text ?? null))
  assert.ok(agentSection === undefined || agentSection.text === '', 'agent ruleset gone')
  const globalStill = await ctx.systemPrompt.assemble()
  assert.ok(globalStill.sections.find(s => s.name === 'caveman').text.includes('CAVEMAN MODE ACTIVE'),
    'global ruleset untouched')

  // A level: the plugin disposes the previous set first, then registers the
  // level-filtered body under the same section name in the same scope.
  await offFiber.dispose()
  const levelFiber = agentScope.inject(['skills', 'systemPrompt'], (scoped) => {
    scoped.systemPrompt.section({ name: 'caveman', order: 700, text: LEVEL_TEXT })
  })
  await levelFiber
  const leveled = await ctx.systemPrompt.assemble({ scope: agentKey })
  const leveledSection = leveled.sections.find(s => s.name === 'caveman')
  console.log('agent section with level:', JSON.stringify(leveledSection?.text.slice(0, 44)))
  assert.ok(leveledSection.text.startsWith('SKILL "Caveman" ACTIVE - level: ultra'), 'level section wins')

  // Disposing the set restores the owner's own view for that scope.
  await levelFiber.dispose()
  const restored = await ctx.skills.list({ scope: agentKey })
  const restoredPrompt = await ctx.systemPrompt.assemble({ scope: agentKey })
  console.log('restored catalog:', restored.map(s => `${s.name}:model=${s.invocation.modelInvocable}`))
  assert.equal(restored[0].invocation.modelInvocable, true, 'switch off is reversible')
  assert.ok(restoredPrompt.sections.find(s => s.name === 'caveman').text.includes('CAVEMAN MODE ACTIVE'),
    'ruleset restored')

  console.log('ALL CHECKS PASSED')
}

main().then(
  () => { process.exitCode = 0 },
  (error) => { console.error('FAILED:', error); process.exitCode = 1 },
)
