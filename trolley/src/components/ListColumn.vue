<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import {
  DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from 'radix-vue'
import type { List } from './../types'
import type { Edge } from './../dnd'
import { store, addCard, renameList, deleteList } from './../store'
import CardItem from './CardItem.vue'

const props = defineProps<{ list: List }>()

const root = ref<HTMLElement | null>(null)
const header = ref<HTMLElement | null>(null)
const cardsEl = ref<HTMLElement | null>(null)
const cleanups: Array<() => void> = []

const dragging = ref(false)
const edge = ref<Edge | null>(null) // list-reorder indicator
const isFirst = computed(() => store.board?.lists[0]?.id === props.list.id)

const visibleCards = computed(() => {
  const q = store.filter.trim().toLowerCase()
  if (!q) return props.list.cards
  return props.list.cards.filter((c) => {
    const names = c.labels.map((l) => store.board?.labels[l] ?? l).join(' ')
    return (c.title + ' ' + c.notes + ' ' + names).toLowerCase().includes(q)
  })
})

// inline rename
const renaming = ref(false)
const draft = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
function startRename() {
  draft.value = props.list.title
  renaming.value = true
  nextTick(() => titleInput.value?.select())
}
function commitRename() {
  const t = draft.value.trim()
  if (t && t !== props.list.title) renameList(props.list.id, t)
  renaming.value = false
}

// add-card composer
const composing = ref(false)
const cardTitle = ref('')
const cardInput = ref<HTMLTextAreaElement | null>(null)
function openComposer() {
  composing.value = true
  nextTick(() => {
    cardInput.value?.focus()
    cardsEl.value?.scrollTo({ top: cardsEl.value.scrollHeight })
  })
}
// File ▸ New Card targets the first list
watch(() => store.wantNewCard, () => { if (isFirst.value) openComposer() })
async function commitCard() {
  const t = cardTitle.value.trim()
  if (t) {
    await addCard(props.list.id, t)
    cardTitle.value = ''
    nextTick(() => cardsEl.value?.scrollTo({ top: cardsEl.value.scrollHeight }))
    cardInput.value?.focus() // Trello keeps the composer open for the next card
  } else {
    composing.value = false
  }
}

async function removeList() {
  if (props.list.cards.length) {
    const ok = await tiny.win.confirm(`Delete “${props.list.title}”?`, {
      detail: `Its ${props.list.cards.length} card(s) go with it.`, ok: 'Delete List',
    })
    if (!ok) return
  }
  deleteList(props.list.id)
}

onMounted(() => {
  const el = root.value!
  cleanups.push(
    // the whole column drags by its header
    draggable({
      element: el,
      dragHandle: header.value!,
      getInitialData: () => ({ type: 'list', listId: props.list.id }),
      onDragStart: () => { dragging.value = true },
      onDrop: () => { dragging.value = false },
    }),
    // …and is a drop target for other columns (left/right halves)
    dropTargetForElements({
      element: el,
      getData: ({ input, element }) =>
        attachClosestEdge({ type: 'list', listId: props.list.id }, { input, element, allowedEdges: ['left', 'right'] }),
      canDrop: ({ source }) => source.data.type === 'list' && source.data.listId !== props.list.id,
      onDrag: ({ self }) => { edge.value = extractClosestEdge(self.data) },
      onDragLeave: () => { edge.value = null },
      onDrop: () => { edge.value = null },
    }),
    // card drops on the list body (empty space = append)
    dropTargetForElements({
      element: cardsEl.value!,
      getData: () => ({ type: 'cards', listId: props.list.id }),
      canDrop: ({ source }) => source.data.type === 'card',
    }),
    autoScrollForElements({ element: cardsEl.value! }),
  )
})
onBeforeUnmount(() => cleanups.forEach((fn) => fn()))
</script>

<template>
  <section
    ref="root"
    class="list"
    :class="{ dragging, 'edge-left': edge === 'left', 'edge-right': edge === 'right' }"
  >
    <header ref="header" class="head">
      <input
        v-if="renaming"
        ref="titleInput"
        v-model="draft"
        @keydown.enter="commitRename"
        @keydown.esc="renaming = false"
        @blur="commitRename"
      />
      <h2 v-else @click="startRename" title="Click to rename">{{ list.title }}</h2>
      <span class="count">{{ list.cards.length }}</span>

      <DropdownMenuRoot>
        <DropdownMenuTrigger class="more" aria-label="List actions">⋯</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="menu" :side-offset="4" align="start">
            <DropdownMenuItem class="menu-item" @select="openComposer">Add card</DropdownMenuItem>
            <DropdownMenuItem class="menu-item" @select="startRename">Rename list</DropdownMenuItem>
            <DropdownMenuSeparator class="menu-sep" />
            <DropdownMenuItem class="menu-item danger" @select="removeList">Delete list…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </header>

    <div ref="cardsEl" class="cards">
      <CardItem v-for="card in visibleCards" :key="card.id" :card="card" :list-id="list.id" />
      <p v-if="store.filter && !visibleCards.length" class="none">No matching cards</p>
    </div>

    <footer class="foot">
      <button v-if="!composing" class="add" @click="openComposer">＋ Add a card</button>
      <div v-else class="composer">
        <textarea
          ref="cardInput"
          v-model="cardTitle"
          rows="2"
          placeholder="Card title…"
          @keydown.enter.prevent="commitCard"
          @keydown.esc="composing = false; cardTitle = ''"
        />
        <div class="row">
          <button class="btn primary" @click="commitCard">Add card</button>
          <button class="btn" @click="composing = false; cardTitle = ''">Cancel</button>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.list {
  flex: 0 0 272px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--list-bg);
  color: var(--list-fg);
  border-radius: 10px;
  box-shadow: var(--card-shadow);
  position: relative;
}
.list.dragging { opacity: 0.4; }
/* list-reorder indicator lines */
.list.edge-left::before, .list.edge-right::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
}
.list.edge-left::before { left: -8px; }
.list.edge-right::after { right: -8px; }

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 8px 6px 14px;
}
.head h2 {
  font-size: 14px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head input {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  outline: 2px solid var(--accent);
  background: var(--card-bg);
  color: var(--card-fg);
}
.count { font-size: 12px; color: var(--card-dim); }
.more {
  padding: 2px 8px;
  border-radius: 6px;
  color: var(--card-dim);
  font-weight: 700;
}
.more:hover { background: var(--panel-hover); }

.cards {
  flex: 1;
  min-height: 8px;
  overflow-y: auto;
  padding: 4px 8px;
  display: grid;
  gap: 8px;
  align-content: start;
}
.none { font-size: 12px; color: var(--card-dim); padding: 4px 6px; }

.foot { padding: 6px 8px 10px; }
.add {
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--card-dim);
  font-weight: 500;
}
.add:hover { background: var(--panel-hover); color: var(--panel-fg); }
.composer { display: grid; gap: 6px; }
.composer textarea {
  resize: none;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  outline: 2px solid var(--accent);
  background: var(--card-bg);
  color: var(--card-fg);
  box-shadow: var(--card-shadow);
}
.composer .row { display: flex; gap: 6px; }
</style>

<style>
/* radix dropdown content mounts in a portal — unscoped */
.menu {
  min-width: 160px;
  background: var(--panel-bg);
  color: var(--panel-fg);
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 4px;
  z-index: 50;
}
.menu-item {
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 5px;
  outline: none;
}
.menu-item[data-highlighted] { background: var(--panel-hover); }
.menu-item.danger { color: var(--danger); }
.menu-sep { height: 1px; background: var(--panel-line); margin: 4px 2px; }
</style>
