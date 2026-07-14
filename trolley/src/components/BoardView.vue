<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { store, renameBoard, addList } from './../store'
import { setupBoardMonitor } from './../dnd'
import ListColumn from './ListColumn.vue'
import BackgroundPicker from './BackgroundPicker.vue'

const scroller = ref<HTMLElement | null>(null)
const cleanups: Array<() => void> = []

// board title rename (also reachable via Board ▸ Rename Board…)
const titleInput = ref<HTMLInputElement | null>(null)
const titleDraft = ref('')

function startRename() {
  if (!store.board) return
  titleDraft.value = store.board.title
  store.renamingBoard = true
  nextTick(() => titleInput.value?.select())
}
watch(() => store.renamingBoard, (on) => {
  if (on && !titleDraft.value) startRename()
})
function commitRename() {
  const t = titleDraft.value.trim()
  if (t && t !== store.board?.title) renameBoard(t)
  store.renamingBoard = false
  titleDraft.value = ''
}

// filter box (Board ▸ Filter Cards, ⌘F)
const filterInput = ref<HTMLInputElement | null>(null)
watch(() => store.wantFilter, () => filterInput.value?.focus())

// add-list composer (File ▸ New List, ⌘L)
const addingList = ref(false)
const listTitle = ref('')
const listInput = ref<HTMLInputElement | null>(null)
function openListComposer() {
  addingList.value = true
  nextTick(() => listInput.value?.focus())
}
watch(() => store.wantNewList, openListComposer)
async function commitList() {
  const t = listTitle.value.trim()
  if (t) {
    await addList(t)
    listTitle.value = ''
    nextTick(() => scroller.value?.scrollTo({ left: scroller.value.scrollWidth, behavior: 'smooth' }))
    listInput.value?.focus()
  } else {
    addingList.value = false
  }
}

onMounted(() => {
  cleanups.push(setupBoardMonitor())
  if (scroller.value) {
    cleanups.push(autoScrollForElements({ element: scroller.value }))
  }
})
onBeforeUnmount(() => cleanups.forEach((fn) => fn()))
</script>

<template>
  <main class="board" v-if="store.board">
    <header class="topbar">
      <input
        v-if="store.renamingBoard"
        ref="titleInput"
        v-model="titleDraft"
        class="title-input"
        @keydown.enter="commitRename"
        @keydown.esc="store.renamingBoard = false; titleDraft = ''"
        @blur="commitRename"
      />
      <h1 v-else class="title" title="Click to rename" @click="startRename">{{ store.board.title }}</h1>

      <span v-if="store.dueCount" class="due-pill" title="Cards due today (also in the menu bar)">
        ⏰ {{ store.dueCount }} due
      </span>

      <span class="spacer" />

      <input
        ref="filterInput"
        v-model="store.filter"
        class="filter"
        placeholder="Filter cards  ⌘F"
        @keydown.esc="store.filter = ''; ($event.target as HTMLElement).blur()"
      />
      <BackgroundPicker />
    </header>

    <div ref="scroller" class="lists">
      <ListColumn v-for="list in store.board.lists" :key="list.id" :list="list" />

      <div class="add-list">
        <button v-if="!addingList" class="add-list-btn" @click="openListComposer">＋ Add another list</button>
        <div v-else class="composer">
          <input
            ref="listInput"
            v-model="listTitle"
            placeholder="List name"
            @keydown.enter="commitList"
            @keydown.esc="addingList = false; listTitle = ''"
          />
          <div class="row">
            <button class="btn primary" @click="commitList">Add list</button>
            <button class="btn" @click="addingList = false; listTitle = ''">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.board {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--chrome-bg);
  backdrop-filter: blur(6px);
  color: var(--chrome-fg);
}
.title {
  font-size: 17px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  padding: 2px 8px;
  border-radius: 6px;
}
.title:hover { background: var(--chrome-hover); }
.title-input {
  font-size: 17px;
  font-weight: 700;
  padding: 2px 8px;
  border: none;
  border-radius: 6px;
  outline: 2px solid var(--accent);
  background: var(--panel-bg);
  color: var(--panel-fg);
}
.due-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.22);
}
.spacer { flex: 1; }
.filter {
  width: 190px;
  padding: 5px 10px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.22);
  color: var(--chrome-fg);
  outline: none;
}
.filter::placeholder { color: rgba(255, 255, 255, 0.75); }
.filter:focus { background: var(--panel-bg); color: var(--panel-fg); }
.filter:focus::placeholder { color: var(--panel-dim); }

.lists {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 18px;
  overflow-x: auto;
  overflow-y: hidden;
}

.add-list { flex: 0 0 272px; }
.add-list-btn {
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.18);
  color: var(--chrome-fg);
  font-weight: 500;
  backdrop-filter: blur(4px);
}
.add-list-btn:hover { background: rgba(255, 255, 255, 0.28); }
.composer {
  background: var(--list-bg);
  border-radius: 10px;
  padding: 8px;
  display: grid;
  gap: 8px;
}
.composer input {
  padding: 7px 9px;
  border: none;
  outline: 2px solid var(--accent);
  border-radius: 6px;
  background: var(--card-bg);
  color: var(--card-fg);
}
.composer .row { display: flex; gap: 6px; }
</style>
