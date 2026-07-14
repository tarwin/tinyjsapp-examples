<script setup lang="ts">
// The quick-add palette — a small frameless HUD window the backend opens on
// the global hotkey (⌃⌥T), the tray menu, or File ▸ Quick Add. Type a title,
// pick where it goes (remembered), Enter files it. Esc or clicking away closes.
import { computed, onMounted, ref } from 'vue'
import type { PaletteBoard } from './types'

const boards = ref<PaletteBoard[]>([])
const boardId = ref<number | null>(null)
const listId = ref<number | null>(null)
const title = ref('')
const flash = ref('')
const input = ref<HTMLInputElement | null>(null)

const lists = computed(() => boards.value.find((b) => b.id === boardId.value)?.lists ?? [])

function pickBoard(id: number) {
  boardId.value = id
  listId.value = lists.value[0]?.id ?? null
}

async function load() {
  const info = await tiny.api.call('paletteInfo')
  boards.value = info.boards
  // aim at the last-used list if it still exists
  const target = info.boards.find((b: PaletteBoard) => b.lists.some((l) => l.id === info.target))
  if (target) {
    boardId.value = target.id
    listId.value = info.target
  } else if (info.boards[0]) {
    pickBoard(info.boards[0].id)
  }
}

async function add() {
  const t = title.value.trim()
  if (!t || listId.value == null) return
  const { board, list } = await tiny.api.call('quickAdd', { listId: listId.value, title: t })
  title.value = ''
  flash.value = `Added to ${board} ▸ ${list} ✓`
  setTimeout(() => { flash.value = '' }, 1800)
}

onMounted(async () => {
  // in a plain browser (dev mock) there's no vibrancy — paint our own backdrop
  if (!window.__TINY_WIN) document.body.classList.add('no-vibrancy')

  // dress the window: frameless translucent HUD, floating above everything
  tiny.win.setChrome({ frame: false, vibrancy: 'hud' })
  tiny.win.setAlwaysOnTop(true)
  tiny.win.setResizable(false)

  await load()
  input.value?.focus()

  // reopened while already up (hotkey again): reset and refocus
  tiny.api.on('palette-show', () => {
    load()
    title.value = ''
    input.value?.focus()
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') tiny.win.close()
  })
  window.addEventListener('blur', () => tiny.win.close())
})
</script>

<template>
  <div class="palette">
    <div class="row top">
      <span class="logo">🛒</span>
      <input
        ref="input"
        v-model="title"
        placeholder="Add a card…"
        @keydown.enter="add"
      />
    </div>
    <div class="row bottom">
      <select :value="boardId ?? undefined" @change="pickBoard(Number(($event.target as HTMLSelectElement).value))">
        <option v-for="b in boards" :key="b.id" :value="b.id">{{ b.title }}</option>
      </select>
      <span class="sep">▸</span>
      <select v-model="listId">
        <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.title }}</option>
      </select>
      <span class="flash" :class="{ show: flash }">{{ flash }}</span>
      <span class="hint">⏎ add · esc close</span>
    </div>
  </div>
</template>

<style>
/* vibrancy shows through the page — keep everything translucent */
html, body, #app { height: 100%; background: transparent; }
body {
  margin: 0;
  font: 14px -apple-system, BlinkMacSystemFont, sans-serif;
  color: #f2f4f8;
  overflow: hidden;
  -webkit-user-select: none;
  user-select: none;
}
body.no-vibrancy { background: #262a33; }

.palette {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 14px 16px;
}
.row { display: flex; align-items: center; gap: 8px; }

.logo { font-size: 20px; }
.top input {
  flex: 1;
  font-size: 17px;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  outline: none;
  -webkit-user-select: text;
  user-select: text;
}
.top input::placeholder { color: rgba(255, 255, 255, 0.55); }
.top input:focus { background: rgba(255, 255, 255, 0.2); }

.bottom select {
  max-width: 170px;
  border: none;
  border-radius: 6px;
  padding: 3px 6px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 12.5px;
}
.sep { opacity: 0.6; font-size: 12px; }
.flash {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: #8fe3a8;
  opacity: 0;
  transition: opacity 0.15s;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.flash.show { opacity: 1; }
.hint { font-size: 11.5px; opacity: 0.55; }
</style>
