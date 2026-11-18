/**
 * Route test for the Host half: calls the registered web-server handler with
 * fake Node request/response objects.
 *
 * This covers the path that failed first in the real Host (a missing `agents`
 * injection produced a 500), so the HTTP shape is exercised without needing a
 * browser session cookie.
 *
 * Run with the DSH Electron binary in Node mode:
 * ELECTRON_RUN_AS_NODE=1 "<DSH NEXT.exe>" this-file.mjs
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const plugin = await import(pathToFileURL(path.join(HERE, '..', 'index.js')).href)

const BODY = 'Always applies.\n| **lite** | keep |\n| **ultra** | strip |\n'
const record = args => ({ type: 'command/run', seq: 1, time: 0, data: { name: plugin.COMMAND_NAME, args } })

/** Collect the handler the plugin registers on the web server. */
function mountRoute(visible, commandRecords) {
  let registered
  const agent = {
    id: 'session-route',
    session: { snapshotEvents: () => commandRecords },
    ctx: {
      inject(deps, callback) {
        callback({
          skills: { register: () => () => {} },
          systemPrompt: { section: () => () => {} },
        })
        return { dispose: async () => {} }
      },
    },
  }
  const ctx = {
    logger: { warn() {} },
    on() { return () => {} },
    inject(deps, callback) {
      if (deps.includes('commands')) {
        callback({ commands: { register: () => () => {} } })
        return { dispose: async () => {} }
      }
      const scoped = {
        connection: {
          // Stand-in for the peer check: a trusted same-origin page.
          requestRejection: () => undefined,
        },
        agents: { get: id => (id === agent.id ? agent : undefined) },
        webServer: {
          register(route) { registered = route; return () => {} },
        },
        effect(callback) { return callback() },
      }
      callback(scoped)
      return { dispose: async () => {} }
    },
    skills: {
      list: async () => visible,
      get: async (name) => {
        const found = visible.find(skill => skill.name === name)
        return found === undefined ? undefined : { ...found, content: BODY }
      },
    },
  }
  plugin.apply(ctx, { skills: { caveman: { title: 'Caveman', levels: ['lite', 'ultra'], defaultEnabled: false } } })
  assert.ok(registered !== undefined, 'the route was registered')
  assert.equal(registered.kind, 'exact', 'exact-path route')
  assert.equal(registered.path, plugin.LEVEL_ROUTE, 'under the documented path')
  return registered
}

/** Minimal ServerResponse stand-in that records what the handler wrote. */
function fakeResponse() {
  const out = { statusCode: 200, headers: {}, body: '' }
  return {
    out,
    // A real ServerResponse exposes `statusCode` as a writable property; the
    // handler assigns it directly, so the fake mirrors that with an accessor.
    get statusCode() { return out.statusCode },
    set statusCode(value) { out.statusCode = value },
    setHeader(name, value) { out.headers[name] = value },
    end(chunk) { if (chunk !== undefined) out.body += chunk },
  }
}

const VISIBLE = [{
  name: 'caveman',
  description: 'terse talk',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'bundled',
  provider: 'caveman',
}]

// 1. A GET for a live Session answers the board.
{
  const route = mountRoute(VISIBLE, [record('caveman ultra')])
  const res = fakeResponse()
  route.handler({ url: `${plugin.LEVEL_ROUTE}?sessionId=session-route`, method: 'GET', headers: {} }, res)
  await new Promise(resolve => setTimeout(resolve, 60))
  console.log('GET live session ->', res.out.statusCode, res.out.body)
  assert.equal(res.out.statusCode, 200, 'a GET succeeds')
  assert.match(res.out.headers['content-type'], /application\/json/, 'answers JSON')
  assert.equal(res.out.headers['cache-control'], 'no-store', 'never cached')
  const body = JSON.parse(res.out.body)
  assert.equal(body.skills.length, 1, 'one skill on the board')
  assert.equal(body.skills[0].name, 'caveman')
  assert.equal(body.skills[0].enabled, true, 'it is on')
  assert.equal(body.skills[0].level, 'ultra', 'at the level from the log')
  assert.deepEqual(body.errors, [], 'no apply errors')
}

// 2. An unknown Session still answers, with no per-session state.
{
  const route = mountRoute(VISIBLE, [])
  const res = fakeResponse()
  route.handler({ url: plugin.LEVEL_ROUTE, method: 'GET', headers: {} }, res)
  await new Promise(resolve => setTimeout(resolve, 60))
  console.log('GET without session ->', res.out.statusCode, res.out.body.slice(0, 120))
  assert.equal(res.out.statusCode, 200, 'a Session-less read is not an error')
  const body = JSON.parse(res.out.body)
  assert.equal(body.skills.length, 1, 'the configured skill still shows')
  assert.equal(body.skills[0].enabled, false, 'at its configured default (request-only)')
}

// 3. A method other than GET is refused with Allow.
{
  const route = mountRoute(VISIBLE, [])
  const res = fakeResponse()
  route.handler({ url: plugin.LEVEL_ROUTE, method: 'POST', headers: {} }, res)
  console.log('POST ->', res.out.statusCode, res.out.headers.allow)
  assert.equal(res.out.statusCode, 405, 'POST is refused')
  assert.equal(res.out.headers.allow, 'GET', 'and names the allowed method')
}

// 4. A rejection from the connection layer passes through unchanged.
{
  let registered
  const ctx = {
    logger: { warn() {} },
    on() { return () => {} },
    inject(deps, callback) {
      if (deps.includes('commands')) {
        callback({ commands: { register: () => () => {} } })
        return { dispose: async () => {} }
      }
      callback({
        connection: { requestRejection: () => 401 },
        agents: { get: () => undefined },
        webServer: { register(route) { registered = route; return () => {} } },
        effect: callback => callback(),
      })
      return { dispose: async () => {} }
    },
    skills: { list: async () => [], get: async () => undefined },
  }
  plugin.apply(ctx, {})
  const res = fakeResponse()
  registered.handler({ url: plugin.LEVEL_ROUTE, method: 'GET', headers: {} }, res)
  console.log('rejected peer ->', res.out.statusCode, JSON.stringify(res.out.body))
  assert.equal(res.out.statusCode, 401, 'the peer decision is honoured')
  assert.equal(res.out.body, '', 'and no payload leaks')
}

console.log('ALL CHECKS PASSED')
