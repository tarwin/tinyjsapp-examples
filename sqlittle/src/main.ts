import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import 'primeicons/primeicons.css'
import './style.css'
import App from './App.vue'

const app = createApp(App)
app.use(PrimeVue, {
  theme: { preset: Aura, options: { darkModeSelector: '.p-dark' } },
})
app.use(ToastService)
app.directive('tooltip', Tooltip)
app.mount('#app')
