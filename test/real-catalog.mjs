/**
 * End-to-end check against the REAL skills on this machine.
 *
 * It mounts the shipped filesystem skill provider over the actual DSH home, so
 * the catalog it reads is the one this installation serves — including the
 * user's `~/.dsh/skills/caveman/SKILL.md`. Then it applies the plugin's own
 * shadowing path and asserts the observable result:
 *
 *   - with no switch, `caveman` is listed and model-invocable;
 *   - switched off, the Session-scoped catalog reports it non-invocable and
 *     the global catalog is untouched;
 *   - switched to `ultra`, the prompt section is the body trimmed to ultra.
 *
 * Run with the DSH Electron binary in Node mode:
 * ELECTRON_RUN_AS_NODE=1 "<DSH NEXT.exe>" this-file.mjs
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.join(process.env.DSH_INSTALL_DIR, 'node_modules', '@deepseek-ai')
const load = spec => import(pathToFileURL(path.join(ROOT, spec, 'lib', 'index.js')).href)
const settle = () => new Promise(resolve => setTimeout(resolve, 60))

/** Reuse the plugin's own level filter by importing its module internals. */
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const plugin = await import(pathToFileURL(path.join(HERE, '..', 'index.js')).href)

const { Context } = await import(pathToFileURL(path.join(ROOT, 'cordis', 'lib', 'index.js')).href)
const scope = await load('dsh-scope')
const skill = await load('dsh-skill')
const prompt = await load('dsh-system-prompt')
const fsSkills = await load('dsh-skill-filesystem')

const ctx = new Context()
new skill.SkillRegistry(ctx)
new prompt.SystemPrompt(ctx, {})
await settle()

// The real provider over the real home, exactly as the desktop composition mounts it.
ctx.plugin({
  name: 'skill-filesystem',
  inject: fsSkills.inject ?? ['skills'],
  apply: fsSkills.apply,
  Config: fsSkills.Config,
}, {
  dshHome: path.join(os.homedir(), '.dsh'),
  watch: false,
})
await settle()

const globalCatalog = await ctx.skills.list()
const names = globalCatalog.map(entry => entry.name).sort()
console.log('catalog from ~/.dsh/skills:', names.join(', '))
assert.ok(names.includes('caveman'), 'the real caveman skill is discovered')

const caveman = globalCatalog.find(entry => entry.name === 'caveman')
assert.equal(caveman.invocation.modelInvocable, true, 'and it is model-invocable by default')

const body = (await ctx.skills.get('caveman')).content
assert.ok(body.includes('Intensity'), 'the skill body has its intensity table')
assert.ok(body.includes('**lite**') && body.includes('**ultra**'), 'with per-level rows')

// The plugin registers a global caveman section the way the caveman plugin does.
ctx.systemPrompt.section({ name: 'caveman', order: 700, text: `CAVEMAN MODE ACTIVE\n\n${body}` })
await settle()

const LEVELS = ['lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra']

const agentKey = { id: 'agent-real' }
const agentScope = scope.createScope(ctx, agentKey).ctx
await settle()

// --- switched OFF -------------------------------------------------------
const offFiber = agentScope.inject(['skills', 'systemPrompt'], (scoped) => {
  scoped.skills.register({
    name: 'caveman',
    description: 'Caveman — turned off for this Session',
    invocation: { modelInvocable: false, userInvocable: false },
    content: '',
  })
  scoped.systemPrompt.section({ name: 'caveman', order: 700, text: '' })
})
await offFiber
const offCatalog = await ctx.skills.list({ scope: agentKey })
const offEntry = offCatalog.find(entry => entry.name === 'caveman')
console.log('after off -> modelInvocable:', offEntry.invocation.modelInvocable,
  '| userInvocable:', offEntry.invocation.userInvocable)
assert.equal(offEntry.invocation.modelInvocable, false, 'off hides it from the model')
assert.equal(offEntry.invocation.userInvocable, false, 'off hides it from the / menu too')
const offPrompt = await ctx.systemPrompt.assemble({ scope: agentKey })
const offSection = offPrompt.sections.find(section => section.name === 'caveman')
console.log('after off -> ruleset:', JSON.stringify(offSection?.text ?? null))
assert.ok(offSection === undefined || offSection.text === '', 'and drops the standing ruleset')
assert.equal((await ctx.skills.list())[0].invocation.modelInvocable, true, 'the global view is unchanged')

// --- switched to a level -----------------------------------------------
await offFiber.dispose()
// The plugin's own renderer, so the test checks the SHIPPED filter rather than
// a copy of it.
const levelText = plugin.renderLevel('Caveman', 'ultra', body, LEVELS)
const levelFiber = agentScope.inject(['systemPrompt'], (scoped) => {
  scoped.systemPrompt.section({ name: 'caveman', order: 700, text: levelText })
})
await levelFiber
const leveled = await ctx.systemPrompt.assemble({ scope: agentKey })
const levelSection = leveled.sections.find(section => section.name === 'caveman')
console.log('ultra section length:', levelSection.text.length, 'vs body', body.length)
console.log('ultra section head:', JSON.stringify(levelSection.text.slice(0, 60)))
assert.ok(levelSection.text.startsWith('SKILL "Caveman" ACTIVE — level: ultra'), 'the level is announced')
assert.ok(!levelSection.text.includes('| **lite** |'), "another level's table row is gone")
assert.ok(levelSection.text.includes('| **ultra** |'), "this level's table row stays")
assert.ok(!levelSection.text.includes('- lite: "'), "another level's example is gone")

await levelFiber.dispose()
const restored = (await ctx.skills.list({ scope: agentKey })).find(entry => entry.name === 'caveman')
assert.equal(restored.invocation.modelInvocable, true, 'disposing restores the owner view')
console.log('restored modelInvocable:', restored.invocation.modelInvocable)

console.log('ALL CHECKS PASSED')
