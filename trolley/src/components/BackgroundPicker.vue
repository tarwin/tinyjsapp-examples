<script setup lang="ts">
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'radix-vue'
import { store, setBackground, setBackgroundImage } from './../store'
import { BACKGROUNDS } from './../backgrounds'

async function pickImage() {
  const path = await tiny.win.openFile()
  if (!path) return
  try {
    await setBackgroundImage(path)
    store.bgPickerOpen = false
  } catch (e: any) {
    await tiny.win.alert('Could not use that image', String(e?.message ?? e))
  }
}
</script>

<template>
  <PopoverRoot v-model:open="store.bgPickerOpen">
    <PopoverTrigger class="trigger" title="Change background (⌘B)">🎨</PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="pop" :side-offset="6" align="end">
        <div class="grid">
          <button
            v-for="(css, key) in BACKGROUNDS"
            :key="key"
            class="swatch"
            :class="{ active: store.board?.background === key && !store.board?.hasImage }"
            :style="{ background: css }"
            :title="key"
            @click="setBackground(key as string); store.bgPickerOpen = false"
          />
        </div>
        <button class="btn image-btn" @click="pickImage">
          {{ store.board?.hasImage ? 'Change image…' : 'Use an image…' }}
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
.trigger {
  font-size: 15px;
  padding: 4px 9px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.22);
}
.trigger:hover { background: rgba(255, 255, 255, 0.34); }
</style>

<style>
.pop {
  background: var(--panel-bg);
  color: var(--panel-fg);
  border: 1px solid var(--panel-line);
  border-radius: 10px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
  padding: 10px;
  z-index: 50;
  display: grid;
  gap: 10px;
}
.pop .grid {
  display: grid;
  grid-template-columns: repeat(4, 56px);
  gap: 8px;
}
.pop .swatch {
  height: 38px;
  border-radius: 7px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
.pop .swatch:hover { filter: brightness(1.1); }
.pop .swatch.active { outline: 2px solid var(--accent); outline-offset: 1px; }
.pop .image-btn { width: 100%; }
</style>
