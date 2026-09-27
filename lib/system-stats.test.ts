import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBitRate, formatBytes, parseNetDev, ratesBetween } from './system-stats';

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

test('ratesBetween gives per-second speed and CPU use', () => {
  const a = { at: 0, net: { rx: 1000, tx: 500 }, cpu: { idle: 700, total: 1000 } };
  const b = { at: 10_000, net: { rx: 1_251_000, tx: 10_500 }, cpu: { idle: 1500, total: 2000 } };
  const r = ratesBetween(a, b);
  assert.equal(r.rxPerSec, 125_000);
  assert.equal(r.txPerSec, 1_000);
  assert.equal(Math.round(r.cpuPercent), 20);
});

test('ratesBetween returns null when counters reset', () => {
  const r = ratesBetween({ at: 0, net: { rx: 9000, tx: 9000 }, cpu: { idle: 0, total: 0 } }, { at: 1000, net: { rx: 10, tx: 10 }, cpu: { idle: 0, total: 0 } });
  assert.equal(r.rxPerSec, null);
  assert.equal(r.cpuPercent, 0);
});

test('formatBitRate reads like a router', () => {
  assert.equal(formatBitRate(null), '—');
  assert.equal(formatBitRate(50), '400 bit/s');
  assert.equal(formatBitRate(125_000), '1.00 Mbit/s');
  assert.equal(formatBitRate(1_500), '12 kbit/s');
  assert.equal(formatBytes(1536), '1.5 KB');
});
