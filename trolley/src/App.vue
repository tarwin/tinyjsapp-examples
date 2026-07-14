<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { store, boot, listen, checkUpdates, deleteBoard } from './store'
import { backgroundCss } from './backgrounds'
import SetupScreen from './components/SetupScreen.vue'
import Sidebar from './components/Sidebar.vue'
import BoardView from './components/BoardView.vue'
import CardModal from './components/CardModal.vue'
import SettingsDialog from './components/SettingsDialog.vue'

const bgStyle = computed(() => {
  if (store.bgUri) return { background: `#1d2125 url(${store.bgUri}) center / cover no-repeat` }
  return { background: backgroundCss(store.board?.background ?? 'sky') }
})

onMounted(async () => {
  listen()

  // menus broadcast to every window — act only when we're the key one
  tiny.menu.on((id) => {
    if (!document.hasFocus()) return
    if (id === 'settings') store.settingsOpen = true
    else if (id === 'updates') checkUpdates(true)
    else if (id === 'board:new') store.wantNewBoard++
    else if (!store.board) return
    else if (id === 'card:new') store.wantNewCard++
    else if (id === 'list:new') store.wantNewList++
    else if (id === 'card:filter') store.wantFilter++
    else if (id === 'board:rename') store.renamingBoard = true
    else if (id === 'board:background') store.bgPickerOpen = true
    else if (id === 'board:delete') deleteBoardAsk()
  })

  await boot()

  // quiet update check at launch; failures (dev runs, offline) stay silent
  setTimeout(() => checkUpdates(false), 3000)
})

async function deleteBoardAsk() {
  if (!store.board) return
  const ok = await tiny.win.confirm(`Delete “${store.board.title}”?`, {
    detail: 'All of its lists and cards go with it. There is no undo.',
    ok: 'Delete Board',
  })
  if (ok) deleteBoard()
}
</script>

<template>
  <SetupScreen v-if="store.ready && store.needsSetup" />

  <div v-else-if="store.ready" class="shell" :style="bgStyle">
    <Sidebar />
    <BoardView v-if="store.board" />
    <div v-else class="no-board">
      <p>No boards yet — make one in the sidebar.</p>
    </div>
    <CardModal />
    <SettingsDialog />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  overflow: hidden;
}
.no-board {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--chrome-fg);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
</style>
