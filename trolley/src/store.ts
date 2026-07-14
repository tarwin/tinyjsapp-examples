// One reactive store for the board window. The backend owns the data; this
// mirrors it, applies mutations optimistically, and listens for pushes from
// other windows (the quick-add palette) and backend events (due sweep,
// notification clicks).

import { reactive } from 'vue'
import type { Board, BoardStub, Card } from './types'

interface UpdateInfo {
  available: boolean
  current: string
  latest: string | null
  error?: string
}

export const store = reactive({
  ready: false,
  needsSetup: false,
  suggestedPath: '',

  path: '',
  version: '',
  hotkey: '',
  boards: [] as BoardStub[],
  board: null as Board | null,
  bgUri: null as string | null,
  dueCount: 0,

  // ui state, mostly driven by menu events
  filter: '',
  modalCardId: null as number | null,
  settingsOpen: false,
  bgPickerOpen: false,
  renamingBoard: false,
  wantNewList: 0, // bump to focus the add-list composer
  wantNewCard: 0, // bump to open the first list's composer
  wantFilter: 0, // bump to focus the filter box
  wantNewBoard: 0, // bump to focus the sidebar's new-board input
  update: null as UpdateInfo | null,
  updateBusy: false,
})

const call = (method: string, params?: unknown) => tiny.api.call(method, params)

function applyState(s: any) {
  store.path = s.path
  store.boards = s.boards
  store.version = s.version
  store.hotkey = s.hotkey
  store.needsSetup = false
}

export async function boot() {
  const s = await call('boot')
  if (s.needsSetup) {
    store.needsSetup = true
    store.suggestedPath = s.suggestedPath
    store.ready = true
    return
  }
  applyState(s)
  const first = store.boards.find((b) => b.id === s.lastBoard) ?? store.boards[0]
  if (first) await openBoard(first.id)
  store.ready = true
}

export async function setup(path: string) {
  applyState(await call('setup', { path }))
  if (store.boards[0]) await openBoard(store.boards[0].id)
}

export async function openBoard(id: number) {
  if (store.board?.id === id) return
  const board: Board | null = await call('board', { id })
  if (!board) return
  store.board = board
  store.bgUri = board.hasImage ? await call('background', { id }) : null
  store.filter = ''
}

const inBoard = (listId: number) => store.board?.lists.find((l) => l.id === listId)
function findCard(id: number): { card: Card; list: { cards: Card[] } } | null {
  for (const list of store.board?.lists ?? []) {
    const card = list.cards.find((c) => c.id === id)
    if (card) return { card, list }
  }
  return null
}

// ---- boards ----------------------------------------------------------------

export async function addBoard(title: string) {
  const board: Board = await call('addBoard', { title })
  store.board = board
  store.bgUri = null
}

export async function renameBoard(title: string) {
  if (!store.board) return
  store.board.title = title
  await call('renameBoard', { id: store.board.id, title })
}

export async function deleteBoard() {
  if (!store.board) return
  const boards: BoardStub[] = await call('deleteBoard', { id: store.board.id })
  store.board = null
  store.bgUri = null
  if (boards[0]) await openBoard(boards[0].id)
}

export async function setBackground(key: string) {
  if (!store.board) return
  store.board.background = key
  store.board.hasImage = false
  store.bgUri = null
  await call('setBackground', { id: store.board.id, background: key })
}

export async function setBackgroundImage(path: string) {
  if (!store.board) return
  const uri = await call('setBackgroundImage', { id: store.board.id, path })
  store.board.background = 'image'
  store.board.hasImage = true
  store.bgUri = uri
}

export async function setLabelName(color: string, name: string) {
  if (!store.board) return
  if (name) store.board.labels[color] = name
  else delete store.board.labels[color]
  await call('setLabelName', { boardId: store.board.id, color, name })
}

// ---- lists -----------------------------------------------------------------

export async function addList(title: string) {
  if (!store.board) return
  const list = await call('addList', { boardId: store.board.id, title })
  store.board.lists.push(list)
}

export async function renameList(id: number, title: string) {
  const list = inBoard(id)
  if (list) list.title = title
  await call('renameList', { id, title })
}

export async function deleteList(id: number) {
  if (!store.board) return
  store.board.lists = store.board.lists.filter((l) => l.id !== id)
  await call('deleteList', { id })
}

export async function moveList(id: number, index: number) {
  if (!store.board) return
  const lists = store.board.lists
  const from = lists.findIndex((l) => l.id === id)
  if (from < 0) return
  const [list] = lists.splice(from, 1)
  lists.splice(Math.max(0, Math.min(index, lists.length)), 0, list)
  await call('moveList', { id, index })
}

// ---- cards -----------------------------------------------------------------

export async function addCard(listId: number, title: string) {
  const list = inBoard(listId)
  const card: Card = await call('addCard', { listId, title })
  list?.cards.push(card)
}

export async function updateCard(id: number, patch: Partial<Card>) {
  const found = findCard(id)
  if (found) Object.assign(found.card, patch)
  const fresh: Card = await call('updateCard', { id, patch })
  if (found) Object.assign(found.card, fresh)
}

export async function deleteCard(id: number) {
  const found = findCard(id)
  if (found) found.list.cards = found.list.cards.filter((c) => c.id !== id)
  if (store.modalCardId === id) store.modalCardId = null
  await call('deleteCard', { id })
}

export async function moveCard(id: number, listId: number, index: number) {
  const found = findCard(id)
  const dest = inBoard(listId)
  if (!found || !dest) return
  found.list.cards = found.list.cards.filter((c) => c.id !== id)
  found.card.list_id = listId
  dest.cards.splice(Math.max(0, Math.min(index, dest.cards.length)), 0, found.card)
  await call('moveCard', { id, listId, index })
}

// ---- auto-update -------------------------------------------------------------

export async function checkUpdates(interactive: boolean) {
  store.updateBusy = interactive
  try {
    const r = await call('update.check')
    store.update = { ...r, error: undefined }
  } catch (e: any) {
    // dev runs and offline checks land here — only surface it when asked
    store.update = interactive
      ? { available: false, current: store.version, latest: null, error: String(e?.message ?? e) }
      : null
  }
  store.updateBusy = false
  if (interactive) store.settingsOpen = true
}

export async function installUpdate() {
  store.updateBusy = true
  try {
    await call('update.install') // verifies, swaps the .app, relaunches
  } catch (e: any) {
    if (store.update) store.update.error = String(e?.message ?? e)
  }
  store.updateBusy = false
}

// ---- backend pushes ----------------------------------------------------------

export function listen() {
  tiny.api.on('boards-changed', ({ boards }: { boards: BoardStub[] }) => {
    store.boards = boards
    const current = boards.find((b) => b.id === store.board?.id)
    if (store.board && current) store.board.title = current.title
  })

  tiny.api.on('card-added', ({ boardId, listId, card }: { boardId: number; listId: number; card: Card }) => {
    if (store.board?.id !== boardId) return
    const list = inBoard(listId)
    if (list && !list.cards.some((c) => c.id === card.id)) list.cards.push(card)
  })

  tiny.api.on('due-badge', ({ count }: { count: number }) => { store.dueCount = count })

  tiny.api.on('reveal-card', async ({ boardId, cardId }: { boardId: number; cardId: number }) => {
    if (store.board?.id !== boardId) await openBoard(boardId)
    store.modalCardId = cardId
  })
}
