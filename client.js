/**
 * Browser half of the skill switch board.
 *
 * Two registrations share one module-scope store:
 *
 * - `conversation.input.left` draws the compact trigger beside the permission
 *   and plan controls of the composer tool row.
 * - `conversation.input.dock` draws the board itself, full width above the
 *   composer card. Choosing that seat instead of a floating popover keeps the
 *   panel out of the composer's clipping and scroll containers, which is why
 *   this file needs no portal and no anchor measurement.
 *
 * Reads go to this package's own Host route, which answers from the live
 * Session; writes go through one Session command, so the Host-side switch
 * logic has a single implementation shared with `/skill-switch`.
 */

window.__ModuleLoader__.load({
  id: '@zhangwansen123/dsh-skill-switch',

  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Locale namespace; also the dictionaries registered below. */
    const LOCALE_NS = 'skillSwitch'

    /** Host route reporting the board for one Session. */
    const STATE_ROUTE = '/skill-switch/state'

    const en = {
      button: 'Skills',
      title: 'Skills in this session',
      hint: 'On: the skill applies to every reply without being named. Off: it stays available when asked for.',
      levelNote: 'Level {level} applies to every reply.',
      empty: 'No skill is available in this session.',
      loading: 'Loading…',
      applying: 'Applying…',
      failed: 'The Host did not answer. Reopen the board to retry.',
      level: 'Level',
      useDefault: 'Default',
      close: 'Close',
      switchLabel: 'Apply {name} to every reply in this session',
      levelGroup: '{name} level',
      on: 'on',
      requestOnly: 'on request',
      noLevel: 'no levels',
      errorSession: 'this session is not loaded yet',
      errorRefused: 'the Host refused the switch',
      errorNoCommand: 'the Host offers no /skill-switch command',
    }

    const zh = {
      button: '技能',
      title: '本会话技能',
      hint: '打开：该技能对每次回答生效，不用你再点名。关闭：需要时仍可随时调用。',
      levelNote: '挡位 {level} 对每次回答生效。',
      empty: '本会话没有可用技能。',
      loading: '加载中…',
      applying: '正在应用…',
      failed: 'Host 没有应答，重开面板重试。',
      level: '挡位',
      useDefault: '默认',
      close: '关闭',
      switchLabel: '让 {name} 对本会话每次回答生效',
      levelGroup: '{name} 挡位',
      on: '常驻',
      requestOnly: '按需',
      noLevel: '无挡位',
      errorSession: '本会话还没加载好',
      errorRefused: 'Host 拒绝了这次切换',
      errorNoCommand: 'Host 没有提供 /skill-switch 命令',
    }

    /* The dock column follows the host's own dock card rules (GoalBar /
       QueueDock): the card cap minus the composer insets, centred. Without
       this the panel is wider than the composer card it sits above. */
    const CSS = [
      '.dss-trigger{display:inline-flex;align-items:center;gap:4px;flex:none;height:28px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}',
      '.dss-trigger:hover{background:var(--dsw-alias-border-l1)}',
      '.dss-trigger[aria-expanded="true"]{background:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}',
      '.dss-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dss-trigger-extra{color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis}',
      /* Narrow composer: the label collapses the way the model chip does, so
         the row keeps its 28px height instead of wrapping. */
      '@container (max-width: 560px){.dss-trigger-label{display:none}}',
      '.dss-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto}',
      '.dss-panel{position:relative;box-sizing:border-box;width:100%;max-width:calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));margin:0 auto 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
      '.dss-head{display:flex;align-items:center;gap:8px}',
      '.dss-title{flex:1;min-width:0;font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dss-close{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;padding:2px 6px;border-radius:6px}',
      '.dss-close:hover{background:var(--dsw-alias-border-l1)}',
      '.dss-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dss-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dss-list{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto}',
      '.dss-row{display:flex;flex-direction:column;gap:6px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dss-row:first-child{border-top:none}',
      '.dss-row-head{display:flex;align-items:center;gap:10px}',
      '.dss-name{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dss-name-text{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dss-name-desc{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dss-row-state{flex:none;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dss-switch{position:relative;flex:none;width:34px;height:20px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background 120ms ease,border-color 120ms ease}',
      '.dss-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dss-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dss-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform 120ms ease}',
      '.dss-switch[aria-checked="true"] .dss-knob{transform:translateX(14px)}',
      '.dss-levels{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
      '.dss-levels-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      '.dss-pill{appearance:none;font:inherit;font-size:12px;line-height:16px;padding:2px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dss-pill[aria-checked="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dss-pill:disabled{cursor:default;opacity:.5}',
      '.dss-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dss-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
    ].join('')

    if (typeof document !== 'undefined') {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.append(style)
    }

    /**
     * Module-scope board store shared by both slot entries.
     *
     * `pending` holds the skill names whose switch is crossing the wire, so one
     * switch never disables the rest of the board and never steals focus from
     * the control the user is about to press next.
     * @returns the store both components subscribe to.
     */
    function createStore() {
      let state = {
        open: false,
        sessionId: null,
        status: 'idle',
        board: null,
        error: null,
        errorKey: null,
        pending: [],
      }
      let inflight = null
      const listeners = new Set()
      const notify = () => { for (const listener of [...listeners]) listener() }
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(patch) {
          state = { ...state, ...patch }
          notify()
        },
        takeInflight() {
          const current = inflight
          inflight = null
          return current
        },
        setInflight(promise) { inflight = promise },
        hasInflight: () => inflight !== null,
      }
    }

    const store = createStore()

    /**
     * Load the Host's board for one Session.
     * @param sessionId - the Session whose switches are read.
     * @param store - the shared board store.
     */
    async function load(sessionId, store) {
      if (typeof sessionId !== 'string' || store.hasInflight()) return
      store.set({ status: store.getSnapshot().board === null ? 'loading' : 'ready', error: null })
      const run = fetch(`${STATE_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { accept: 'application/json' },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = await response.json()
          const skills = body !== null && typeof body === 'object' && Array.isArray(body.skills) ? body.skills : []
          store.set({ status: 'ready', board: skills, error: null })
        })
        .catch((error) => {
          store.set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
        })
        .finally(() => { store.takeInflight() })
      store.setInflight(run)
      await run
    }

    /**
     * Submit one switch line through the Session command registry.
     * @param sessions - the client sessions service.
     * @param sessionId - the Session being switched.
     * @param skill - the skill the line addresses, for the per-row pending mark.
     * @param line - the command line, for example `/skill-switch caveman off`.
     * @param store - the shared board store.
     * @param t - translate function, so a failure reads in the user's language.
     */
    async function submit(sessions, sessionId, skill, line, store, t) {
      const live = sessions.binding(sessionId)?.session
      if (live === undefined) {
        store.set({ error: t('errorSession'), errorKey: 'errorSession' })
        return
      }
      store.set({
        error: null,
        errorKey: null,
        pending: [...store.getSnapshot().pending, skill],
      })
      try {
        const result = await live.command(line)
        if (result === undefined || result.ok !== true) {
          // A Host refusal carries its own reason; show it verbatim.
          const reason = result?.error?.message
          store.set(typeof reason === 'string' && reason !== ''
            ? { error: reason, errorKey: null }
            : { error: t('errorRefused'), errorKey: 'errorRefused' })
          return
        }
        if (result.value !== undefined && result.value.matched === false) {
          store.set({ error: t('errorNoCommand'), errorKey: 'errorNoCommand' })
          return
        }
      } catch (error) {
        store.set({ error: error instanceof Error ? error.message : String(error), errorKey: null })
        return
      } finally {
        store.set({ pending: store.getSnapshot().pending.filter(name => name !== skill) })
      }
      await load(sessionId, store)
    }

    /**
     * Keep the shared board pointed at the current Session.
     *
     * A Session change is handled in RENDER as well as in an effect: the store
     * still holds the previous Session's rows for the first frame after a
     * switch, and showing them would attribute one Session's switches to
     * another. The effect then loads the new Session's board.
     * @param sessionId - the Session the surface belongs to.
     * @returns the current board snapshot, never another Session's rows.
     */
    function useBoard(sessionId) {
      const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
      const current = snapshot.sessionId === sessionId
      React.useEffect(() => {
        if (store.getSnapshot().sessionId !== sessionId) {
          store.set({ sessionId, board: null, status: 'loading', error: null })
        }
        if (typeof sessionId === 'string') void load(sessionId, store)
      }, [sessionId])
      if (current) return snapshot
      return { ...snapshot, sessionId, board: null, status: 'loading', error: null }
    }

    /** Draw the compact trigger in the composer tool row. */
    function createTrigger(sessions, t) {
      return function Trigger(props) {
        const sessionId = props.sessionId
        const snapshot = useBoard(sessionId)
        const board = snapshot.board ?? []
        const on = board.filter(skill => skill.enabled)
        // One active level is the useful summarizable case; several are not,
        // so the count names "常驻" instead of borrowing the level slot.
        const extra = on.length === 0
          ? ''
          : on.length === 1 && typeof on[0].level === 'string'
            ? ` · ${on[0].level}`
            : ` · ${t('on')} ${on.length}`
        return React.createElement(
          'button',
          {
            type: 'button',
            className: 'dss-trigger',
            'aria-expanded': snapshot.open,
            'aria-haspopup': 'dialog',
            title: t('title'),
            onClick: () => {
              const opening = !store.getSnapshot().open
              store.set({ open: opening })
              if (opening && sessionId !== undefined) void load(sessionId, store)
            },
          },
          React.createElement('span', { className: 'dss-trigger-label' }, t('button')),
          extra === ''
            ? null
            : React.createElement('span', { className: 'dss-trigger-extra' }, extra),
        )
      }
    }

    /** Draw one skill row: switch plus the level pills the skill declares. */
    function createRow(sessions, t) {
      return function Row({ skill, sessionId, pending }) {
        const on = skill.enabled === true
        const busy = pending === true
        const levels = Array.isArray(skill.levels) ? skill.levels : []
        const commit = (line) => { void submit(sessions, sessionId, skill.name, line, store, t) }
        const name = skill.title
        const levelName = skill.level === null ? t('useDefault') : skill.level
        const stateLabel = levels.length === 0
          ? t('noLevel')
          : on ? levelName : t('requestOnly')
        return React.createElement(
          'div',
          { className: 'dss-row' },
          React.createElement(
            'div',
            { className: 'dss-row-head' },
            React.createElement(
              'span',
              { className: 'dss-name' },
              React.createElement('span', { className: 'dss-name-text' }, name),
              skill.description === ''
                ? null
                : React.createElement('span', { className: 'dss-name-desc' }, skill.description),
            ),
            React.createElement('span', { className: 'dss-row-state' }, stateLabel),
            React.createElement(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-checked': on,
                'aria-label': t('switchLabel', { name }),
                'aria-busy': busy,
                className: 'dss-switch',
                // A pending switch stays focusable and enabled: disabling the
                // button the user just pressed would drop keyboard focus out of
                // the board mid-interaction.
                onClick: () => { if (!busy) commit(`/skill-switch ${skill.name} ${on ? 'off' : 'on'}`) },
              },
              React.createElement('span', { className: 'dss-knob', 'aria-hidden': true }),
            ),
          ),
          levels.length === 0 || !on
            ? null
            : React.createElement(
              'div',
              { className: 'dss-levels', role: 'radiogroup', 'aria-label': t('levelGroup', { name }) },
              React.createElement('span', { className: 'dss-levels-label' }, `${t('level')}:`),
              React.createElement(
                'button',
                {
                  type: 'button',
                  role: 'radio',
                  'aria-checked': skill.level === null,
                  className: 'dss-pill',
                  'aria-busy': busy,
                  onClick: () => { if (!busy) commit(`/skill-switch ${skill.name} on default`) },
                },
                t('useDefault'),
              ),
              levels.map(level => React.createElement(
                'button',
                {
                  key: level,
                  type: 'button',
                  role: 'radio',
                  'aria-checked': skill.level === level,
                  className: 'dss-pill',
                  'aria-busy': busy,
                  onClick: () => { if (!busy) commit(`/skill-switch ${skill.name} ${level}`) },
                },
                level,
              )),
            ),
        )
      }
    }

    /**
     * Draw the board above the composer card.
     *
     * Dismissal matches a popover's: Escape and a pointer press outside the
     * panel both close it, and the board moves focus to its first control on
     * open so keyboard users land inside it rather than past it.
     */
    function createPanel(sessions, t) {
      const Row = createRow(sessions, t)
      return function Panel(props) {
        const sessionId = props.sessionId
        const snapshot = useBoard(sessionId)
        const panelRef = React.useRef(null)
        const opened = snapshot.open

        React.useEffect(() => {
          if (!opened) return undefined
          const onKeyDown = (event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            store.set({ open: false })
          }
          const onPointerDown = (event) => {
            const panel = panelRef.current
            const target = event.target
            // A press on the trigger is the toggle's own business.
            if (panel !== null && target instanceof Node && panel.contains(target)) return
            if (target instanceof Element && target.closest('.dss-trigger') !== null) return
            store.set({ open: false })
          }
          const captured = true
          window.addEventListener('keydown', onKeyDown, captured)
          window.addEventListener('pointerdown', onPointerDown, captured)
          return () => {
            window.removeEventListener('keydown', onKeyDown, captured)
            window.removeEventListener('pointerdown', onPointerDown, captured)
          }
        }, [opened])

        React.useEffect(() => {
          if (!opened || panelRef.current === null) return
          const first = panelRef.current.querySelector('button')
          if (first !== null && typeof first.focus === 'function') first.focus()
        }, [opened])

        if (!opened) return null
        const board = snapshot.board ?? []
        const pending = snapshot.pending ?? []
        const errorText = snapshot.errorKey === null || snapshot.errorKey === undefined
          ? snapshot.error
          : t(snapshot.errorKey)
        return React.createElement(
          'div',
          { className: 'dss-dock' },
          React.createElement(
            'div',
            {
              ref: panelRef,
              className: 'dss-panel',
              role: 'dialog',
              'aria-label': t('title'),
            },
            React.createElement(
              'div',
              { className: 'dss-head' },
              React.createElement('span', { className: 'dss-title' }, t('title')),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dss-close',
                  onClick: () => { store.set({ open: false }) },
                },
                t('close'),
              ),
            ),
            React.createElement('div', { className: 'dss-hint' }, t('hint')),
            pending.length > 0
              ? React.createElement('div', { className: 'dss-hint', role: 'status' }, t('applying'))
              : null,
            snapshot.status === 'loading' && board.length === 0
              ? React.createElement('div', { className: 'dss-hint' }, t('loading'))
              : null,
            snapshot.status === 'failed'
              ? React.createElement('div', { className: 'dss-error' }, `${t('failed')} ${snapshot.error ?? ''}`)
              : null,
            snapshot.status === 'ready' && board.length === 0
              ? React.createElement('div', { className: 'dss-hint' }, t('empty'))
              : null,
            errorText !== null && snapshot.status !== 'failed'
              ? React.createElement('div', { className: 'dss-error', role: 'alert' }, errorText)
              : null,
            React.createElement(
              'div',
              { className: 'dss-list' },
              board.map(skill => React.createElement(Row, {
                key: skill.name,
                skill,
                sessionId,
                pending: pending.includes(skill.name),
              })),
            ),
          ),
        )
      }
    }

    /**
     * Mount both surfaces.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const sessions = ctx.sessions
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { en, zh }), 'skill-switch: locale')

      const Trigger = createTrigger(sessions, t)
      const Panel = createPanel(sessions, t)

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'skill-switch',
        order: 30,
        locale: LOCALE_NS,
      }, Trigger))

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'skill-switch',
        // Between the goal bar (10) and the queue strip (20): every order in
        // this slot is taken, and a shared order makes stack order depend on
        // load order.
        order: 15,
        locale: LOCALE_NS,
      }, Panel))
    }

    exports.apply = apply
    exports.inject = ['slots', 'sessions', 'locale']
    return module.exports
  },
})
