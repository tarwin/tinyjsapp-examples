if (import.meta.env.DEV && !('tiny' in window)) {
  await import('./devmock')
}

const [{ createApp }, { default: Palette }] = await Promise.all([import('vue'), import('./Palette.vue')])
createApp(Palette).mount('#app')
