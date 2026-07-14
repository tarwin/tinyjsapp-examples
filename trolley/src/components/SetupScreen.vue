<script setup lang="ts">
import { ref } from 'vue'
import { store, setup } from './../store'

const busy = ref(false)
const error = ref('')

async function use(path: string) {
  busy.value = true
  error.value = ''
  try {
    await setup(path)
  } catch (e: any) {
    error.value = String(e?.message ?? e)
  }
  busy.value = false
}

async function choose() {
  const dir = await tiny.win.pickFolder()
  if (dir) use(dir)
}
</script>

<template>
  <div class="setup">
    <div class="panel">
      <div class="logo">🛒</div>
      <h1>Welcome to Trolley</h1>
      <p>
        Boards live in a single SQLite file in a folder you choose —
        Documents, iCloud&nbsp;Drive, a synced folder, anywhere.
        You can move it later from Settings.
      </p>

      <div class="path">{{ store.suggestedPath }}</div>

      <div class="row">
        <button class="btn primary" :disabled="busy" @click="use(store.suggestedPath)">
          Use this folder
        </button>
        <button class="btn" :disabled="busy" @click="choose">Choose another…</button>
      </div>

      <p v-if="error" class="err">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.setup {
  height: 100%;
  display: grid;
  place-items: center;
  background: linear-gradient(160deg, #2d6cc4 0%, #4c9ad4 60%, #6db8d9 100%);
}
.panel {
  width: min(460px, calc(100vw - 48px));
  background: var(--panel-bg);
  color: var(--panel-fg);
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  padding: 32px 34px;
  text-align: center;
  display: grid;
  gap: 14px;
}
.logo { font-size: 40px; }
h1 { font-size: 20px; }
p { color: var(--panel-dim); font-size: 13px; }
.path {
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--panel-hover);
  border-radius: 8px;
  padding: 9px 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row { display: flex; gap: 10px; justify-content: center; }
.err { color: var(--danger); }
</style>
