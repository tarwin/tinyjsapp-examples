// procsy backend — shells out to ps/lsof and exposes the results as api calls.
const dec = new TextDecoder();

async function run(args: string[]): Promise<string> {
  const proc = tjs.spawn(args, { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
  let out = '';
  const reader = proc.stdout.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
  } catch { /* stream closes with the process */ }
  await proc.wait();
  return out;
}

export interface ProcRow {
  pid: number;
  ppid: number;
  cpu: number;
  mem: number;
  rss: number; // KB
  user: string;
  etime: string;
  name: string;
  path: string;
}

export interface PortRow {
  pid: number;
  command: string;
  user: string;
  proto: string;
  address: string;
  port: number;
}

async function listProcs(): Promise<ProcRow[]> {
  const out = await run(['/bin/ps', 'axo', 'pid=,ppid=,pcpu=,pmem=,rss=,user=,etime=,comm=']);
  const rows: ProcRow[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const path = m[8].trim();
    rows.push({
      pid: +m[1], ppid: +m[2], cpu: +m[3], mem: +m[4], rss: +m[5],
      user: m[6], etime: m[7],
      name: path.split('/').pop() || path,
      path,
    });
  }
  return rows;
}

// lsof field mode (-F): p=pid, c=command, L=user, P=protocol, n=address.
// -sTCP:LISTEN keeps only listening TCP sockets (UDP has no state and passes through).
async function listPorts(): Promise<PortRow[]> {
  const out = await run(['/usr/sbin/lsof', '-nP', '-i', '-sTCP:LISTEN', '-FpcLPn']);
  const rows: PortRow[] = [];
  let pid = 0, command = '', user = '', proto = '';
  for (const line of out.split('\n')) {
    const tag = line[0], val = line.slice(1);
    if (tag === 'p') pid = +val;
    else if (tag === 'c') command = val;
    else if (tag === 'L') user = val;
    else if (tag === 'P') proto = val;
    else if (tag === 'n') {
      const i = val.lastIndexOf(':');
      const port = i >= 0 ? +val.slice(i + 1) : NaN;
      if (!Number.isFinite(port)) continue;
      rows.push({ pid, command, user, proto, address: i >= 0 ? val.slice(0, i) : val, port });
    }
  }
  // one row per pid+proto+port (lsof repeats for IPv4/IPv6)
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.pid}:${r.proto}:${r.port}:${r.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const api: Record<string, TinyApiHandler> = {
  procs: async () => listProcs(),
  ports: async () => listPorts(),

  kill: async ({ pid, force }: { pid: number; force?: boolean }) => {
    if (!Number.isInteger(pid) || pid <= 1) throw new Error('bad pid');
    const proc = tjs.spawn(['/bin/kill', force ? '-9' : '-15', String(pid)], {
      stdout: 'ignore', stderr: 'pipe', stdin: 'ignore',
    });
    let err = '';
    const reader = proc.stderr.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        err += dec.decode(value);
      }
    } catch { /* closed */ }
    const status = await proc.wait();
    if (status.exit_status !== 0) throw new Error(err.trim() || `kill exited ${status.exit_status}`);
    return true;
  },

  sysinfo: async () => {
    const load = (await run(['/usr/sbin/sysctl', '-n', 'vm.loadavg'])).trim(); // "{ 1.85 2.06 2.44 }"
    const ncpu = (await run(['/usr/sbin/sysctl', '-n', 'hw.ncpu'])).trim();
    const memsize = (await run(['/usr/sbin/sysctl', '-n', 'hw.memsize'])).trim();
    const m = load.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    return {
      loadavg: m ? [+m[1], +m[2], +m[3]] : [0, 0, 0],
      ncpu: +ncpu || 0,
      memBytes: +memsize || 0,
    };
  },
};

export function init(_app: TinyApp) {}
