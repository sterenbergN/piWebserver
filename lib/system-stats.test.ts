import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuUseBetween, formatBitRate, formatBytes, parseNetDev, parseNetDevByInterface, parseProcStat, ratesBetween, toCpuDetail, type CpuTimes } from './system-stats';
import { describeLoad, formatClock } from './cpu-detail';

const NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9000000   100    0    0    0     0          0         0  9000000   100    0    0    0     0       0          0
  eth0:1000000000 800000  0    0    0     0          0       120 250000000 400000   0    0    0     0       0          0
 wlan0:   5000      10    0    0    0     0          0         0     3000      8    0    0    0     0       0          0
docker0:  777777    50    0    0    0     0          0         0   888888     60    0    0    0     0       0          0
veth12ab: 777777    50    0    0    0     0          0         0   888888     60    0    0    0     0       0          0
`;

test('parseNetDev sums physical interfaces only', () => {
  assert.deepEqual(parseNetDev(NET_DEV), { rx: 1_000_005_000, tx: 250_003_000 });
});

test('parseNetDev copes with a name glued to the first number', () => {
  assert.deepEqual(parseNetDev('h1\nh2\neth0:123 0 0 0 0 0 0 0 456 0 0 0 0 0 0 0\n'), { rx: 123, tx: 456 });
});

test('parseNetDevByInterface keeps physical links apart and skips bridges and tunnels', () => {
  const text = `${NET_DEV} br0: 4000 1 0 0 0 0 0 0 4000 1 0 0 0 0 0 0\n tailscale0: 70 1 0 0 0 0 0 0 80 1 0 0 0 0 0 0\n  end0: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0\n`;
  assert.deepEqual(parseNetDevByInterface(text), {
    eth0: { rx: 1_000_000_000, tx: 250_000_000 },
    wlan0: { rx: 5000, tx: 3000 },
    end0: { rx: 10, tx: 20 },
  });
});

const times = (t: Partial<CpuTimes>): CpuTimes => ({ user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0, ...t });
const cpu = { all: times({}), cores: [] };

test('ratesBetween gives bytes per second: the change divided by the elapsed time', () => {
  const a = { at: 0, net: { eth0: { rx: 1000, tx: 500 } }, cpu: { all: times({ user: 300, idle: 700 }), cores: [] } };
  const b = { at: 10_000, net: { eth0: { rx: 1_251_000, tx: 10_500 } }, cpu: { all: times({ user: 500, idle: 1500 }), cores: [] } };
  const r = ratesBetween(a, b);
  assert.equal(r.rxPerSec, 125_000); // 1.25 MB in 10 s
  assert.equal(r.txPerSec, 1_000);
  assert.equal(Math.round(r.cpuPercent), 20);
  assert.deepEqual(r.since, { rx: 1_251_000, tx: 10_500 });
});

test('ratesBetween: a 100 Mbit/s download over 10 s reads as 100 Mbit/s', () => {
  const a = { at: 5_000, net: { eth0: { rx: 7e9, tx: 0 } }, cpu };
  const b = { at: 15_000, net: { eth0: { rx: 7e9 + 125_000_000, tx: 0 } }, cpu };
  assert.equal(formatBitRate(ratesBetween(a, b).rxPerSec), '100 Mbit/s');
});

test('ratesBetween adds interfaces together, each against itself', () => {
  const a = { at: 0, net: { eth0: { rx: 100, tx: 100 }, wlan0: { rx: 50, tx: 50 } }, cpu };
  const b = { at: 1000, net: { eth0: { rx: 1100, tx: 300 }, wlan0: { rx: 550, tx: 50 } }, cpu };
  const r = ratesBetween(a, b);
  assert.equal(r.rxPerSec, 1500);
  assert.equal(r.txPerSec, 200);
});

test('ratesBetween ignores an interface that appeared between readings', () => {
  const a = { at: 0, net: { eth0: { rx: 0, tx: 0 } }, cpu };
  const b = { at: 1000, net: { eth0: { rx: 2000, tx: 1000 }, usb0: { rx: 9e12, tx: 9e12 } }, cpu };
  const r = ratesBetween(a, b);
  assert.equal(r.rxPerSec, 2000); // not usb0's lifetime total
  assert.equal(r.txPerSec, 1000);
});

test('ratesBetween counts a reset or wrapped counter from zero without hiding the others', () => {
  const a = { at: 0, net: { eth0: { rx: 9000, tx: 9000 }, wlan0: { rx: 4_294_967_000, tx: 0 } }, cpu };
  const b = { at: 1000, net: { eth0: { rx: 10, tx: 10 }, wlan0: { rx: 4_294_968_000, tx: 0 } }, cpu };
  const r = ratesBetween(a, b);
  assert.equal(r.rxPerSec, 10 + 1000);
  assert.equal(r.txPerSec, 10);
});

test('ratesBetween has no speed without two network readings', () => {
  assert.equal(ratesBetween({ at: 0, net: null, cpu }, { at: 1000, net: { eth0: { rx: 1, tx: 1 } }, cpu }).rxPerSec, null);
  assert.equal(ratesBetween({ at: 0, net: {}, cpu }, { at: 1000, net: {}, cpu }).rxPerSec, null);
  const same = { at: 1000, net: { eth0: { rx: 1, tx: 1 } }, cpu };
  assert.equal(ratesBetween(same, same).rxPerSec, null);
  assert.equal(ratesBetween(same, same).cpuPercent, 0);
});

test('formatBitRate converts bytes to bits and scales with decimal prefixes', () => {
  assert.equal(formatBitRate(null), '—');
  assert.equal(formatBitRate(NaN), '—');
  assert.equal(formatBitRate(-1), '—');
  assert.equal(formatBitRate(0), '0 bit/s');
  assert.equal(formatBitRate(50), '400 bit/s');
  assert.equal(formatBitRate(537.5), '4.30 kbit/s');
  assert.equal(formatBitRate(1_500), '12.0 kbit/s');
  assert.equal(formatBitRate(38_750), '310 kbit/s');
  assert.equal(formatBitRate(125_000), '1.00 Mbit/s');
  assert.equal(formatBitRate(300_000), '2.40 Mbit/s');
  assert.equal(formatBitRate(11_875_000), '95.0 Mbit/s');
  assert.equal(formatBitRate(117_500_000), '940 Mbit/s');
  assert.equal(formatBitRate(125_000_000), '1.00 Gbit/s');
  assert.equal(formatBitRate(312_500_000), '2.50 Gbit/s');
});

test('formatBitRate picks the unit after rounding', () => {
  assert.equal(formatBitRate(124.95), '1.00 kbit/s'); // 999.6 bit/s
  assert.equal(formatBitRate(124.9), '999 bit/s');
  assert.equal(formatBitRate(124_999), '1.00 Mbit/s'); // 999.992 kbit/s
  assert.equal(formatBitRate(1249.6), '10.0 kbit/s'); // 9.9968 kbit/s
  assert.equal(formatBitRate(12_499.6), '100 kbit/s'); // 99.9968 kbit/s
});

test('formatBytes uses binary units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(12.4 * 1024 ** 3), '12.4 GB');
});

const PROC_STAT = `cpu  1000 100 400 8000 300 0 200 0 0 0
cpu0 600 50 200 3900 150 0 100 0 0 0
cpu1 400 50 200 4100 150 0 100 0 0 0
intr 123456 0 0
ctxt 987654
`;

test('parseProcStat reads the all-cores line and each core', () => {
  const s = parseProcStat(PROC_STAT);
  assert.deepEqual(s?.all, times({ user: 1000, nice: 100, system: 400, idle: 8000, iowait: 300, softirq: 200 }));
  assert.equal(s?.cores.length, 2);
  assert.deepEqual(s?.cores[1], times({ user: 400, nice: 50, system: 200, idle: 4100, iowait: 150, softirq: 100 }));
  assert.equal(parseProcStat('intr 1 2 3\n'), null);
});

test('parseProcStat copes with old kernels that have fewer columns', () => {
  assert.deepEqual(parseProcStat('cpu 10 0 5 85\n')?.all, times({ user: 10, system: 5, idle: 85 }));
});

test('cpuUseBetween splits busy time by kind of work and keeps I/O wait out of busy', () => {
  const a = { all: times({ user: 0, idle: 0 }), cores: [times({}), times({})] };
  const b = {
    // 1000 ticks across 2 cores: 300 apps (incl. nice), 100 kernel, 50 interrupts, 50 waiting on disk, 500 idle.
    all: times({ user: 250, nice: 50, system: 100, irq: 20, softirq: 30, iowait: 50, idle: 500 }),
    cores: [times({ user: 400, idle: 100 }), times({ user: 50, idle: 450 })],
  };
  const use = cpuUseBetween(a, b);
  assert.equal(use?.percent, 45);
  assert.equal(use?.apps, 30);
  assert.equal(use?.kernel, 10);
  assert.equal(use?.irq, 5);
  assert.equal(use?.iowait, 5);
  assert.deepEqual(use?.cores, [80, 10]);
});

test('cpuUseBetween with no time passed or a changed core count', () => {
  const s = { all: times({ user: 5, idle: 5 }), cores: [times({ user: 5, idle: 5 })] };
  assert.equal(cpuUseBetween(s, s), null);
  const later = { all: times({ user: 10, idle: 10 }), cores: [] };
  assert.deepEqual(cpuUseBetween(s, later)?.cores, []);
  assert.equal(cpuUseBetween(s, later)?.percent, 50);
});

test('cpuUseBetween ignores a counter ticking backwards', () => {
  const a = { all: times({ user: 0, iowait: 100, idle: 0 }), cores: [] };
  const b = { all: times({ user: 50, iowait: 90, idle: 50 }), cores: [] };
  assert.equal(cpuUseBetween(a, b)?.percent, 50);
  assert.equal(cpuUseBetween(a, b)?.iowait, 0);
});

test('toCpuDetail rounds for the API', () => {
  const d = toCpuDetail({ percent: 33.333, cores: [12.345, 0], apps: 20.06, kernel: 10.04, irq: 3.333, iowait: 0.04 }, [0.4249, 0.351, 0.3, 9], { mhz: 1500, maxMhz: 2400 });
  assert.deepEqual(d, { cores: [12.3, 0], apps: 20.1, kernel: 10, irq: 3.3, iowait: 0, load: [0.42, 0.35, 0.3], mhz: 1500, maxMhz: 2400 });
  assert.equal(toCpuDetail({ percent: 0, cores: [], apps: 0, kernel: 0, irq: 0, iowait: 0 }, [0, 0, 0], null).mhz, null);
});

test('formatClock', () => {
  assert.equal(formatClock(1500, 1800), '1.50 GHz of 1.80 GHz');
  assert.equal(formatClock(600, 2400), '600 MHz of 2.40 GHz');
  assert.equal(formatClock(1500, null), '1.50 GHz');
  assert.equal(formatClock(null, 1800), null);
});

test('describeLoad compares the load with the core count', () => {
  assert.deepEqual(describeLoad([0.42, 0.35, 0.3], 4), {
    text: 'Load 0.42 · 0.35 · 0.30',
    title: 'Average processes running or waiting over 1, 5 and 15 minutes. 4.00 would mean all 4 cores are in demand.',
  });
  assert.equal(describeLoad([0, 0, 0], 4), null); // Windows
  assert.equal(describeLoad([], 4), null);
});
