// Dev-only mock of the tinyjs bridge, so `npm run dev` + a normal browser is
// enough to hack on the UI (vite tree-shakes this out of real builds, and it
// never loads inside the app — the injected `tiny` global wins).
//
// It fakes the backend api with an in-memory board and stubs the native
// dialogs with window.confirm/prompt.

import type { Board, BoardStub, Card, List } from './types'

let nextId = 100
const listeners = new Map<string, Array<(data: any) => void>>()
const emit = (event: string, data: any) => listeners.get(event)?.forEach((fn) => fn(data))

const mkCard = (listId: number, title: string, extra: Partial<Card> = {}): Card => ({
  id: nextId++, list_id: listId, title,
  notes: '', labels: [], checklist: [], due: null, done: false,
  pos: nextId * 1024, created_at: Date.now(), ...extra,
})

const boards: Board[] = []
function mkBoard(title: string, background: string): Board {
  const b: Board = { id: nextId++, title, background, hasImage: false, labels: {}, lists: [] }
  boards.push(b)
  return b
}

const demo = mkBoard('Welcome to Trolley', 'sky')
demo.labels = { red: 'Urgent', green: 'Nice to have' }
const todo: List = { id: nextId++, title: 'To do', cards: [] }
const doing: List = { id: nextId++, title: 'Doing', cards: [] }
const done: List = { id: nextId++, title: 'Done', cards: [] }
demo.lists.push(todo, doing, done)
todo.cards.push(
  mkCard(todo.id, 'Drag me to another list 👉', { labels: ['yellow'] }),
  mkCard(todo.id, 'Open me — I have a checklist', {
    notes: 'Cards hold notes, labels, a due date and a checklist.',
    checklist: [{ text: 'Click a checkbox', done: true }, { text: 'Add an item', done: false }],
  }),
  mkCard(todo.id, 'Give me a due date ⏰', { labels: ['red'], due: Date.now() + 86400000 }),
)
doing.cards.push(mkCard(doing.id, 'Press ⌃⌥T in any app', { labels: ['green'] }))
done.cards.push(mkCard(done.id, 'Make a board of your own', { done: true }))
mkBoard('Side projects', 'grape').lists.push({ id: nextId++, title: 'Ideas', cards: [] })

const stub = (b: Board): BoardStub => ({ id: b.id, title: b.title, background: b.background, hasImage: b.hasImage })
const state = () => ({
  path: '/tmp/trolley-devmock', boards: boards.map(stub),
  lastBoard: boards[0]?.id ?? null, hotkey: '⌃⌥T', version: '0.1.0',
})
const findList = (id: number) => boards.flatMap((b) => b.lists).find((l) => l.id === id)
const findCard = (id: number) => {
  for (const b of boards) for (const l of b.lists) {
    const c = l.cards.find((c) => c.id === id)
    if (c) return { c, l, b }
  }
  return null
}

const api: Record<string, (p?: any) => unknown> = {
  boot: () => state(),
  state: () => state(),
  setup: () => state(),
  moveStorage: () => state(),
  revealStorage: () => true,
  board: ({ id }) => boards.find((b) => b.id === id) ?? null,
  background: () => null,

  addBoard: ({ title }) => {
    const b = mkBoard(title, 'sky')
    emit('boards-changed', { boards: boards.map(stub) })
    return b
  },
  renameBoard: ({ id, title }) => {
    const b = boards.find((b) => b.id === id)
    if (b) b.title = title
    emit('boards-changed', { boards: boards.map(stub) })
    return true
  },
  deleteBoard: ({ id }) => {
    const i = boards.findIndex((b) => b.id === id)
    if (i >= 0) boards.splice(i, 1)
    emit('boards-changed', { boards: boards.map(stub) })
    return boards.map(stub)
  },
  setBackground: ({ id, background }) => {
    const b = boards.find((b) => b.id === id)
    if (b) { b.background = background; b.hasImage = false }
    emit('boards-changed', { boards: boards.map(stub) })
    return true
  },
  setBackgroundImage: () => { throw new Error('No images in the browser mock') },
  setLabelName: ({ boardId, color, name }) => {
    const b = boards.find((b) => b.id === boardId)
    if (b) { if (name) b.labels[color] = name; else delete b.labels[color] }
    return true
  },

  addList: ({ boardId, title }) => {
    const b = boards.find((b) => b.id === boardId)
    const list: List = { id: nextId++, title, cards: [] }
    b?.lists.push(list)
    return list
  },
  renameList: ({ id, title }) => { const l = findList(id); if (l) l.title = title; return true },
  deleteList: ({ id }) => {
    for (const b of boards) b.lists = b.lists.filter((l) => l.id !== id)
    return true
  },
  moveList: ({ id, index }) => {
    const b = boards.find((b) => b.lists.some((l) => l.id === id))
    if (!b) return true
    const from = b.lists.findIndex((l) => l.id === id)
    const [l] = b.lists.splice(from, 1)
    b.lists.splice(Math.min(index, b.lists.length), 0, l)
    return true
  },

  addCard: ({ listId, title }) => {
    const card = mkCard(listId, title)
    findList(listId)?.cards.push(card)
    return card
  },
  updateCard: ({ id, patch }) => {
    const f = findCard(id)
    if (f) Object.assign(f.c, patch)
    return f?.c ?? null
  },
  deleteCard: ({ id }) => {
    const f = findCard(id)
    if (f) f.l.cards = f.l.cards.filter((c) => c.id !== id)
    return true
  },
  moveCard: ({ id, listId, index }) => {
    const f = findCard(id)
    const dest = findList(listId)
    if (!f || !dest) return true
    f.l.cards = f.l.cards.filter((c) => c.id !== id)
    f.c.list_id = listId
    dest.cards.splice(Math.min(index, dest.cards.length), 0, f.c)
    return true
  },

  paletteInfo: () => ({
    boards: boards.map((b) => ({ id: b.id, title: b.title, lists: b.lists.map((l) => ({ id: l.id, title: l.title })) })),
    target: boards[0]?.lists[0]?.id ?? null,
  }),
  quickAdd: ({ listId, title }) => {
    const card = mkCard(listId, title)
    const l = findList(listId)
    l?.cards.push(card)
    const b = boards.find((b) => b.lists.some((x) => x.id === listId))
    emit('card-added', { boardId: b?.id, listId, card })
    return { board: b?.title ?? '?', list: l?.title ?? '?' }
  },

  'update.check': () => ({ available: false, current: '0.1.0', latest: null }),
  'update.install': () => { throw new Error('Not packaged (browser mock)') },
}

// calls log to the console so harness tests can watch the traffic
export const calls: Array<{ method: string; params: unknown }> = []

const mock = {
  api: {
    call: async (method: string, params?: unknown) => {
      const fn = api[method]
      if (!fn) throw new Error('mock: no api method ' + method)
      // the real bridge JSON-serializes both directions — stay faithful
      const p = params == null ? undefined : JSON.parse(JSON.stringify(params))
      calls.push({ method, params: p })
      const out = fn(p)
      return out == null ? out : JSON.parse(JSON.stringify(out))
    },
    on: (event: string, fn: (data: any) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn])
    },
  },
  log: (m: string) => console.log('[tiny.log]', m),
  quit: async () => {},
  notify: async () => true,
  win: {
    id: 'main',
    close: async () => {},
    setTitle: async () => {}, setSize: async () => {}, setChrome: async () => {},
    setAlwaysOnTop: async () => {}, setResizable: async () => {},
    center: async () => {}, show: async () => {}, hide: async () => {},
    openFile: async () => null,
    openFiles: async () => null,
    pickFolder: async () => '/tmp/trolley-devmock',
    saveFile: async () => null,
    alert: async (m: string, d?: string) => { window.alert(m + (d ? '\n' + d : '')); return true },
    confirm: async (m: string, o?: { detail?: string }) => window.confirm(m + (o?.detail ? '\n' + o.detail : '')),
    prompt: async (m: string, o?: { default?: string }) => window.prompt(m, o?.default ?? ''),
    onDrop: () => {},
  },
  menu: { set: async () => {}, on: () => {}, update: async () => {}, get: async () => ({ exists: false }), setContext: async () => {}, onContext: () => {} },
  store: { get: async () => null, set: async () => true, delete: async () => true, all: async () => ({}) },
  hotkey: { register: async () => {}, unregister: async () => {}, on: () => {} },
  theme: { get: async () => null, on: () => {} },
  app: { info: async () => ({ version: '0.1.0', tinyjs: 'mock', runtime: 'browser' }), setDockVisible: async () => {}, onOpenUrl: () => {}, onOpenFiles: () => {}, onNotificationClick: () => {} },
  tray: { set: async () => {}, remove: async () => {}, on: () => {}, onClick: () => {} },
}

;(window as any).tiny = mock
;(window as any).__mockCalls = calls
