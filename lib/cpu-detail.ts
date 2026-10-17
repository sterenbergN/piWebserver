// The CPU breakdown /api/stats sends as `cpuDetail`, and how pages word it.
// No Node imports: the stats page and admin panel use this in the browser.

/**
 * Percentages of all CPU time over the last reading (apps + kernel + irq = busy;
 * I/O wait is idle time spent waiting on storage), each core's busy share,
 * the 1/5/15-minute load average and the clock in MHz.
 */
export type CpuDetail = {
  cores: number[];
  apps: number;
  kernel: number;
  irq: number;
  iowait: number;
  load: number[];
  mhz: number | null;
  maxMhz: number | null;
};

export const CPU_PARTS = [
  { key: 'apps', label: 'Apps', color: 'var(--accent-light)', title: 'Programs, including this web server (user + nice time)' },
  { key: 'kernel', label: 'Kernel', color: 'var(--info)', title: 'The Linux kernel working on behalf of programs: file systems, networking, system calls' },
  { key: 'irq', label: 'Interrupts', color: 'var(--warning)', title: 'Handling hardware and network interrupts (irq + softirq)' },
  { key: 'iowait', label: 'I/O wait', color: 'var(--muted)', title: 'Idle while waiting for the SD card or disk. Not counted as busy, but high values mean storage is the bottleneck' },
] as const;

/** "1.50 GHz of 2.40 GHz", "600 MHz of 1.80 GHz", or null without a clock reading. */
export function formatClock(mhz: number | null, maxMhz: number | null) {
  if (mhz === null || !Number.isFinite(mhz) || mhz <= 0) return null;
  const f = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} GHz` : `${Math.round(n)} MHz`);
  return maxMhz && maxMhz > 0 ? `${f(mhz)} of ${f(maxMhz)}` : f(mhz);
}

/**
 * "Load 0.42 · 0.35 · 0.30" plus a plain-language reading of the 1-minute
 * figure against the core count: load counts processes running or waiting
 * to run, so a load equal to the number of cores means every core is in demand.
 */
export function describeLoad(load: number[], cores: number) {
  if (load.length < 3 || load.every((n) => n === 0)) return null; // Windows always reports 0
  const text = `Load ${load.slice(0, 3).map((n) => n.toFixed(2)).join(' · ')}`;
  const title = `Average processes running or waiting over 1, 5 and 15 minutes${cores ? `. ${cores.toFixed(2)} would mean all ${cores} cores are in demand` : ''}.`;
  return { text, title };
}
