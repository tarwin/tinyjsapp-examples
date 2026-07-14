<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { Card } from './../types'
import type { Edge } from './../dnd'
import { store, updateCard } from './../store'
import { LABEL_COLORS } from './../backgrounds'
import { dueState, formatDue } from './../dates'

const props = defineProps<{ card: Card; listId: number }>()

const el = ref<HTMLElement | null>(null)
const dragging = ref(false)
const edge = ref<Edge | null>(null)
const cleanups: Array<() => void> = []

const checklistDone = computed(() => props.card.checklist.filter((i) => i.done).length)
const due = computed(() => (props.card.due ? dueState(props.card.due, props.card.done) : null))

onMounted(() => {
  cleanups.push(
    draggable({
      element: el.value!,
      getInitialData: () => ({ type: 'card', cardId: props.card.id, listId: props.listId }),
      onDragStart: () => { dragging.value = true },
      onDrop: () => { dragging.value = false },
    }),
    dropTargetForElements({
      element: el.value!,
      getData: ({ input, element }) => attachClosestEdge(
        { type: 'card', cardId: props.card.id, listId: props.listId },
        { input, element, allowedEdges: ['top', 'bottom'] },
      ),
      canDrop: ({ source }) => source.data.type === 'card' && source.data.cardId !== props.card.id,
      getIsSticky: () => true,
      onDrag: ({ self }) => { edge.value = extractClosestEdge(self.data) },
      onDragLeave: () => { edge.value = null },
      onDrop: () => { edge.value = null },
    }),
  )
})
onBeforeUnmount(() => cleanups.forEach((fn) => fn()))
</script>

<template>
  <article
    ref="el"
    class="card"
    :class="{ dragging, done: card.done, 'edge-top': edge === 'top', 'edge-bottom': edge === 'bottom' }"
    @click="store.modalCardId = card.id"
  >
    <div v-if="card.labels.length" class="labels">
      <span
        v-for="l in card.labels"
        :key="l"
        class="label"
        :style="{ background: LABEL_COLORS[l] }"
        :title="store.board?.labels[l] || l"
      >{{ store.board?.labels[l] || '' }}</span>
    </div>

    <div class="row">
      <button
        class="check"
        :class="{ on: card.done }"
        :title="card.done ? 'Mark not done' : 'Mark done'"
        @click.stop="updateCard(card.id, { done: !card.done })"
      >✓</button>
      <span class="title">{{ card.title }}</span>
    </div>

    <div v-if="due || card.notes || card.checklist.length" class="badges">
      <span v-if="due" class="badge due" :class="due.state">⏰ {{ formatDue(card.due!) }}</span>
      <span v-if="card.notes" class="badge" title="Has notes">≡</span>
      <span
        v-if="card.checklist.length"
        class="badge"
        :class="{ complete: checklistDone === card.checklist.length }"
      >☑ {{ checklistDone }}/{{ card.checklist.length }}</span>
    </div>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  background: var(--card-bg);
  color: var(--card-fg);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
  padding: 8px 10px;
  display: grid;
  gap: 6px;
}
.card:hover { outline: 2px solid var(--accent); }
.card.dragging { opacity: 0.4; }
.card.done .title { color: var(--card-dim); }

/* drop indicator lines */
.card.edge-top::before, .card.edge-bottom::after {
  content: '';
  position: absolute;
  left: 2px; right: 2px;
  height: 3px;
  border-radius: 2px;
  background: var(--accent);
  z-index: 1;
}
.card.edge-top::before { top: -6px; }
.card.edge-bottom::after { bottom: -6px; }

.labels { display: flex; flex-wrap: wrap; gap: 4px; }
.label {
  min-width: 32px;
  height: 14px;
  border-radius: 4px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  padding: 0 6px;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
}

.row { display: flex; align-items: flex-start; gap: 6px; }
.check {
  flex: none;
  width: 18px; height: 18px;
  margin-top: 1px;
  border-radius: 50%;
  border: 1.5px solid var(--card-dim);
  color: transparent;
  font-size: 11px;
  line-height: 1;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 0.12s;
}
.card:hover .check { opacity: 1; }
.check.on {
  opacity: 1;
  background: #4bab64;
  border-color: #4bab64;
  color: #fff;
}
.title { font-size: 13.5px; overflow-wrap: anywhere; }

.badges { display: flex; flex-wrap: wrap; gap: 6px; }
.badge {
  font-size: 11.5px;
  color: var(--card-dim);
  border-radius: 4px;
  padding: 1px 5px;
}
.badge.complete { background: #4bab64; color: #fff; }
.badge.due.overdue { background: var(--danger); color: #fff; }
.badge.due.today { background: #d9b032; color: #1d2125; }
.badge.due.done { background: #4bab64; color: #fff; }
</style>
