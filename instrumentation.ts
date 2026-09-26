export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Nightly data backups (settings live in the admin page).
    const { startBackupScheduler } = await import('./lib/backup');
    startBackupScheduler();

    // Try to prevent multiple intervals in dev mode HMR
    if (!(global as any)._statsCollectorStarted) {
      (global as any)._statsCollectorStarted = true;
      console.log('Starting background stats collector...');

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const fs = await import('fs/promises');
      const path = await import('path');

      const execAsync = promisify(exec);
      // Private runtime data lives in .data (it used to be written into
      // public/, which served it statically and kept dirtying the repo).
      const STATS_HISTORY_FILE = path.join(process.cwd(), '.data', 'stats-history.json');
      const LEGACY_HISTORY_FILE = path.join(process.cwd(), 'public', 'stats-history.json');
      await fs.mkdir(path.dirname(STATS_HISTORY_FILE), { recursive: true });
      try {
        await fs.access(STATS_HISTORY_FILE);
      } catch {
        await fs.copyFile(LEGACY_HISTORY_FILE, STATS_HISTORY_FILE).catch(() => {});
      }
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

          // Unknown readings are stored as null rather than made-up numbers.
          const tempNum = tempStr === 'Unknown' ? null : parseFloat(tempStr.replace(/[^0-9.]/g, '')) || null;

          let memUsed: number | null = null, memTotal = 0;
          const memLines = freeOut.split('\n');
          if (memLines.length > 1) {
            const parts = memLines[1].trim().split(/\s+/).filter(Boolean);
            const usedRaw = parts[2];
            const totalRaw = parts[1];
            
            // free -h gives human readable like 2.3G or 512M
            const parseHuman = (str: string) => {
              const val = parseFloat(str) || 0;
              if (str.toUpperCase().includes('G')) return val;
              if (str.toUpperCase().includes('M')) return val / 1024;
              if (str.toUpperCase().includes('K')) return val / (1024 * 1024);
              return val;
            };

            memUsed = parseHuman(usedRaw);
            memTotal = parseHuman(totalRaw);
          }

          const { stdout: loadOut } = await execAsync('uptime || grep -cpu').catch(() => ({ stdout: '' }));
          let cpuLoad: number | null = null;
          const match = loadOut.match(/load average:\s+([0-9.]+)/);
          if (match) cpuLoad = parseFloat(match[1]) * 10; // Approx % for typical quad core

          const newEntry = {
            timestamp: new Date().toISOString(),
            temp: tempNum,
            ramUsed: memUsed, // Store in GB
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

          const tmp = `${STATS_HISTORY_FILE}.tmp`;
          await fs.writeFile(tmp, JSON.stringify(history));
          await fs.rename(tmp, STATS_HISTORY_FILE);

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
