import { NextResponse } from 'next/server';
import os from 'os';
import fs from 'fs/promises';
import { formatBitRate, formatBytes, getLiveRates } from '@/lib/system-stats';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const isWin = process.platform === 'win32';
    
    if (isWin) {
      return NextResponse.json({
        success: true,
        data: {
          platform: 'Windows (Mock Pi Node)',
          temp: '42.5°C',
          ram: 'Mock: 3.2GB / 8GB',
          storage: 'Mock: 15GB / 64GB (76% Free)',
          uptime: 'up 3 days, 4 hours, 12 minutes',
          cpu: '12.5',
          network: '↓ 2.40 Mbit/s | ↑ 310 kbit/s',
          networkTotal: '↓ 12.4 GB · ↑ 3.2 GB since boot'
        }
      });
    }

    // Temp
    let tempStr = 'Unknown';
    try {
      const tempOut = await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
      const tempVal = Number(tempOut.trim());
      if (!isNaN(tempVal)) {
        tempStr = `${(tempVal / 1000).toFixed(1)}°C`;
      }
    } catch {
      // Fallback: Could not read thermal zone.
      tempStr = 'N/A';
    }

    // RAM
    let ramStr = 'N/A';
    try {
      const meminfo = await fs.readFile('/proc/meminfo', 'utf8');
      let total = 0, available = 0;
      meminfo.split('\n').forEach((line: string) => {
        if (line.startsWith('MemTotal:')) {
          total = parseInt(line.split(/\s+/)[1], 10) * 1024;
        }
        if (line.startsWith('MemAvailable:')) {
          available = parseInt(line.split(/\s+/)[1], 10) * 1024;
        }
      });
      if (!available) {
        available = os.freemem();
      }
      if (!total) {
        total = os.totalmem();
      }
      const used = total - available;
      ramStr = `${formatBytes(used)} / ${formatBytes(total)}`;
    } catch {
      const total = os.totalmem();
      const free = os.freemem();
      const used = total - free;
      ramStr = `${formatBytes(used)} / ${formatBytes(total)}`;
    }

    // Storage
    let diskOutStr = 'N/A';
    try {
      const stat = await fs.statfs('.');
      const total = stat.blocks * stat.bsize;
      const free = stat.bavail * stat.bsize; // bavail is available to unprivileged users
      const used = total - free;
      const freePct = Math.round((free / total) * 100);
      diskOutStr = `${formatBytes(used)} / ${formatBytes(total)} (${freePct}% Free)`;
    } catch { /* fallback */ }

    // System uptime
    const upSecs = os.uptime();
    const days = Math.floor(upSecs / 86400);
    const hours = Math.floor((upSecs % 86400) / 3600);
    const minutes = Math.floor((upSecs % 3600) / 60);
    const upParts = [];
    if (days > 0) upParts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) upParts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (minutes > 0) upParts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    const uptimeStr = upParts.length > 0 ? `up ${upParts.join(', ')}` : 'up less than a minute';

    // CPU use and network speed, measured between this reading and the last one.
    let cpuStr = 'N/A';
    let networkStr = 'N/A';
    let networkTotalStr = '';
    try {
      const rates = await getLiveRates();
      cpuStr = rates.cpuPercent.toFixed(1);
      if (rates.since) {
        networkStr = `↓ ${formatBitRate(rates.rxPerSec)} | ↑ ${formatBitRate(rates.txPerSec)}`;
        networkTotalStr = `↓ ${formatBytes(rates.since.rx)} · ↑ ${formatBytes(rates.since.tx)} since boot`;
      }
    } catch { /* fallback */ }

    return NextResponse.json({
      success: true,
      data: {
        platform: 'Raspberry Pi',
        temp: tempStr,
        ram: ramStr,
        storage: diskOutStr,
        uptime: uptimeStr,
        cpu: cpuStr,
        network: networkStr,
        networkTotal: networkTotalStr
      }
    });
  } catch (error) {
    console.error("Stats Error:", error);
    return NextResponse.json({ success: false, message: "Error reading system stats" }, { status: 500 });
  }
}
