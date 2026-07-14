<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { store, openBoard, addBoard, checkUpdates } from './../store'
import { backgroundCss } from './../backgrounds'

const adding = ref(false)
const title = ref('')
const input = ref<HTMLInputElement | null>(null)

function openComposer() {
  adding.value = true
  nextTick(() => input.value?.focus())
}
watch(() => store.wantNewBoard, openComposer)

async function commit() {
  const t = title.value.trim()
  if (t) {
    await addBoard(t)
    title.value = ''
  }
  adding.value = false
}

const swatch = (b: { background: string; hasImage: boolean }) =>
  b.hasImage ? 'linear-gradient(135deg, #888, #555)' : backgroundCss(b.background)
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="logo">🛒</span>
      <b>Trolley</b>
    </div>

    <div class="section">Boards</div>
    <nav class="boards">
      <button
        v-for="b in store.boards"
        :key="b.id"
        class="board"
        :class="{ active: b.id === store.board?.id }"
        @click="openBoard(b.id)"
      >
        <span class="swatch" :style="{ background: swatch(b) }" />
        <span class="name">{{ b.title }}</span>
      </button>

      <input
        v-if="adding"
        ref="input"
        v-model="title"
        class="new-board"
        placeholder="Board name"
        @keydown.enter="commit"
        @keydown.esc="adding = false; title = ''"
        @blur="commit"
      />
      <button v-else class="board add" @click="openComposer">＋ New board</button>
    </nav>

    <footer>
      <button
        v-if="store.update?.available"
        class="update-pill"
        title="A new version is ready"
        @click="store.settingsOpen = true"
      >⬆ Update to {{ store.update.latest }}</button>
      <button class="gear" title="Settings (⌘,)" @click="store.settingsOpen = true">⚙ Settings</button>
      <span class="ver" @click="checkUpdates(true)">v{{ store.version }}</span>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  flex: 0 0 216px;
  display: flex;
  flex-direction: column;
  background: var(--chrome-bg);
  backdrop-filter: blur(10px);
  color: var(--chrome-fg);
  padding: 12px 10px;
  gap: 4px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  padding: 2px 8px 10px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.logo { font-size: 18px; }

.section {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.8;
  padding: 4px 8px;
}
.boards {
  flex: 1;
  overflow-y: auto;
  display: grid;
  gap: 2px;
  align-content: start;
}
.board {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 7px;
  color: var(--chrome-fg);
  text-align: left;
  font-weight: 500;
}
.board:hover { background: var(--chrome-hover); }
.board.active { background: rgba(255, 255, 255, 0.28); }
.swatch {
  flex: none;
  width: 20px; height: 15px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
}
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board.add { opacity: 0.85; }
.new-board {
  margin: 2px 4px;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  outline: 2px solid var(--accent);
  background: var(--panel-bg);
  color: var(--panel-fg);
}

footer {
  display: grid;
  gap: 6px;
  padding-top: 8px;
}
.update-pill {
  background: #4bab64;
  color: #fff;
  font-weight: 600;
  font-size: 12px;
  border-radius: 99px;
  padding: 5px 10px;
}
.gear {
  text-align: left;
  color: var(--chrome-fg);
  padding: 5px 8px;
  border-radius: 7px;
  font-weight: 500;
}
.gear:hover { background: var(--chrome-hover); }
.ver {
  font-size: 11px;
  opacity: 0.7;
  padding: 0 8px;
  cursor: default;
}
.ver:hover { text-decoration: underline; }
</style>
