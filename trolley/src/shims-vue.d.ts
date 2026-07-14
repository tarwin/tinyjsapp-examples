// Lets plain tsserver (no Volar) resolve .vue imports; vue-tsc ignores this.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, any>
  export default component
}
