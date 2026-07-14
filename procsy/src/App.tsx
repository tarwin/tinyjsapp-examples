import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge, Box, Code, DropdownMenu, Flex, Heading, IconButton, ScrollArea,
  Switch, Table, Tabs, Text, TextField, Theme, Tooltip,
} from '@radix-ui/themes'
import {
  CrossCircledIcon, DotsHorizontalIcon, MagnifyingGlassIcon, ReloadIcon,
} from '@radix-ui/react-icons'

interface ProcRow {
  pid: number; ppid: number; cpu: number; mem: number; rss: number
  user: string; etime: string; name: string; path: string
}
interface PortRow {
  pid: number; command: string; user: string; proto: string
  address: string; port: number
}
interface SysInfo { loadavg: number[]; ncpu: number; memBytes: number }

type Dir = 1 | -1
interface Sort { key: string; dir: Dir }

const REFRESH_MS = 2500

function fmtRss(kb: number): string {
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB'
  if (kb >= 1024) return (kb / 1024).toFixed(0) + ' MB'
  return kb + ' KB'
}

function cpuColor(cpu: number): 'red' | 'amber' | 'gray' {
  return cpu >= 50 ? 'red' : cpu >= 15 ? 'amber' : 'gray'
}

function sortBy<T>(rows: T[], sort: Sort): T[] {
  const { key, dir } = sort
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv)) * dir
  })
}

function SortHeader({ label, k, sort, onSort, align }: {
  label: string; k: string; sort: Sort; onSort: (s: Sort) => void
  align?: 'right'
}) {
  const active = sort.key === k
  return (
    <Table.ColumnHeaderCell
      onClick={() => onSort({ key: k, dir: active ? (-sort.dir as Dir) : sort.dir })}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: align }}
    >
      {label}{active ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
    </Table.ColumnHeaderCell>
  )
}

export default function App() {
  const [tab, setTab] = useState<'procs' | 'ports'>('procs')
  const [procs, setProcs] = useState<ProcRow[]>([])
  const [ports, setPorts] = useState<PortRow[]>([])
  const [sys, setSys] = useState<SysInfo | null>(null)
  const [filter, setFilter] = useState('')
  const [live, setLive] = useState(true)
  const [dark, setDark] = useState(false)
  const [procSort, setProcSort] = useState<Sort>({ key: 'cpu', dir: -1 })
  const [portSort, setPortSort] = useState<Sort>({ key: 'port', dir: 1 })

  const refresh = useCallback(async () => {
    try {
      const [p, o, s] = await Promise.all([
        tiny.api.call('procs') as Promise<ProcRow[]>,
        tiny.api.call('ports') as Promise<PortRow[]>,
        tiny.api.call('sysinfo') as Promise<SysInfo>,
      ])
      setProcs(p); setPorts(o); setSys(s)
    } catch (e) {
      tiny.log('refresh failed: ' + e)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!live) return
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
  }, [live, refresh])

  useEffect(() => {
    tiny.theme.get().then((t) => { if (t) setDark(t.dark) })
    tiny.theme.on((d) => setDark(d))
  }, [])

  const kill = useCallback(async (pid: number, name: string, force: boolean) => {
    const ok = await tiny.win.confirm(
      force ? `Force kill “${name}”?` : `Quit “${name}”?`,
      {
        detail: `PID ${pid} will be sent ${force ? 'SIGKILL — unsaved data is lost.' : 'SIGTERM.'}`,
        ok: force ? 'Force Kill' : 'Quit Process',
        cancel: 'Cancel',
      },
    )
    if (!ok) return
    try {
      await tiny.api.call('kill', { pid, force })
    } catch (e) {
      await tiny.win.alert('Could not kill process', String(e))
    }
    refresh()
  }, [refresh])

  const q = filter.trim().toLowerCase()
  const shownProcs = useMemo(() => {
    const rows = q
      ? procs.filter((p) =>
          p.name.toLowerCase().includes(q) || p.user.toLowerCase().includes(q) ||
          String(p.pid) === q)
      : procs
    return sortBy(rows, procSort)
  }, [procs, q, procSort])

  const shownPorts = useMemo(() => {
    const rows = q
      ? ports.filter((p) =>
          p.command.toLowerCase().includes(q) || p.user.toLowerCase().includes(q) ||
          String(p.port).includes(q) || String(p.pid) === q)
      : ports
    return sortBy(rows, portSort)
  }, [ports, q, portSort])

  const memGb = sys ? (sys.memBytes / 1024 ** 3).toFixed(0) : '–'

  return (
    <Theme appearance={dark ? 'dark' : 'light'} accentColor="iris" grayColor="slate"
      radius="large" style={{ height: '100vh' }}>
      <Flex direction="column" height="100%">

        <Flex align="center" gap="4" px="4" py="3"
          style={{ borderBottom: '1px solid var(--gray-a5)', flexShrink: 0 }}>
          <Heading size="4">Procsy</Heading>
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as 'procs' | 'ports')}>
            <Tabs.List size="1">
              <Tabs.Trigger value="procs">Processes</Tabs.Trigger>
              <Tabs.Trigger value="ports">Open Ports</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          <Box flexGrow="1" />
          <TextField.Root size="2" placeholder="Filter by name, user, pid, port…"
            value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ width: 240 }}>
            <TextField.Slot><MagnifyingGlassIcon /></TextField.Slot>
          </TextField.Root>
          <Flex align="center" gap="2">
            <Switch size="1" checked={live} onCheckedChange={setLive} />
            <Text size="1" color="gray">Live</Text>
            <Tooltip content="Refresh now">
              <IconButton size="1" variant="soft" onClick={refresh}><ReloadIcon /></IconButton>
            </Tooltip>
          </Flex>
        </Flex>

        <ScrollArea style={{ flex: 1 }}>
          {tab === 'procs' ? (
            <Table.Root size="1">
              <Table.Header>
                <Table.Row>
                  <SortHeader label="PID" k="pid" sort={procSort} onSort={setProcSort} />
                  <SortHeader label="Name" k="name" sort={procSort} onSort={setProcSort} />
                  <SortHeader label="User" k="user" sort={procSort} onSort={setProcSort} />
                  <SortHeader label="CPU %" k="cpu" sort={procSort} onSort={setProcSort} align="right" />
                  <SortHeader label="Mem %" k="mem" sort={procSort} onSort={setProcSort} align="right" />
                  <SortHeader label="RSS" k="rss" sort={procSort} onSort={setProcSort} align="right" />
                  <SortHeader label="Elapsed" k="etime" sort={procSort} onSort={setProcSort} align="right" />
                  <Table.ColumnHeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {shownProcs.map((p) => (
                  <Table.Row key={p.pid} align="center">
                    <Table.Cell><Code size="1" variant="ghost">{p.pid}</Code></Table.Cell>
                    <Table.RowHeaderCell>
                      <Tooltip content={p.path}><Text size="1">{p.name}</Text></Tooltip>
                    </Table.RowHeaderCell>
                    <Table.Cell><Text size="1" color="gray">{p.user}</Text></Table.Cell>
                    <Table.Cell className="num">
                      <Badge size="1" color={cpuColor(p.cpu)} variant="soft">{p.cpu.toFixed(1)}</Badge>
                    </Table.Cell>
                    <Table.Cell className="num"><Text size="1">{p.mem.toFixed(1)}</Text></Table.Cell>
                    <Table.Cell className="num"><Text size="1">{fmtRss(p.rss)}</Text></Table.Cell>
                    <Table.Cell className="num"><Text size="1" color="gray">{p.etime}</Text></Table.Cell>
                    <Table.Cell>
                      <RowMenu
                        onQuit={() => kill(p.pid, p.name, false)}
                        onKill={() => kill(p.pid, p.name, true)}
                        copies={[['Copy PID', String(p.pid)], ['Copy Path', p.path]]}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          ) : (
            <Table.Root size="1">
              <Table.Header>
                <Table.Row>
                  <SortHeader label="Port" k="port" sort={portSort} onSort={setPortSort} />
                  <SortHeader label="Proto" k="proto" sort={portSort} onSort={setPortSort} />
                  <SortHeader label="Address" k="address" sort={portSort} onSort={setPortSort} />
                  <SortHeader label="Process" k="command" sort={portSort} onSort={setPortSort} />
                  <SortHeader label="PID" k="pid" sort={portSort} onSort={setPortSort} />
                  <SortHeader label="User" k="user" sort={portSort} onSort={setPortSort} />
                  <Table.ColumnHeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {shownPorts.map((p) => (
                  <Table.Row key={`${p.pid}:${p.proto}:${p.address}:${p.port}`} align="center">
                    <Table.RowHeaderCell><Code size="2">{p.port}</Code></Table.RowHeaderCell>
                    <Table.Cell>
                      <Badge size="1" variant="soft" color={p.proto === 'TCP' ? 'indigo' : 'orange'}>
                        {p.proto}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell><Text size="1" color="gray">{p.address}</Text></Table.Cell>
                    <Table.Cell><Text size="1">{p.command}</Text></Table.Cell>
                    <Table.Cell><Code size="1" variant="ghost">{p.pid}</Code></Table.Cell>
                    <Table.Cell><Text size="1" color="gray">{p.user}</Text></Table.Cell>
                    <Table.Cell>
                      <Tooltip content="Kill this process">
                        <IconButton size="1" variant="ghost" color="red"
                          onClick={() => kill(p.pid, p.command, false)}>
                          <CrossCircledIcon />
                        </IconButton>
                      </Tooltip>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </ScrollArea>

        <Flex align="center" gap="3" px="4" py="2"
          style={{ borderTop: '1px solid var(--gray-a5)', flexShrink: 0 }}>
          <Text size="1" color="gray">
            {tab === 'procs'
              ? `${shownProcs.length} of ${procs.length} processes`
              : `${shownPorts.length} of ${ports.length} open ports`}
          </Text>
          <Box flexGrow="1" />
          {sys && (
            <Text size="1" color="gray">
              load {sys.loadavg.map((n) => n.toFixed(2)).join(' · ')}
              {'  —  '}{sys.ncpu} cores · {memGb} GB RAM
            </Text>
          )}
        </Flex>

      </Flex>
    </Theme>
  )
}

function RowMenu({ onQuit, onKill, copies }: {
  onQuit: () => void; onKill: () => void; copies: [string, string][]
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton size="1" variant="ghost"><DotsHorizontalIcon /></IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1">
        <DropdownMenu.Item onSelect={onQuit}>Quit (SIGTERM)</DropdownMenu.Item>
        <DropdownMenu.Item color="red" onSelect={onKill}>Force Kill (SIGKILL)</DropdownMenu.Item>
        <DropdownMenu.Separator />
        {copies.map(([label, value]) => (
          <DropdownMenu.Item key={label} onSelect={() => navigator.clipboard.writeText(value)}>
            {label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}
