// Due-date helpers. txiki has no Intl, but this code runs in WebKit — the
// page can format dates properly; the backend only compares timestamps.

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function formatDue(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay(d, now)) return time
  const day = d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
  return `${day}, ${time}`
}

export function dueState(ts: number, done: boolean): { state: 'done' | 'overdue' | 'today' | 'later' } {
  if (done) return { state: 'done' }
  const now = new Date()
  if (ts < now.getTime()) return { state: 'overdue' }
  if (sameDay(new Date(ts), now)) return { state: 'today' }
  return { state: 'later' }
}

// <input type="datetime-local"> speaks 'YYYY-MM-DDTHH:MM' in local time
export function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fromLocalInput(v: string): number | null {
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
