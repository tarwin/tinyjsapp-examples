<script setup lang="ts">
import { computed } from 'vue'
import {
  DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogClose,
} from 'radix-vue'
import { store, checkUpdates, installUpdate } from './../store'

const open = computed({
  get: () => store.settingsOpen,
  set: (v: boolean) => { store.settingsOpen = v },
})

const reveal = () => tiny.api.call('revealStorage')

async function moveStorage() {
  const dir = await tiny.win.pickFolder()
  if (!dir) return
  try {
    const s = await tiny.api.call('moveStorage', { path: dir })
    store.path = s.path
  } catch (e: any) {
    await tiny.win.alert('Could not move storage', String(e?.message ?? e))
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content settings" :aria-describedby="undefined">
        <header class="head">
          <DialogTitle>Settings</DialogTitle>
          <DialogClose class="close" aria-label="Close">✕</DialogClose>
        </header>

        <section>
          <h3>Storage</h3>
          <p class="desc">Everything lives in one SQLite file (plus board images) here:</p>
          <div class="path">{{ store.path }}</div>
          <div class="row">
            <button class="btn" @click="reveal">Reveal in Finder</button>
            <button class="btn" @click="moveStorage">Move…</button>
          </div>
        </section>

        <section>
          <h3>Quick Add</h3>
          <p class="desc">
            Press <b class="kbd">{{ store.hotkey }}</b> in any app to jot a card
            without switching to Trolley. It's also in the 🛒 menu-bar item —
            which doubles as the due-today tally.
          </p>
        </section>

        <section>
          <h3>Updates</h3>
          <p class="desc">
            You have <b>{{ store.version }}</b>.
            <template v-if="store.update?.available">
              <b class="ok">{{ store.update.latest }} is available.</b>
            </template>
            <template v-else-if="store.update && !store.update.error">
              That's the latest.
            </template>
          </p>
          <p v-if="store.update?.error" class="err">{{ store.update.error }}</p>
          <div class="row">
            <button v-if="store.update?.available" class="btn primary" :disabled="store.updateBusy" @click="installUpdate">
              {{ store.updateBusy ? 'Installing…' : 'Install & Relaunch' }}
            </button>
            <button v-else class="btn" :disabled="store.updateBusy" @click="checkUpdates(true)">
              {{ store.updateBusy ? 'Checking…' : 'Check for Updates' }}
            </button>
          </div>
        </section>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.settings { display: grid; gap: 18px; width: min(480px, calc(100vw - 48px)); }
.head { display: flex; justify-content: space-between; align-items: center; }
.head :deep(h2) { font-size: 17px; }
.close { color: var(--panel-dim); padding: 4px 8px; border-radius: 6px; }
.close:hover { background: var(--panel-hover); }

h3 {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--panel-dim);
  margin-bottom: 6px;
}
.desc { font-size: 13px; color: var(--panel-fg); margin-bottom: 8px; }
.path {
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--panel-hover);
  border-radius: 7px;
  padding: 8px 10px;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row { display: flex; gap: 8px; }
.kbd {
  background: var(--panel-hover);
  border: 1px solid var(--panel-line);
  border-radius: 5px;
  padding: 1px 6px;
}
.ok { color: #3e9b58; }
.err { color: var(--danger); font-size: 12.5px; margin-bottom: 8px; }
</style>
