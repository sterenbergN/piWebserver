export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Try to prevent multiple intervals in dev mode HMR
    if (!(global as any)._statsCollectorStarted) {
      (global as any)._statsCollectorStarted = true;
      console.log('Starting background stats collector...');

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const fs = await import('fs/promises');
      const path = await import('path');

      const execAsync = promisify(exec);
      const STATS_HISTORY_FILE = path.join(process.cwd(), 'public', 'stats-history.json');
      const MAX_HISTORY_POINTS = 60 * 24; // 24 hours of minute-by-minute data

      async function collectStats() {
        try {
          const { stdout: osOut } = await execAsync('uname -rs').catch(() => ({ stdout: '' }));
          const { stdout: tempOut } = await execAsync('vcgencmd measure_temp || cat /sys/class/thermal/thermal_zone0/temp').catch(() => ({ stdout: '' }));
          const { stdout: freeOut } = await execAsync('free -h').catch(() => ({ stdout: '' }));
          
          // Fallbacks for Windows dev env
          let tempStr = 'Unknown';
          if (tempOut.includes('temp=')) tempStr = tempOut.replace('temp=', '').trim().replace("'", '°');
          else if (!isNaN(Number(tempOut.trim())) && tempOut.trim() !== '') tempStr = `${(Number(tempOut.trim()) / 1000).toFixed(1)}°C`;
          else tempStr = '45.0°C'; // Fake for Windows

          const tempNum = parseFloat(tempStr.replace(/[^0-9.]/g, '')) || 0;

          let memUsed = 0, memTotal = 0;
          const memLines = freeOut.split('\n');
          if (memLines.length > 1) {
            const parts = memLines[1].trim().split(/\s+/).filter(Boolean);
            const usedRaw = parts[2];
            const totalRaw = parts[1];
            memUsed = parseFloat(usedRaw) || 0;
            memTotal = parseFloat(totalRaw) || 1;
          } else {
            memUsed = 2.4; memTotal = 8.0; 
          }

          const { stdout: loadOut } = await execAsync('uptime || grep -cpu').catch(() => ({ stdout: '' }));
          let cpuLoad = 0;
          const match = loadOut.match(/load average:\s+([0-9.]+)/);
          if (match) cpuLoad = parseFloat(match[1]) * 10; // Approx % for typical quad core
          else cpuLoad = 15.5; // fake

          const newEntry = {
            timestamp: new Date().toISOString(),
            temp: tempNum,
            ramUsage: (memUsed / memTotal) * 100,
            cpuLoad: cpuLoad
          };

          let history: any[] = [];
          try {
            const raw = await fs.readFile(STATS_HISTORY_FILE, 'utf-8');
            history = JSON.parse(raw);
          } catch {
            history = [];
          }

          history.push(newEntry);

          // Keep only last 24 hours
          if (history.length > MAX_HISTORY_POINTS) {
            history = history.slice(history.length - MAX_HISTORY_POINTS);
          }

          await fs.writeFile(STATS_HISTORY_FILE, JSON.stringify(history));

        } catch (err) {
          console.error('Stats collector failed', err);
        }
      }

      // Initial run
      collectStats();
      // Run every minute
      setInterval(collectStats, 60 * 1000);
    }
  }
}
