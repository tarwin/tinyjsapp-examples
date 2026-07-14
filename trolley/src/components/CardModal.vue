<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogClose,
} from 'radix-vue'
import { store, updateCard, deleteCard, setLabelName } from './../store'
import { LABEL_COLORS } from './../backgrounds'
import { toLocalInput, fromLocalInput, formatDue, dueState } from './../dates'
import type { Card, ChecklistItem } from './../types'

const open = computed({
  get: () => store.modalCardId != null,
  set: (v: boolean) => { if (!v) store.modalCardId = null },
})

const found = computed(() => {
  for (const list of store.board?.lists ?? []) {
    const card = list.cards.find((c) => c.id === store.modalCardId)
    if (card) return { card, list }
  }
  return null
})
const card = computed<Card | null>(() => found.value?.card ?? null)

// drafts commit on blur / enter
const titleDraft = ref('')
const notesDraft = ref('')
watch(card, (c) => {
  if (c) { titleDraft.value = c.title; notesDraft.value = c.notes }
}, { immediate: true })

function commitTitle() {
  const t = titleDraft.value.trim()
  if (card.value && t && t !== card.value.title) updateCard(card.value.id, { title: t })
}
function commitNotes() {
  if (card.value && notesDraft.value !== card.value.notes) {
    updateCard(card.value.id, { notes: notesDraft.value })
  }
}

// due date
const dueInput = computed(() => (card.value?.due ? toLocalInput(card.value.due) : ''))
function setDue(e: Event) {
  if (!card.value) return
  const v = (e.target as HTMLInputElement).value
  updateCard(card.value.id, { due: v ? fromLocalInput(v) : null })
}

// labels: click toggles, double-click names (native prompt)
function toggleLabel(color: string) {
  if (!card.value) return
  const labels = card.value.labels.includes(color)
    ? card.value.labels.filter((l) => l !== color)
    : [...card.value.labels, color]
  updateCard(card.value.id, { labels })
}
async function nameLabel(color: string) {
  const current = store.board?.labels[color] ?? ''
  const name = await tiny.win.prompt(`Name the ${color} label`, { default: current, ok: 'Save' })
  if (name !== null) setLabelName(color, name.trim())
}

// checklist
const newItem = ref('')
function saveChecklist(items: ChecklistItem[]) {
  if (card.value) updateCard(card.value.id, { checklist: items })
}
function addItem() {
  const t = newItem.value.trim()
  if (!t || !card.value) return
  saveChecklist([...card.value.checklist, { text: t, done: false }])
  newItem.value = ''
}
function toggleItem(i: number) {
  if (!card.value) return
  const items = card.value.checklist.map((it, n) => (n === i ? { ...it, done: !it.done } : it))
  saveChecklist(items)
}
function editItem(i: number, e: Event) {
  if (!card.value) return
  const text = (e.target as HTMLInputElement).value.trim()
  const items = text
    ? card.value.checklist.map((it, n) => (n === i ? { ...it, text } : it))
    : card.value.checklist.filter((_, n) => n !== i)
  saveChecklist(items)
}
function removeItem(i: number) {
  if (!card.value) return
  saveChecklist(card.value.checklist.filter((_, n) => n !== i))
}
const progress = computed(() => {
  const c = card.value
  if (!c || !c.checklist.length) return 0
  return Math.round((c.checklist.filter((i) => i.done).length / c.checklist.length) * 100)
})

async function removeCard() {
  if (!card.value) return
  const ok = await tiny.win.confirm(`Delete “${card.value.title}”?`, { ok: 'Delete Card' })
  if (ok) deleteCard(card.value.id)
}

const due = computed(() => (card.value?.due ? dueState(card.value.due, card.value.done) : null))
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent
        v-if="card"
        class="dialog-content card-modal"
        :aria-describedby="undefined"
        @open-auto-focus.prevent
      >
        <header class="head">
          <button
            class="big-check"
            :class="{ on: card.done }"
            @click="updateCard(card.id, { done: !card.done })"
          >✓</button>
          <textarea
            v-model="titleDraft"
            class="title"
            rows="1"
            @keydown.enter.prevent="commitTitle(); ($event.target as HTMLElement).blur()"
            @blur="commitTitle"
          />
          <DialogClose class="close" aria-label="Close">✕</DialogClose>
        </header>
        <DialogTitle class="sr-only">{{ card.title }}</DialogTitle>
        <p class="in-list">in list <b>{{ found?.list.title }}</b></p>

        <section>
          <h3>Labels <span class="hint">click to toggle · double-click to name</span></h3>
          <div class="labels">
            <button
              v-for="(hex, color) in LABEL_COLORS"
              :key="color"
              class="label"
              :class="{ on: card.labels.includes(color as string) }"
              :style="{ background: hex }"
              @click="toggleLabel(color as string)"
              @dblclick="nameLabel(color as string)"
            >
              <span class="tick" v-if="card.labels.includes(color as string)">✓</span>
              {{ store.board?.labels[color] ?? '' }}
            </button>
          </div>
        </section>

        <section>
          <h3>Due</h3>
          <div class="due-row">
            <input type="datetime-local" :value="dueInput" @change="setDue" />
            <button v-if="card.due" class="btn" @click="updateCard(card.id, { due: null })">Clear</button>
            <span v-if="card.due && due" class="due-note" :class="due.state">
              {{ due.state === 'overdue' ? 'overdue' : due.state === 'today' ? 'due today' : formatDue(card.due) }}
            </span>
          </div>
        </section>

        <section>
          <h3>Notes</h3>
          <textarea
            v-model="notesDraft"
            class="notes"
            rows="4"
            placeholder="Add details…"
            @blur="commitNotes"
          />
        </section>

        <section>
          <h3>Checklist <span v-if="card.checklist.length" class="hint">{{ progress }}%</span></h3>
          <div v-if="card.checklist.length" class="bar"><div class="fill" :style="{ width: progress + '%' }" /></div>
          <ul class="items">
            <li v-for="(item, i) in card.checklist" :key="i">
              <input type="checkbox" :checked="item.done" @change="toggleItem(i)" />
              <input class="text" :class="{ done: item.done }" :value="item.text" @change="editItem(i, $event)" />
              <button class="x" title="Remove" @click="removeItem(i)">✕</button>
            </li>
          </ul>
          <input
            v-model="newItem"
            class="add-item"
            placeholder="Add an item…"
            @keydown.enter="addItem"
          />
        </section>

        <footer class="foot">
          <span class="created">Created {{ new Date(card.created_at).toLocaleDateString() }}</span>
          <button class="btn danger" @click="removeCard">Delete card</button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.card-modal { display: grid; gap: 16px; }

.head { display: flex; align-items: flex-start; gap: 10px; }
.big-check {
  flex: none;
  width: 24px; height: 24px;
  margin-top: 4px;
  border-radius: 50%;
  border: 2px solid var(--panel-dim);
  color: transparent;
  display: grid;
  place-items: center;
  font-size: 13px;
}
.big-check.on { background: #4bab64; border-color: #4bab64; color: #fff; }
.title {
  flex: 1;
  font-size: 18px;
  font-weight: 700;
  border: none;
  resize: none;
  background: none;
  outline: none;
  border-radius: 6px;
  padding: 2px 6px;
}
.title:focus { outline: 2px solid var(--accent); background: var(--panel-hover); }
.close {
  flex: none;
  font-size: 14px;
  color: var(--panel-dim);
  padding: 4px 8px;
  border-radius: 6px;
}
.close:hover { background: var(--panel-hover); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.in-list { margin-top: -10px; font-size: 12.5px; color: var(--panel-dim); padding-left: 40px; }

h3 {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--panel-dim);
  margin-bottom: 8px;
}
.hint { font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 6px; }

.labels { display: flex; flex-wrap: wrap; gap: 6px; }
.label {
  min-width: 52px;
  padding: 4px 10px;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
  opacity: 0.45;
}
.label.on { opacity: 1; }
.label .tick { margin-right: 3px; }

.due-row { display: flex; align-items: center; gap: 8px; }
.due-row input {
  padding: 5px 8px;
  border: 1px solid var(--panel-line);
  border-radius: 6px;
  background: var(--panel-bg);
  color: var(--panel-fg);
}
.due-note { font-size: 12px; font-weight: 600; }
.due-note.overdue { color: var(--danger); }
.due-note.today { color: #b58a10; }

.notes {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  background: var(--panel-hover);
  padding: 10px 12px;
  outline: none;
}
.notes:focus { border-color: var(--accent); background: var(--panel-bg); }

.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--panel-hover);
  margin-bottom: 8px;
  overflow: hidden;
}
.fill { height: 100%; background: #4bab64; transition: width 0.15s; }
.items { list-style: none; display: grid; gap: 4px; }
.items li { display: flex; align-items: center; gap: 8px; }
.items .text {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  border-radius: 5px;
  padding: 3px 6px;
}
.items .text:focus { background: var(--panel-hover); }
.items .text.done { text-decoration: line-through; color: var(--panel-dim); }
.items .x { color: var(--panel-dim); padding: 2px 6px; border-radius: 5px; visibility: hidden; }
.items li:hover .x { visibility: visible; }
.items .x:hover { background: var(--panel-hover); color: var(--danger); }
.add-item {
  width: 100%;
  margin-top: 6px;
  padding: 7px 10px;
  border: 1px dashed var(--panel-line);
  border-radius: 7px;
  background: none;
  outline: none;
}
.add-item:focus { border-color: var(--accent); border-style: solid; }

.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--panel-line);
  padding-top: 12px;
}
.created { font-size: 12px; color: var(--panel-dim); }
</style>
