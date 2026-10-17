import fs from 'fs/promises';
import os from 'os';

import type { CpuDetail } from './cpu-detail';

// Live network speed and CPU usage. Linux only exposes running totals
// (bytes since boot, CPU time since boot), so a rate needs two readings:
// we keep the previous one in memory and compare. The admin page polls
// every 10 s, so the numbers are 10-second averages.

export type NetTotals = { rx: number; tx: number };
/** Byte counters per interface name, e.g. { eth0: {...}, wlan0: {...} }. */
export type NetCounters = Record<string, NetTotals>;
/** Time a CPU has spent in each state since boot (ticks from /proc/stat, or ms from os.cpus()). */
export type CpuTimes = { user: number; nice: number; system: number; idle: number; iowait: number; irq: number; softirq: number; steal: number };
export type CpuSample = { all: CpuTimes; cores: CpuTimes[] };
/**
 * Where CPU time went between two readings, as percentages of all CPU time.
 * Busy (`percent`) is apps + kernel + irq; I/O wait is idle time spent
 * waiting for the SD card or disk, so it isn't counted as busy.
 */
export type CpuUse = { percent: number; cores: number[]; apps: number; kernel: number; irq: number; iowait: number };
export type Sample = { at: number; net: NetCounters | null; cpu: CpuSample };
export type LiveRates = { rxPerSec: number | null; txPerSec: number | null; cpuPercent: number; cpu: CpuUse | null; since: NetTotals | null };

/** Virtual links (bridges, tunnels, containers) that would double-count traffic already seen on eth0/wlan0. */
const VIRTUAL_IFACE = /^(lo|docker|veth|br[-\d]|virbr|lxc|vmnet|tun|tap|wg|tailscale|zt|dummy|bond|sit|ip6tnl|gre|erspan|vxlan|ifb|cni|flannel|cali|kube)/;

/** Received/sent bytes for each physical interface in /proc/net/dev text. */
export function parseNetDevByInterface(text: string): NetCounters {
  const counters: NetCounters = {};
  for (const line of text.split('\n').slice(2)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    if (!name || VIRTUAL_IFACE.test(name)) continue;
    // After the name: 8 receive columns, then 8 transmit columns; bytes come first in each.
    const fields = line.slice(colon + 1).trim().split(/\s+/).map(Number);
    if (fields.length < 9 || !Number.isFinite(fields[0]) || !Number.isFinite(fields[8])) continue;
    counters[name] = { rx: fields[0], tx: fields[8] };
  }
  return counters;
}

function sumCounters(counters: NetCounters): NetTotals {
  let rx = 0;
  let tx = 0;
  for (const c of Object.values(counters)) {
    rx += c.rx;
    tx += c.tx;
  }
  return { rx, tx };
}

/** Sum received/sent bytes for the physical interfaces in /proc/net/dev text. */
export function parseNetDev(text: string): NetTotals {
  return sumCounters(parseNetDevByInterface(text));
}

const CPU_STATES = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal'] as const;

function sumTimes(list: CpuTimes[]): CpuTimes {
  const sum: CpuTimes = { user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 };
  for (const t of list) for (const k of CPU_STATES) sum[k] += t[k];
  return sum;
}

/** The "cpu" (all cores) and "cpuN" lines of /proc/stat. Columns: user nice system idle iowait irq softirq steal. */
export function parseProcStat(text: string): CpuSample | null {
  let all: CpuTimes | null = null;
  const cores: CpuTimes[] = [];
  for (const line of text.split('\n')) {
    const m = /^cpu(\d*)\s+(.+)$/.exec(line);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length < 4 || !f.slice(0, 4).every(Number.isFinite)) continue;
    const times = Object.fromEntries(CPU_STATES.map((k, i) => [k, Number.isFinite(f[i]) ? f[i] : 0])) as CpuTimes;
    if (m[1] === '') all = times;
    else cores.push(times);
  }
  return all ? { all, cores } : null;
}

/** Fallback off Linux. os.cpus() has no I/O wait, softirq or steal columns. */
function cpuFromOs(): CpuSample {
  const cores = os.cpus().map(({ times: t }) => ({ user: t.user, nice: t.nice, system: t.sys, idle: t.idle, iowait: 0, irq: t.irq, softirq: 0, steal: 0 }));
  return { all: sumTimes(cores), cores };
}

async function takeSample(): Promise<Sample> {
  const net = await fs.readFile('/proc/net/dev', 'utf8').then(parseNetDevByInterface).catch(() => null);
  const cpu = (await fs.readFile('/proc/stat', 'utf8').then(parseProcStat).catch(() => null)) ?? cpuFromOs();
  return { at: Date.now(), net, cpu };
}

/** Percentages of the time that passed between two readings of one CPU (or all of them). */
function cpuShare(a: CpuTimes, b: CpuTimes) {
  // Counters can tick backwards slightly (iowait notably); treat that as no time.
  const d = (k: keyof CpuTimes) => Math.max(0, b[k] - a[k]);
  const apps = d('user') + d('nice');
  const kernel = d('system');
  const irq = d('irq') + d('softirq') + d('steal');
  const iowait = d('iowait');
  const total = apps + kernel + irq + iowait + d('idle');
  if (total <= 0) return null;
  const pct = (x: number) => (x / total) * 100;
  return { percent: pct(apps + kernel + irq), apps: pct(apps), kernel: pct(kernel), irq: pct(irq), iowait: pct(iowait) };
}

/** CPU use between two readings: overall, by kind of work, and per core. */
export function cpuUseBetween(a: CpuSample, b: CpuSample): CpuUse | null {
  const all = cpuShare(a.all, b.all);
  if (!all) return null;
  // A core going offline or online between readings changes the list; skip per-core then.
  const cores = a.cores.length === b.cores.length ? b.cores.map((t, i) => cpuShare(a.cores[i], t)?.percent ?? 0) : [];
  return { ...all, cores };
}

/** Bytes moved between two readings of one counter. One that went backwards was reset (interface re-created) or wrapped: count from zero. */
function counterDelta(from: number, to: number) {
  return to >= from ? to - from : to;
}

/**
 * Per-second rates between two readings. Each interface is compared with
 * itself, so one that appears, disappears or resets between readings can't
 * add its whole lifetime total or cancel out another interface's traffic.
 */
export function ratesBetween(a: Sample, b: Sample): LiveRates {
  const seconds = (b.at - a.at) / 1000;
  let rxPerSec: number | null = null;
  let txPerSec: number | null = null;
  if (a.net && b.net && seconds > 0) {
    let rx = 0;
    let tx = 0;
    let shared = 0;
    for (const [name, now] of Object.entries(b.net)) {
      const before = a.net[name];
      if (!before) continue; // new interface: no baseline yet
      rx += counterDelta(before.rx, now.rx);
      tx += counterDelta(before.tx, now.tx);
      shared++;
    }
    if (shared > 0) {
      rxPerSec = rx / seconds;
      txPerSec = tx / seconds;
    }
  }
  const cpu = cpuUseBetween(a.cpu, b.cpu);
  return {
    rxPerSec,
    txPerSec,
    cpuPercent: cpu?.percent ?? 0,
    cpu,
    since: b.net ? sumCounters(b.net) : null,
  };
}

/** Current and top CPU clock in MHz (Linux cpufreq reports kHz). Null when the kernel doesn't expose it. */
export async function readCpuClock(): Promise<{ mhz: number; maxMhz: number | null } | null> {
  const read = (file: string) => fs.readFile(`/sys/devices/system/cpu/cpu0/cpufreq/${file}`, 'utf8').then((s) => Number(s.trim()) / 1000).catch(() => NaN);
  const [mhz, maxMhz] = await Promise.all([read('scaling_cur_freq'), read('cpuinfo_max_freq')]);
  if (!Number.isFinite(mhz) || mhz <= 0) return null;
  return { mhz: Math.round(mhz), maxMhz: Number.isFinite(maxMhz) && maxMhz > 0 ? Math.round(maxMhz) : null };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The `cpuDetail` field of /api/stats, rounded to one decimal place. */
export function toCpuDetail(use: CpuUse, load: number[], clock: { mhz: number; maxMhz: number | null } | null): CpuDetail {
  return {
    cores: use.cores.map(round1),
    apps: round1(use.apps),
    kernel: round1(use.kernel),
    irq: round1(use.irq),
    iowait: round1(use.iowait),
    load: load.slice(0, 3).map((n) => Math.round(n * 100) / 100),
    mhz: clock?.mhz ?? null,
    maxMhz: clock?.maxMhz ?? null,
  };
}

let last: Sample | null = null;
let lastRates: LiveRates | null = null;

/**
 * Current rates. With a recent previous reading this is instant; otherwise
 * (first request, or nobody asked for a while) it measures over one second.
 */
export async function getLiveRates(): Promise<LiveRates> {
  const now = await takeSample();
  if (last && lastRates && now.at - last.at < 1000) return lastRates; // several viewers polling at once
  let before = last;
  if (!before || now.at - before.at > 60_000) {
    before = now;
    await new Promise((r) => setTimeout(r, 1000));
    const fresh = await takeSample();
    lastRates = ratesBetween(before, fresh);
    last = fresh;
    return lastRates;
  }
  lastRates = ratesBetween(before, now);
  last = now;
  return lastRates;
}

const BIT_RATE_UNITS = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s'];

/**
 * Network speed the way routers show it: bits per second (bytes × 8) with
 * decimal prefixes and three significant figures — "4.30 kbit/s", "12.0 Mbit/s".
 * The unit is picked after rounding, so 999.7 kbit/s reads "1.00 Mbit/s", not "1000 kbit/s".
 */
export function formatBitRate(bytesPerSec: number | null) {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '—';
  let value = bytesPerSec * 8;
  let unit = 0;
  while (value >= 999.5 && unit < BIT_RATE_UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const decimals = unit === 0 ? 0 : value < 9.995 ? 2 : value < 99.95 ? 1 : 0;
  return `${value.toFixed(decimals)} ${BIT_RATE_UNITS[unit]}`;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(1)} ${sizes[i]}`;
}
