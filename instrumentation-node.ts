// Node.js-only startup work, loaded by instrumentation.ts (never bundled for the Edge runtime).
export async function registerNode() {
  {
    // An install deploy.sh had to roll back becomes one of the site's own tickets.
    const { fileDeployEvents } = await import('./lib/tickets/deploy-events');
    void fileDeployEvents().then((n) => { if (n) console.log(`Filed ${n} rolled-back install(s) as tickets`); }, () => {});

    // Nightly data backups (settings live in the admin page).
    const { startBackupScheduler } = await import('./lib/backup');
    startBackupScheduler();

    // Recordings that were being turned into text carry on after a restart, without waiting for
    // someone to open their notebook; checked again every few minutes in case one was missed.
    if (!(global as { _transcriptsResuming?: boolean })._transcriptsResuming) {
      (global as { _transcriptsResuming?: boolean })._transcriptsResuming = true;
      const resume = async () => {
        const { resumeAllTranscripts } = await import('./lib/notes/transcripts');
        const resumed = await resumeAllTranscripts().catch((error) => { console.error('Resuming transcripts failed', error); return 0; });
        if (resumed) console.log(`Transcripts waiting: ${resumed}`);
      };
      // Not straight away: the site answers its first pages before the model starts loading.
      setTimeout(() => void resume(), 30_000).unref();
      setInterval(() => void resume(), 10 * 60_000).unref();
    }

    // Try to prevent multiple intervals in dev mode HMR
    if (!(global as any)._statsCollectorStarted) {
      (global as any)._statsCollectorStarted = true;
      console.log('Starting background stats collector...');

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');
      const { cpuUseBetween, parseProcStat } = await import('./lib/system-stats');
      type CpuSample = import('./lib/system-stats').CpuSample;
      type CpuTimes = import('./lib/system-stats').CpuTimes;

      const execAsync = promisify(exec);
      // Keep the 1-minute collector's CPU baseline separate from lib/system-stats's
      // shared `getLiveRates()` state used by 10-second /api/stats polls.
      let prevCpuSample: CpuSample | null = null;

      const readCpuSample = async (): Promise<CpuSample> => {
        const proc = await fs.readFile('/proc/stat', 'utf8').then(parseProcStat).catch(() => null);
        if (proc) return proc;
        const cores: CpuTimes[] = os.cpus().map(({ times: t }) => ({
          user: t.user,
          nice: t.nice,
          system: t.sys,
          idle: t.idle,
          iowait: 0,
          irq: t.irq,
          softirq: 0,
          steal: 0,
        }));
        const all: CpuTimes = { user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 };
        for (const c of cores) {
          all.user += c.user;
          all.nice += c.nice;
          all.system += c.system;
          all.idle += c.idle;
          all.irq += c.irq;
        }
        return { all, cores };
      };
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
            
            // free -h gives human readable values like 2.3Gi, 512Mi, 256Ki, or 512B
            const parseHuman = (str: string | undefined) => {
              if (!str) return 0;
              const val = parseFloat(str) || 0;
              const upper = str.toUpperCase();
              if (upper.includes('T')) return val * 1024;
              if (upper.includes('G')) return val;
              if (upper.includes('M')) return val / 1024;
              if (upper.includes('K')) return val / (1024 * 1024);
              if (upper.includes('B')) return val / (1024 * 1024 * 1024);
              return val;
            };

            memUsed = parseHuman(usedRaw);
            memTotal = parseHuman(totalRaw);
          }

          // Real CPU use (busy time between readings), using this collector's own baseline.
          let cpuLoad: number | null = null;
          try {
            if (!prevCpuSample) {
              const first = await readCpuSample();
              await new Promise((r) => setTimeout(r, 1000));
              const next = await readCpuSample();
              const use = cpuUseBetween(first, next);
              prevCpuSample = next;
              cpuLoad = use ? Math.round(use.percent * 10) / 10 : null;
            } else {
              const curr = await readCpuSample();
              const use = cpuUseBetween(prevCpuSample, curr);
              prevCpuSample = curr;
              cpuLoad = use ? Math.round(use.percent * 10) / 10 : null;
            }
          } catch {
            cpuLoad = null;
          }

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
