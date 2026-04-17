import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

    // Temp
    const { stdout: tempOut } = await execAsync('vcgencmd measure_temp || cat /sys/class/thermal/thermal_zone0/temp');
    let tempStr = 'Unknown';
    if (tempOut.includes('temp=')) {
      tempStr = tempOut.replace('temp=', '').trim().replace("'", '°');
    } else if (!isNaN(Number(tempOut.trim()))) {
      tempStr = `${(Number(tempOut.trim()) / 1000).toFixed(1)}°C`;
    }

    // RAM
    const { stdout: ramOut } = await execAsync("free -h | awk '/^Mem:/ {print $3 \" / \" $2}'");

    // Storage
    const { stdout: diskOut } = await execAsync("df -h . | awk 'NR==2 {print $3 \" / \" $2 \" (\" $4 \" Free)\"}'");

    // System uptime
    let uptimeStr = 'N/A';
    try {
      const { stdout: upOut } = await execAsync('uptime -p');
      uptimeStr = upOut.trim();
    } catch { /* fallback */ }

    // CPU load (1-minute average from /proc/loadavg)
    let cpuStr = 'N/A';
    try {
      const { stdout: loadOut } = await execAsync("cat /proc/loadavg | awk '{print $1}'");
      // Convert load average to approximate percentage (nCPUs × 100% = full load)
      const { stdout: coreOut } = await execAsync("nproc");
      const cores = parseInt(coreOut.trim()) || 1;
      const loadAvg = parseFloat(loadOut.trim());
      cpuStr = Math.min(100, (loadAvg / cores) * 100).toFixed(1);
    } catch { /* fallback */ }

    // Network bandwidth (total traffic)
    let networkStr = 'N/A';
    try {
      const { stdout: netOut } = await execAsync("cat /proc/net/dev | awk 'NR>2 {if ($1 !~ /lo:/) {rx+=$2; tx+=$10}} END {print rx \"|\" tx}'");
      const [rxBytes, txBytes] = netOut.trim().split('|').map(Number);
      
      const formatBytes = (bytes: number) => {
        if (isNaN(bytes)) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
      };
      
      networkStr = `↓ ${formatBytes(rxBytes)} | ↑ ${formatBytes(txBytes)}`;
    } catch { /* fallback */ }

    return NextResponse.json({
      success: true,
      data: {
        platform: 'Raspberry Pi',
        temp: tempStr || 'N/A',
        ram: ramOut ? ramOut.trim() : 'N/A',
        storage: diskOut ? diskOut.trim() : 'N/A',
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
