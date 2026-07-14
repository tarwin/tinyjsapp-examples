import './style.css'

// In a plain browser (no injected bridge) during dev, fake the backend so
// the UI is hackable without the native window. Tree-shaken out of builds.
if (import.meta.env.DEV && !('tiny' in window)) {
  await import('./devmock')
}

const [{ createApp }, { default: App }] = await Promise.all([import('vue'), import('./App.vue')])
createApp(App).mount('#app')
