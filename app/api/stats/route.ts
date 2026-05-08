import { NextResponse } from 'next/server';
import os from 'os';
import fs from 'fs/promises';

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
          network: '↓ 12.4 GB | ↑ 3.2 GB'
        }
      });
    }

    // Helper for formatting bytes
    const formatBytes = (bytes: number) => {
      if (isNaN(bytes) || bytes === 0) return '0 B';
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    };

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

    // CPU load (1-minute average)
    let cpuStr = 'N/A';
    try {
      const cores = os.cpus().length;
      const loadAvg = os.loadavg()[0];
      cpuStr = Math.min(100, (loadAvg / cores) * 100).toFixed(1);
    } catch { /* fallback */ }

    // Network bandwidth (total traffic)
    let networkStr = 'N/A';
    try {
      const netOut = await fs.readFile('/proc/net/dev', 'utf8');
      const lines = netOut.split('\n');
      let rxBytes = 0;
      let txBytes = 0;
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('lo:')) continue;
        const parts = line.split(/[:\s]+/);
        if (parts.length >= 10) {
          const rx = parseInt(parts[1], 10);
          const tx = parseInt(parts[9], 10);
          if (!isNaN(rx)) rxBytes += rx;
          if (!isNaN(tx)) txBytes += tx;
        }
      }
      networkStr = `↓ ${formatBytes(rxBytes)} | ↑ ${formatBytes(txBytes)}`;
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
        network: networkStr
      }
    });
  } catch (error) {
    console.error("Stats Error:", error);
    return NextResponse.json({ success: false, message: "Error reading system stats" }, { status: 500 });
  }
}
