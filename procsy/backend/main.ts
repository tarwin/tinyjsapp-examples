// procsy backend — shells out to ps/lsof (macOS) or PowerShell (Windows) and
// exposes the results as api calls.
const dec = new TextDecoder();

// txiki has no tjs.platform — key everything off the OS env var.
const IS_WIN = tjs.env.OS === 'Windows_NT';

const enc = new TextEncoder();

function parseJsonRows(out: string): any[] {
  const t = out.trim();
  if (!t) return [];
  const data = JSON.parse(t);
  return Array.isArray(data) ? data : [data];
}

// ── Windows PowerShell worker ──────────────────────────────────────────────
// One cold PowerShell spawn per api call (~1s startup) plus a full perf-counter
// sweep was hammering the box every refresh. Instead we run ONE long-lived
// PowerShell process, spawned lazily on the first Windows call and reused. It
// loops on stdin: 'p' → process table, 'n' → listening TCP ports, 's' → sysinfo
// — one compact JSON line each; 'q'/EOF exits. Being persistent lets it compute
// %CPU from its own Kernel+UserModeTime deltas (no perf-counter class) and cache
// memBytes/ncpu, which never change.
const WORKER_SCRIPT = [
  "$ProgressPreference='SilentlyContinue'",
  "$ErrorActionPreference='SilentlyContinue'",
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
  "$prev=@{}",                 // pid -> previous (kernel+user) 100ns ticks
  "$prevT=$null",              // timestamp of previous 'p' sample
  "$total=$null",              // cached total physical memory (bytes)
  "$ncpu=[double]$env:NUMBER_OF_PROCESSORS",
  "$lastOverall=0.0",          // overall CPU% from the last 'p' sample
  "function Emit($o){if($null -eq $o){[Console]::Out.WriteLine('[]');[Console]::Out.Flush();return};$j=ConvertTo-Json -Compress -Depth 3 -InputObject $o;if([string]::IsNullOrEmpty($j)){$j='[]'};[Console]::Out.WriteLine($j);[Console]::Out.Flush()}",
  "while($true){",
  "$line=[Console]::In.ReadLine()",
  "if($null -eq $line){break}",
  "$cmd=$line.Trim()",
  "if($cmd -eq 'q'){break}",
  "elseif($cmd -eq 'p'){",
  "if($null -eq $total){$total=[double](Get-CimInstance Win32_ComputerSystem -Property TotalPhysicalMemory).TotalPhysicalMemory}",
  "$now=[DateTime]::Now",
  "$elapsed=0.0;if($prevT){$elapsed=($now-$prevT).TotalSeconds}",
  "$cur=@{}",
  "$sum=0.0",
  "$rows=Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,Name,ExecutablePath,CreationDate,KernelModeTime,UserModeTime|ForEach-Object{",
  "$id=[int]$_.ProcessId",
  "if($id -eq 0){return}",     // skip System Idle Process (would read as ~100% busy)
  "$ticks=[double]$_.KernelModeTime+[double]$_.UserModeTime",
  "$cur[$id]=$ticks",
  "$cpu=0.0",
  "if($elapsed -gt 0 -and $prev.ContainsKey($id)){$dt=$ticks-$prev[$id];if($dt -gt 0){$sum+=$dt;$cpu=[math]::Round($dt/1e7/$elapsed*100,1)}}",
  "$ws=[double]$_.WorkingSetSize",
  "$mem=0.0;if($total -gt 0){$mem=[math]::Round($ws/$total*100,1)}",
  "$et=''",
  "if($_.CreationDate){$sp=$now-$_.CreationDate;$dd=$sp.Days;$h=$sp.Hours;$m=$sp.Minutes;$s=$sp.Seconds;if($dd -gt 0){$et='{0}-{1:00}:{2:00}:{3:00}'-f$dd,$h,$m,$s}elseif($h -gt 0){$et='{0}:{1:00}:{2:00}'-f$h,$m,$s}else{$et='{0:00}:{1:00}'-f$m,$s}}",
  "$path='';if($_.ExecutablePath){$path=$_.ExecutablePath}",
  "[pscustomobject]@{pid=$id;ppid=[int]$_.ParentProcessId;cpu=$cpu;mem=$mem;rss=[long]($ws/1024);user='';etime=$et;name=$_.Name;path=$path}",
  "}",
  "if($elapsed -gt 0 -and $ncpu -gt 0){$lastOverall=[math]::Round($sum/1e7/$elapsed/$ncpu*100,1)}",
  "$prev=$cur;$prevT=$now",
  "Emit @($rows)",
  "}",
  "elseif($cmd -eq 'n'){",
  "$names=@{};Get-Process|ForEach-Object{$names[$_.Id]=$_.ProcessName}",
  "$rows=Get-NetTCPConnection -State Listen|ForEach-Object{$op=[int]$_.OwningProcess;$c='';if($names.ContainsKey($op)){$c=$names[$op]};[pscustomobject]@{pid=$op;command=$c;user='';proto='TCP';address=[string]$_.LocalAddress;port=[int]$_.LocalPort}}",
  "Emit @($rows)",
  "}",
  "elseif($cmd -eq 's'){",
  "if($null -eq $total){$total=[double](Get-CimInstance Win32_ComputerSystem -Property TotalPhysicalMemory).TotalPhysicalMemory}",
  "Emit ([pscustomobject]@{memBytes=[long]$total;ncpu=[int]$ncpu;cpu=[double]$lastOverall})",
  "}",
  "}",
].join('\n');

interface Worker { proc: any; reader: any; writer: any; buf: string; dead: boolean }
let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();

function spawnWorker(): Worker {
  const proc = tjs.spawn(
    ['powershell', '-NoProfile', '-NonInteractive', '-Command', WORKER_SCRIPT],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
  );
  return { proc, reader: proc.stdout.getReader(), writer: proc.stdin.getWriter(), buf: '', dead: false };
}

// Read exactly one '\n'-terminated line, buffering any trailing bytes for the
// next call. Empty return + dead flag means the worker's stdout closed (death).
async function readLine(w: Worker): Promise<string> {
  let nl = w.buf.indexOf('\n');
  while (nl < 0) {
    const { value, done } = await w.reader.read();
    if (done) { w.dead = true; const rest = w.buf; w.buf = ''; return rest; }
    w.buf += dec.decode(value);
    nl = w.buf.indexOf('\n');
  }
  const line = w.buf.slice(0, nl).replace(/\r$/, '');
  w.buf = w.buf.slice(nl + 1);
  return line;
}

// Serialize every exchange (write command, read one line) through a promise
// chain so concurrent refresh calls can't interleave on the shared pipe. The
// chain keeps running even if one exchange rejects. Respawn once on death.
function ask(cmd: 'p' | 'n' | 's'): Promise<string> {
  const result = queue.then(() => exchange(cmd, true));
  queue = result.catch(() => undefined);
  return result;
}

async function exchange(cmd: string, retry: boolean): Promise<string> {
  if (!worker || worker.dead) worker = spawnWorker();
  try {
    await worker.writer.write(enc.encode(cmd + '\n'));
    const line = await readLine(worker);
    if (!line && worker.dead) throw new Error('worker exited');
    return line;
  } catch (e) {
    if (worker) {
      worker.dead = true;
      try { worker.proc.kill(); } catch { /* already gone */ }
    }
    worker = null;
    if (retry) return exchange(cmd, false);
    throw e;
  }
}

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

// Windows: the persistent worker computes %CPU from Kernel+UserModeTime deltas
// (see WORKER_SCRIPT). user is left '' — GetOwner() per process is far too slow
// for hundreds of rows (the frontend renders an empty user cell fine). etime is
// formatted worker-side to match macOS `ps` etime (mm:ss / hh:mm:ss / d-hh:mm:ss).
async function listProcsWin(): Promise<ProcRow[]> {
  const out = await ask('p');
  return parseJsonRows(out).map((r): ProcRow => ({
    pid: +r.pid, ppid: +r.ppid, cpu: +r.cpu, mem: +r.mem, rss: +r.rss,
    user: r.user ?? '', etime: r.etime ?? '',
    name: r.name ?? '', path: r.path ?? '',
  }));
}

async function listProcs(): Promise<ProcRow[]> {
  if (IS_WIN) return listProcsWin();
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
// Windows: listening TCP sockets via Get-NetTCPConnection, process names joined
// from Get-Process — both inside the persistent worker (command 'n'). UDP has no
// listen state on Windows so we only report TCP. user is '' (unavailable cheaply).
async function listPortsWin(): Promise<PortRow[]> {
  const out = await ask('n');
  const rows: PortRow[] = parseJsonRows(out).map((r): PortRow => ({
    pid: +r.pid, command: r.command ?? '', user: r.user ?? '',
    proto: r.proto ?? 'TCP', address: r.address ?? '', port: +r.port,
  }));
  // one row per pid+proto+port+address (dedupe IPv4/IPv6 duplicates, same as mac)
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.pid}:${r.proto}:${r.port}:${r.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function listPorts(): Promise<PortRow[]> {
  if (IS_WIN) return listPortsWin();
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
    // Windows: taskkill (add /F to force). taskkill without /F fails for
    // windowless processes — let that error surface like the mac branch does.
    const killArgs = IS_WIN
      ? ['taskkill', '/PID', String(pid), ...(force ? ['/F'] : [])]
      : ['/bin/kill', force ? '-9' : '-15', String(pid)];
    const proc = tjs.spawn(killArgs, {
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
    if (IS_WIN) {
      // Windows has no load average — report overall CPU % instead, and flag it
      // so the frontend labels it "cpu" rather than "load". The worker returns
      // cached memBytes/ncpu plus the overall CPU% from its last process sample.
      const out = await ask('s');
      let memBytes = 0, ncpu = 0, cpu = 0;
      try {
        const j = JSON.parse(out || '{}');
        memBytes = +j.memBytes || 0;
        ncpu = +j.ncpu || 0;
        cpu = +j.cpu || 0;
      } catch { /* leave zeros */ }
      return {
        loadavg: [cpu],
        ncpu: ncpu || (+tjs.env.NUMBER_OF_PROCESSORS || 0),
        memBytes,
        win: true,
      };
    }
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

export function init(_app: TinyApp) {
  (_app as any).setMenu([{ title: 'Help', items: [{ id: 'check-updates', label: 'Check for Updates…' }] }]);
}


export function onMenu(id: string, app: any) {
  if (id === 'check-updates') checkForUpdates(app);
}


// ── self-update (uniform across the examples) ──────────────────────────────
// The runtime does the real work (sha256 + signature verified, swap +
// relaunch). "Check for Updates…" runs this; the daily background check
// just taps you on the shoulder via a notification.
async function checkForUpdates(app: any) {
  try {
    const r = await app.update.check();
    if (r && r.available) {
      app.notify('Updating…', 'v' + r.latest + ' is downloading — the app will relaunch.');
      await app.update.install();
    } else {
      app.notify("You're up to date", 'v' + ((r && r.current) || '') + ' is the latest.');
    }
  } catch (e) {
    app.notify('Update check failed', String((e && e.message) || e));
  }
}

export function onUpdateAvailable(info: any, app: any) {
  app.notify('Update available', 'v' + info.latest + ' is ready — use "Check for Updates…" to install.');
}
