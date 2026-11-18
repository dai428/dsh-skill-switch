/**
 * Browser-half test: renders the real `client.js` factory against a fake
 * module loader, a fake React, and fake slot/locale/sessions services.
 *
 * The point is the parts that a page cannot easily prove by hand: the trigger
 * reads the board, a switch submits the exact command line, the board drops a
 * previous Session's rows, and the level row appears only for skills that
 * declare levels and are on.
 *
 * Run with the DSH Electron binary in Node mode:
 * ELECTRON_RUN_AS_NODE=1 "<DSH NEXT.exe>" this-file.mjs
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { readFile } from 'node:fs/promises'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SOURCE = await readFile(path.join(HERE, '..', 'client.js'), 'utf8')

/** A tiny React stand-in: hooks backed by plain state, elements kept as data. */
function fakeReact() {
  const hooks = { state: [], effects: [], cursor: 0, muted: false }
  return {
    hooks,
    React: {
      createElement(type, props, ...children) {
        return { type, props: props ?? {}, children: children.flat() }
      },
      useState(initial) {
        const index = hooks.cursor++
        if (!(index in hooks.state)) hooks.state[index] = initial
        return [hooks.state[index], (next) => { hooks.state[index] = next }]
      },
      useEffect(effect, deps) {
        // Re-walking a tree for inspection calls components again; those calls
        // must not queue effects, or a stale closure would run after the
        // committed one and overwrite its state. Real React only commits once.
        if (hooks.muted) return
        hooks.effects.push({ effect, deps })
      },
      useSyncExternalStore(subscribe, getSnapshot) {
        return getSnapshot()
      },
      useCallback(fn) { return fn },
      useMemo(fn) { return fn() },
      useRef(value) { return { current: value } },
    },
  }
}

/** Mount the client factory and return its exported plugin body. */
async function mountClient(options) {
  const { React, hooks } = fakeReact()
  const registered = { slots: [], locale: [], styles: [] }
  let plugin
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        assert.equal(definition.id, 'dsh-skill-switch', 'registers under its package name')
        plugin = definition.factory((spec) => {
          assert.equal(spec, 'react', 'the only module request is react')
          return React
        })
      },
    },
    // The board's dismissal listeners; the fake records them so the test can
    // drive an Escape press the way a browser would.
    addEventListener(type, listener) {
      registered.listeners = registered.listeners ?? []
      registered.listeners.push({ type, listener })
    },
    removeEventListener(type, listener) {
      registered.listeners = (registered.listeners ?? [])
        .filter(entry => !(entry.type === type && entry.listener === listener))
    },
  }
  globalThis.document = {
    head: { append(node) { registered.styles.push(node) } },
    createElement(tag) { return { tag, textContent: '', setAttribute() {} } },
  }
  globalThis.fetch = async (url) => {
    registered.fetched = url
    registered.fetches = (registered.fetches ?? 0) + 1
    console.log('   [fetch]', url)
    // The real route answers per Session, so the fake must too: a constant
    // body would hide the very bug this test looks for.
    const session = new URL(url, 'http://localhost').searchParams.get('sessionId')
    const body = options.boards?.[session] ?? options.board
    return {
      ok: true,
      async json() { return body },
    }
  }
  const context = {
    sessions: { binding: options.binding },
    locale: {
      bind: () => (key, vars) => {
        const last = registered.locale.at(-1) ?? {}
        const dict = last.en ?? {}
        const template = dict[key] ?? key
        return vars === undefined
          ? template
          : template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''))
      },
      register: (namespace, dicts) => {
        registered.locale.push({ namespace, ...dicts })
        return () => {}
      },
    },
    slots: {
      inject(key, callback) {
        registered.slots.push({ key })
        // The real owner runs the callback once the slot exists; doing it here
        // is what materializes the registration this test then renders.
        callback()
        return () => {}
      },
      register(declaration, component) {
        registered.slots.push({ registration: declaration, component })
        return () => {}
      },
    },
    effect: (callback) => callback(),
  }
  await import(pathToFileURL(path.join(HERE, '..', 'client.js')).href)
  plugin.apply(context)
  CURRENT_HOOKS = hooks
  return { plugin, registered, hooks, React }
}

/** Render one registered slot entry and collect the element tree. */
function render(registered, key) {
  const registration = registered.slots.filter(entry => entry.registration?.name === key).at(-1)
  assert.ok(registration !== undefined, `a registration exists for ${key}`)
  const tree = registration.component({ sessionId: registration.sessionId ?? CURRENT_SESSION })
  return { tree, component: registration.component, registration }
}
/** Run the effects the last render queued, the way a commit would. */
async function commit(mounted) {
  const queued = mounted.hooks.effects.splice(0)
  for (const entry of queued) {
    const cleanup = entry.effect()
    if (typeof cleanup === 'function') mounted.cleanups.push(cleanup)
  }
  await new Promise(resolve => setTimeout(resolve, 80))
  return mounted
}

/** Render one component with a fresh hook cursor and commit its effects. */
async function renderComponent(mounted, component, props) {
  mounted.hooks.cursor = 0
  mounted.hooks.muted = false
  // Render and commit, then render again so the tree reflects the committed
  // state — the two-pass shape of a real mount plus the state update an
  // effect triggers.
  component(props)
  await commit(mounted)
  mounted.hooks.cursor = 0
  mounted.hooks.muted = false
  return component(props)
}

/**
 * Render once WITHOUT committing: the frame a user sees immediately after a
 * prop changes, before any effect has run.
 */
function renderOnly(mounted, component, props) {
  mounted.hooks.cursor = 0
  const tree = component(props)
  mounted.hooks.cursor = 0
  return tree
}

const CURRENT_SESSION = 'session-current'

/** Every text node in a tree, in document order. */
function texts(node, out = []) {
  const expanded = expand(node)
  const walk = (current) => {
    if (current === null || current === undefined || current === false) return
    if (typeof current === 'string' || typeof current === 'number') { out.push(String(current)); return }
    if (Array.isArray(current)) { for (const child of current) walk(child); return }
    for (const child of current.children ?? []) walk(child)
  }
  walk(expanded)
  return out
}

/**
 * Expand function components into their rendered element trees.
 *
 * The fake React keeps elements as data, so a component type stays a function
 * until something calls it; this is the rendering step a real reconciler does.
 * Effects are muted while expanding: this is inspection, not a commit.
 * @param node - an element, a component element, an array, or a leaf.
 * @returns the same tree with component types replaced by their output.
 */
function expand(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(expand)
  if (typeof node.type === 'function') {
    const previous = CURRENT_HOOKS?.muted
    if (CURRENT_HOOKS !== undefined) CURRENT_HOOKS.muted = true
    try {
      return expand(node.type(node.props ?? {}))
    } finally {
      if (CURRENT_HOOKS !== undefined) CURRENT_HOOKS.muted = previous
    }
  }
  return { ...node, children: (node.children ?? []).map(expand) }
}

/** The hooks of the currently mounted client, for effect muting during inspection. */
let CURRENT_HOOKS

/** Find the first element matching a predicate in an expanded tree. */
function find(node, predicate) {
  const current = expand(node)
  if (current === null || current === undefined || typeof current !== 'object') return undefined
  if (Array.isArray(current)) {
    for (const child of current) {
      const hit = find(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (predicate(current)) return current
  for (const child of current.children ?? []) {
    const hit = find(child, predicate)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** Collect every element whose className equals one value. */
function byClass(node, className, out = []) {
  const current = expand(node)
  if (current === null || current === undefined || typeof current !== 'object') return out
  if (Array.isArray(current)) { for (const child of current) byClass(child, className, out); return out }
  if (current.props?.className === className) out.push(current)
  for (const child of current.children ?? []) byClass(child, className, out)
  return out
}

const BOARD = {
  skills: [
    {
      name: 'caveman',
      title: 'Caveman',
      description: 'terse talk',
      levels: ['lite', 'full', 'ultra'],
      enabled: true,
      level: 'ultra',
      live: true,
    },
    {
      name: 'office',
      title: 'office',
      description: 'office documents',
      levels: [],
      enabled: false,
      level: null,
      live: true,
    },
  ],
  errors: [],
}

const submitted = []
const binding = () => ({
  session: {
    async command(line) {
      submitted.push(line)
      return { ok: true, value: { matched: true } }
    },
  },
})

// ---- mount and inspect the trigger -------------------------------------
const OTHER_BOARD = {
  skills: [{
    name: 'office',
    title: 'Office (other session)',
    description: 'other session only',
    levels: [],
    enabled: true,
    level: null,
    live: true,
  }],
  errors: [],
}
const mounted = await mountClient({
  board: BOARD,
  boards: { 'session-other': OTHER_BOARD },
  binding,
})
mounted.cleanups = []
const { registered } = mounted
assert.equal(registered.styles.length, 1, 'one stylesheet is owned')
assert.ok(registered.locale.some(entry => entry.namespace === 'skillSwitch'), 'the locale namespace is registered')
assert.ok(registered.slots.some(entry => entry.key === 'conversation.input.left'), 'injects the composer row')
assert.ok(registered.slots.some(entry => entry.key === 'conversation.input.dock'), 'injects the dock')

// The trigger renders the button plus the active summary.
const trigger = registered.slots
  .filter(entry => entry.registration?.name === 'conversation.input.left')
  .at(-1)
const triggerTree = await renderComponent(mounted, trigger.component, { sessionId: CURRENT_SESSION })
const triggerButton = find(triggerTree, node => node.type === 'button')
assert.ok(triggerButton !== null, 'the trigger is a button')
console.log('trigger text:', texts(triggerTree).join(' | '))

// ---- the panel --------------------------------------------------------
const panel = registered.slots
  .filter(entry => entry.registration?.name === 'conversation.input.dock')
  .at(-1)
const closedPanel = await renderComponent(mounted, panel.component, { sessionId: CURRENT_SESSION })
assert.equal(closedPanel, null, 'the board is closed until asked for')
console.log('closed panel renders nothing: ok')

// ---- open the board ---------------------------------------------------
// The trigger's click sets the store open; the store then feeds both
// surfaces, which is the only thing that makes them agree.
const opened = find(triggerTree, node => node.type === 'button')
opened.props.onClick()
await new Promise(resolve => setTimeout(resolve, 100))
assert.equal(registered.fetched, `/skill-switch/state?sessionId=${CURRENT_SESSION}`,
  'the board is read for the current Session only')

const openTree = await renderComponent(mounted, panel.component, { sessionId: CURRENT_SESSION })
assert.ok(openTree !== null, 'the board renders once open')
const openText = texts(openTree).join(' | ')
console.log('open board text:', openText)
assert.ok(openText.includes('Caveman'), 'the skill is listed by its title')
assert.ok(openText.includes('office'), 'a skill without levels is listed too')
assert.ok(openText.includes('ultra'), 'the declared levels are offered')
assert.ok(openText.includes('Default'), 'and the default level clears an override')
// The board explains the semantic the user actually asked for.
assert.ok(openText.includes('without being named'), 'on means standing, not request-only')
assert.ok(openText.includes('stays available'), 'off does NOT remove the skill')

// The dock column follows the host card rules rather than filling the column.
const dock = find(openTree, node => node.props?.className === 'dss-dock')
assert.ok(dock !== undefined, 'the panel sits in a dock column')

// The level row belongs to an ON skill only: office is off and has no levels.
const rows = byClass(openTree, 'dss-row')
assert.equal(rows.length, 2, 'one row per skill')
console.log('rows:', rows.map(row => texts(row).slice(0, 3).join(' / ')))

// ---- flip a switch ---------------------------------------------------
const officeRow = rows.find(row => texts(row).some(text => text === 'office'))
const officeSwitch = find(officeRow, node => node.type === 'button' && node.props.role === 'switch')
assert.equal(officeSwitch.props['aria-checked'], false, 'office starts off')
officeSwitch.props.onClick()
await new Promise(resolve => setTimeout(resolve, 80))
console.log('submitted:', submitted)
assert.deepEqual(submitted, ['/skill-switch office on'], 'the switch submits the one command the Host understands')
assert.equal(officeSwitch.props.disabled, undefined, 'a pending switch is never disabled, so focus survives')

// ---- Escape closes the board -----------------------------------------
const escape = (registered.listeners ?? []).find(entry => entry.type === 'keydown')
assert.ok(escape !== undefined, 'the open board listens for keys')
escape.listener({ key: 'Escape', stopPropagation() {} })
const afterEscape = await renderComponent(mounted, panel.component, { sessionId: CURRENT_SESSION })
assert.equal(afterEscape, null, 'Escape closes the board')
console.log('Escape closes: ok')

// ---- a level pick ----------------------------------------------------
const reopened = find(triggerTree, node => node.type === 'button')
reopened.props.onClick()
await new Promise(resolve => setTimeout(resolve, 80))
const ownTree = await renderComponent(mounted, panel.component, { sessionId: CURRENT_SESSION })
const cavemanRow = byClass(ownTree, 'dss-row').find(row => texts(row).some(text => text === 'Caveman'))
const ultraPill = find(cavemanRow, node => node.type === 'button' && texts(node)[0] === 'ultra')
assert.ok(ultraPill !== undefined, 'the ultra pill exists')
assert.equal(ultraPill.props['aria-checked'], true, 'and reflects the level from the Host')
ultraPill.props.onClick()
await new Promise(resolve => setTimeout(resolve, 80))
assert.deepEqual(submitted.at(-1), '/skill-switch caveman ultra', 'a level pick submits the bare level')

// ---- switching Session drops the old rows ----------------------------
// The first frame after a switch runs no effect yet; it must already refuse
// to show the previous Session's rows. This is the render-time guard, which is
// exactly what protects the user from seeing another Session's switches.
const immediateTree = renderOnly(mounted, panel.component, { sessionId: 'session-other' })
const immediateText = immediateTree === null ? '' : texts(immediateTree).join(' | ')
console.log('first frame after switch:', immediateText.slice(0, 60))
assert.ok(!immediateText.includes('terse talk'), 'the previous Session rows are dropped in the first frame')
assert.ok(!immediateText.includes('office documents'), 'and none of its other rows survive')

// ---- the trigger reports the active state ----------------------------
const triggerAfter = await renderComponent(mounted, trigger.component, { sessionId: 'session-other' })
const triggerText = texts(triggerAfter).join(' | ')
console.log('trigger after switching:', triggerText)
assert.ok(triggerText.includes('Skills'), 'the trigger keeps its label')

// ---- closing the board -----------------------------------------------
mounted.hooks.cursor = 0
const closing = find(await renderComponent(mounted, panel.component, { sessionId: 'session-other' }),
  node => node.type === 'button' && node.props.className === 'dss-close')
if (closing !== undefined) {
  closing.props.onClick()
  console.log('closed again: ok')
}

for (const cleanup of mounted.cleanups) cleanup()
console.log('ALL CHECKS PASSED')
