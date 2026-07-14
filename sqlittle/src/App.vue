<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Listbox from 'primevue/listbox'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import Toast from 'primevue/toast'

interface TableInfo { name: string; type: string; rows: number | null }
type Row = Record<string, unknown>

const toast = useToast()

const dbPath = ref<string | null>(null)
const tables = ref<TableInfo[]>([])
const selected = ref<TableInfo | null>(null)
const activeTab = ref('browse')

const rows = ref<Row[]>([])
const first = ref(0)
const loading = ref(false)
const PAGE = 100

const sql = ref('SELECT name, type FROM sqlite_master')
const queryRows = ref<Row[] | null>(null)
const queryMs = ref(0)
const queryError = ref<string | null>(null)
const running = ref(false)

const dbName = computed(() => dbPath.value?.split('/').pop() ?? '')
const totalRows = computed(() => selected.value?.rows ?? rows.value.length)
const columns = computed(() => (rows.value[0] ? Object.keys(rows.value[0]).filter((c) => c !== '_rowid_') : []))
const queryColumns = computed(() => (queryRows.value?.[0] ? Object.keys(queryRows.value[0]) : []))

function fail(summary: string, e: unknown) {
  toast.add({ severity: 'error', summary, detail: String(e), life: 5000 })
}

async function openDb(path: string) {
  try {
    const res = await tiny.api.call('open', { path }) as { path: string; tables: TableInfo[] }
    dbPath.value = res.path
    tables.value = res.tables
    selected.value = res.tables[0] ?? null
    queryRows.value = null
    queryError.value = null
    toast.add({
      severity: 'success', summary: dbName.value,
      detail: `${res.tables.length} tables`, life: 2500,
    })
  } catch (e) {
    fail('Could not open database', e)
  }
}

async function pickDb() {
  const path = await tiny.win.openFile()
  if (path) openDb(path)
}

async function loadRows() {
  if (!selected.value) { rows.value = []; return }
  loading.value = true
  try {
    rows.value = await tiny.api.call('rows', {
      table: selected.value.name, limit: PAGE, offset: first.value,
    }) as Row[]
  } catch (e) {
    fail('Could not load rows', e)
  } finally {
    loading.value = false
  }
}

function onPage(e: { first: number }) {
  first.value = e.first
  loadRows()
}

watch(selected, () => { first.value = 0; loadRows() })

async function runQuery() {
  if (!sql.value.trim() || running.value) return
  running.value = true
  queryError.value = null
  try {
    const res = await tiny.api.call('query', { sql: sql.value }) as { rows: Row[]; ms: number }
    queryRows.value = res.rows
    queryMs.value = res.ms
    // refresh table list — the query may have created/dropped/mutated tables
    tables.value = await tiny.api.call('tables') as TableInfo[]
  } catch (e) {
    queryRows.value = null
    queryError.value = String(e)
  } finally {
    running.value = false
  }
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  return String(v)
}

onMounted(async () => {
  // dark mode follows the system, live
  const t = await tiny.theme.get()
  document.documentElement.classList.toggle('p-dark', !!t?.dark)
  tiny.theme.on((dark) => document.documentElement.classList.toggle('p-dark', dark))

  // double-clicked .db file (Open With), buffered across cold start
  tiny.app.onOpenFiles((paths) => { if (paths[0]) openDb(paths[0]) })

  // drag a database onto the window
  tiny.win.onDrop((paths) => {
    const hit = paths.find((p) => /\.(db|sqlite3?|sqlite)$/i.test(p)) ?? paths[0]
    if (hit) openDb(hit)
  })

  // reopen the last database
  const cur = await tiny.api.call('current') as { path: string; tables: TableInfo[] } | null
  if (cur) {
    dbPath.value = cur.path
    tables.value = cur.tables
    selected.value = cur.tables[0] ?? null
  }
})
</script>

<template>
  <Toast position="bottom-right" />

  <div v-if="!dbPath" class="empty">
    <i class="pi pi-database empty-icon" />
    <h1>SQLittle</h1>
    <p>Open a SQLite database, drop one on this window,<br>
      or double-click a <code>.db</code> / <code>.sqlite</code> file in Finder.</p>
    <Button label="Open Database…" icon="pi pi-folder-open" @click="pickDb" />
  </div>

  <div v-else class="shell">
    <header>
      <i class="pi pi-database" style="font-size: 1.1rem" />
      <strong>SQLittle</strong>
      <Tag :value="dbName" severity="secondary" v-tooltip.bottom="dbPath" />
      <span class="spacer" />
      <Button label="Open…" icon="pi pi-folder-open" size="small" severity="secondary"
        outlined @click="pickDb" />
    </header>

    <div class="body">
      <aside>
        <Listbox v-model="selected" :options="tables" optionLabel="name" class="table-list"
          :pt="{ root: { style: 'border: 0; border-radius: 0; background: transparent' } }">
          <template #option="{ option }">
            <div class="table-option">
              <i :class="option.type === 'view' ? 'pi pi-eye' : 'pi pi-table'" />
              <span class="table-name">{{ option.name }}</span>
              <Tag v-if="option.rows !== null" :value="option.rows.toLocaleString()"
                severity="secondary" class="count" />
            </div>
          </template>
        </Listbox>
      </aside>

      <main>
        <Tabs v-model:value="activeTab">
          <TabList>
            <Tab value="browse"><i class="pi pi-table tab-ico" /> Browse</Tab>
            <Tab value="query"><i class="pi pi-code tab-ico" /> Query</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="browse">
              <DataTable :value="rows" lazy paginator :rows="PAGE" :first="first"
                :totalRecords="totalRows" :loading="loading" @page="onPage"
                scrollable scrollHeight="flex" size="small" stripedRows showGridlines
                class="grid-table">
                <Column v-for="col in columns" :key="col" :field="col" :header="col">
                  <template #body="{ data }">
                    <span :class="{ null: data[col] === null }">{{ fmtCell(data[col]) }}</span>
                  </template>
                </Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="query">
              <div class="query-pane">
                <Textarea v-model="sql" rows="5" spellcheck="false" class="sql"
                  placeholder="SELECT * FROM …" @keydown.meta.enter.prevent="runQuery" />
                <div class="query-bar">
                  <Button :label="running ? 'Running…' : 'Run'" icon="pi pi-play"
                    size="small" :disabled="running" @click="runQuery" />
                  <span class="hint">⌘↩</span>
                  <span v-if="queryRows" class="hint">
                    {{ queryRows.length.toLocaleString() }} rows · {{ queryMs }} ms
                  </span>
                </div>
                <div v-if="queryError" class="query-error">{{ queryError }}</div>
                <DataTable v-else-if="queryRows" :value="queryRows" paginator :rows="50"
                  scrollable scrollHeight="flex" size="small" stripedRows showGridlines
                  removableSort class="grid-table">
                  <Column v-for="col in queryColumns" :key="col" :field="col" :header="col" sortable>
                    <template #body="{ data }">
                      <span :class="{ null: data[col] === null }">{{ fmtCell(data[col]) }}</span>
                    </template>
                  </Column>
                </DataTable>
              </div>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </main>
    </div>
  </div>
</template>
