import fs from 'fs/promises';
import os from 'os';

// Live network speed and CPU usage. Linux only exposes running totals
// (bytes since boot, CPU time since boot), so a rate needs two readings:
// we keep the previous one in memory and compare. The admin page polls
// every 10 s, so the numbers are 10-second averages.

export type NetTotals = { rx: number; tx: number };
type CpuTimes = { idle: number; total: number };
type Sample = { at: number; net: NetTotals | null; cpu: CpuTimes };
export type LiveRates = { rxPerSec: number | null; txPerSec: number | null; cpuPercent: number; since: NetTotals | null };

/** Virtual links that would double-count traffic already seen on eth0/wlan0. */
const VIRTUAL_IFACE = /^(lo|docker|veth|br-|virbr|vmnet|tun|tap|wg|tailscale|zt|dummy|bond|sit|ip6tnl)/;

/** Sum received/sent bytes for the physical interfaces in /proc/net/dev text. */
export function parseNetDev(text: string): NetTotals {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n').slice(2)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    if (!name || VIRTUAL_IFACE.test(name)) continue;
    // After the name: 8 receive columns, then 8 transmit columns; bytes come first in each.
    const fields = line.slice(colon + 1).trim().split(/\s+/).map(Number);
    if (fields.length < 9) continue;
    if (Number.isFinite(fields[0])) rx += fields[0];
    if (Number.isFinite(fields[8])) tx += fields[8];
  }
  return { rx, tx };
}

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

async function takeSample(): Promise<Sample> {
  const net = await fs.readFile('/proc/net/dev', 'utf8').then(parseNetDev).catch(() => null);
  return { at: Date.now(), net, cpu: readCpuTimes() };
}

/** Per-second rates between two readings (counters that went backwards — a reboot or interface reset — give null). */
export function ratesBetween(a: Sample, b: Sample): LiveRates {
  const seconds = Math.max((b.at - a.at) / 1000, 0.001);
  const rate = (from?: number, to?: number) => (from === undefined || to === undefined || to < from ? null : (to - from) / seconds);
  const cpuTotal = b.cpu.total - a.cpu.total;
  const cpuIdle = b.cpu.idle - a.cpu.idle;
  return {
    rxPerSec: rate(a.net?.rx, b.net?.rx),
    txPerSec: rate(a.net?.tx, b.net?.tx),
    cpuPercent: cpuTotal > 0 ? Math.min(100, Math.max(0, (1 - cpuIdle / cpuTotal) * 100)) : 0,
    since: b.net,
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

/** Network speed the way routers show it: bits per second. */
export function formatBitRate(bytesPerSec: number | null) {
  if (bytesPerSec === null) return '—';
  const bits = bytesPerSec * 8;
  if (bits < 1000) return `${Math.round(bits)} bit/s`;
  if (bits < 1e6) return `${(bits / 1e3).toFixed(bits < 1e4 ? 1 : 0)} kbit/s`;
  if (bits < 1e9) return `${(bits / 1e6).toFixed(bits < 1e7 ? 2 : 1)} Mbit/s`;
  return `${(bits / 1e9).toFixed(2)} Gbit/s`;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(1)} ${sizes[i]}`;
}
