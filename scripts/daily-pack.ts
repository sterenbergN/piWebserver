// Daily question packs from the command line: check them, upload them to the
// site, and read back what the weekly generator needs (what's scheduled,
// feedback, notes). Uploads go straight to the Pi; nothing goes through git.
//
//   npm run daily -- validate <pack.json>      check with the site's own validator
//   npm run daily -- status                    days ready ahead, last scheduled day
//   npm run daily -- history [days]            recent questions (track, topic, difficulty), default 60 days
//   npm run daily -- upload <pack.json>        validate, then upload (replaces those dates)
//   npm run daily -- feedback [--since DATE]   per-question results, ratings and reports
//   npm run daily -- weak                      everyone's weakest topics (where practice questions help most)
//   npm run daily -- practice                  the practice-only questions already uploaded
//   npm run daily -- notes                     print the generator notes
//   npm run daily -- notes --set <file.md>     replace the generator notes
//
// Settings (environment, or KEY=value lines in daily-packs/.env, which git ignores):
//   DAILY_SITE_URL      default https://noahstuf.com
//   DAILY_UPLOAD_TOKEN  the same value as DAILY_UPLOAD_TOKEN in the Pi's shared/env

import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { validatePack } from '../lib/daily/validate';
import { addDays, localToday } from '../lib/habits/dates';

function settings() {
  const fromFile: Record<string, string> = {};
  if (existsSync('daily-packs/.env')) {
    for (const line of readFileSync('daily-packs/.env', 'utf-8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const site = (process.env.DAILY_SITE_URL || fromFile.DAILY_SITE_URL || 'https://noahstuf.com').replace(/\/+$/, '');
  const token = process.env.DAILY_UPLOAD_TOKEN || fromFile.DAILY_UPLOAD_TOKEN || '';
  return { site, token };
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

async function api(pathAndQuery: string, init: RequestInit = {}) {
  const { site, token } = settings();
  if (!token) fail('No upload token: set DAILY_UPLOAD_TOKEN in the environment or in daily-packs/.env');
  let res: Response;
  try {
    res = await fetch(`${site}${pathAndQuery}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  } catch (error) {
    fail(`Couldn't reach ${site}: ${(error as Error).message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    const details = Array.isArray(body.errors) ? `\n  - ${body.errors.join('\n  - ')}` : '';
    fail(`${init.method || 'GET'} ${pathAndQuery} failed (${res.status}): ${body.message || res.statusText}${details}`);
  }
  return body;
}

async function readPack(file: string | undefined) {
  if (!file) fail('Give a pack file, e.g. daily-packs/2026-11-04_2026-11-17.json', 2);
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch (error) {
    fail(`Couldn't read ${file}: ${(error as Error).message}`, 2);
  }
  const { pack, errors } = validatePack(raw);
  if (!pack) fail(`${file}: ${errors.length} problem${errors.length === 1 ? '' : 's'}\n  - ${errors.join('\n  - ')}`);
  return pack;
}

type DaySummary = { date: string; boss: boolean; questions: { id: string; title: string; track: string; topic: string; difficulty: number; core: boolean }[] };

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const today = localToday();

  switch (command) {
    case 'validate': {
      const pack = await readPack(args[0]);
      const dates = pack.days.map((d) => d.date).sort();
      const questions = pack.days.reduce((n, d) => n + 1 + d.bonus.length, 0);
      const span = dates.length ? ` (${dates[0]} … ${dates[dates.length - 1]})` : '';
      console.log(`${args[0]}: OK — ${pack.days.length} days${span}, ${questions} questions${pack.practice ? `, ${pack.practice.questions.length} practice questions` : ''}`);
      return;
    }
    case 'status': {
      const body = await api(`/api/daily/admin?today=${today}`);
      const days: DaySummary[] = body.days;
      const future = days.filter((d) => d.date >= today);
      console.log(JSON.stringify({
        today,
        readyAhead: body.buffer,
        firstGap: addDays(today, body.buffer),
        lastScheduled: days.length ? days[days.length - 1].date : null,
        scheduledFromToday: future.length,
        totalStored: days.length,
      }, null, 2));
      return;
    }
    case 'history': {
      const span = Number(args[0]) || 60;
      const body = await api(`/api/daily/admin?today=${today}`);
      const from = addDays(today, -span);
      const rows = (body.days as DaySummary[]).filter((d) => d.date >= from).flatMap((d) =>
        d.questions.map((q) => ({ date: d.date, boss: d.boss && q.core, core: q.core, track: q.track, topic: q.topic, difficulty: q.difficulty, title: q.title, id: q.id })));
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    case 'upload': {
      const pack = await readPack(args[0]);
      const body = await api(`/api/daily/admin?today=${today}`, { method: 'PUT', body: JSON.stringify(pack) });
      console.log(`Uploaded ${body.dates.length} days (${body.added} new, ${body.replaced} replaced). Ready ahead from today: ${body.buffer} days.`);
      if (body.practice) console.log(`Practice questions: ${body.practice.added} new, ${body.practice.replaced} replaced, ${body.practice.total} in all.`);
      return;
    }
    case 'feedback': {
      const i = args.indexOf('--since');
      const since = i >= 0 ? args[i + 1] : '';
      const body = await api(`/api/daily/feedback${since ? `?since=${since}` : ''}`);
      console.log(JSON.stringify(body.questions, null, 2));
      return;
    }
    case 'weak': {
      const body = await api('/api/daily/feedback');
      console.log(JSON.stringify(body.topics, null, 2));
      return;
    }
    case 'practice': {
      const body = await api(`/api/daily/admin?today=${today}`);
      console.log(JSON.stringify(body.practice, null, 2));
      return;
    }
    case 'notes': {
      const i = args.indexOf('--set');
      if (i >= 0) {
        const file = args[i + 1];
        if (!file) fail('notes --set needs a file', 2);
        const notes = await fs.readFile(file, 'utf-8');
        await api('/api/daily/admin/notes', { method: 'PUT', body: JSON.stringify({ notes }) });
        console.log(`Notes replaced (${notes.length} characters).`);
      } else {
        const body = await api('/api/daily/admin/notes');
        process.stdout.write(body.notes || '(no notes yet)\n');
      }
      return;
    }
    default:
      fail('Commands: validate <pack.json> | status | history [days] | upload <pack.json> | feedback [--since DATE] | weak | practice | notes [--set file.md]', 2);
  }
}

main();
