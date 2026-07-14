import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Two pages: the board window (index.html) and the quick-add palette window
// (palette.html) that the backend opens on the global hotkey.
export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        palette: resolve(__dirname, 'palette.html'),
      },
    },
  },
})
