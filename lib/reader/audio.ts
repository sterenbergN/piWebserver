// Audio books in the Reader, made from YouTube videos: which links count, what
// yt-dlp's description of a video becomes on the shelf, and how a listening
// position is told. Pure, so the server and the page can both use it, and tested
// in audio.test.ts. The downloading itself is in youtube.ts.

/** A chapter starts this many seconds in. */
export type AudioChapter = { start: number; title: string };
export type AudioInfo = { duration: number; chapters: AudioChapter[] };

/** Longest video that's taken (a whole audiobook is often 10–20 hours). */
export const MAX_AUDIO_SECONDS = 30 * 3600;
/** Most videos a playlist link adds. */
export const MAX_PLAYLIST = 200;

const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]{10,64}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export type YouTubeLink = { kind: 'video'; id: string; url: string } | { kind: 'playlist'; id: string; url: string };

/**
 * A YouTube link, tidied to the one address yt-dlp is given (nothing else from
 * the link reaches it). A video that's also in a playlist is just the video;
 * a playlist page is the whole playlist. Anything else is null.
 */
export function readYouTubeLink(raw: unknown): YouTubeLink | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const video = (id: string | null | undefined) => (id && VIDEO_ID.test(id) ? { kind: 'video' as const, id, url: `https://www.youtube.com/watch?v=${id}` } : null);
  if (url.hostname.toLowerCase() === 'youtu.be') return video(url.pathname.slice(1).split('/')[0]);
  const [, first, second] = url.pathname.split('/');
  if (first === 'watch') return video(url.searchParams.get('v')) ?? playlist(url.searchParams.get('list'));
  if (first === 'shorts' || first === 'live' || first === 'embed') return video(second);
  if (first === 'playlist') return playlist(url.searchParams.get('list'));
  return null;
}

function playlist(id: string | null): YouTubeLink | null {
  return id && LIST_ID.test(id) ? { kind: 'playlist', id, url: `https://www.youtube.com/playlist?list=${id}` } : null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const seconds = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Chapters in order, each with a title, starting inside the audio; one lone chapter isn't worth listing. */
export function cleanChapters(raw: unknown, duration: number): AudioChapter[] {
  if (!Array.isArray(raw)) return [];
  const out: AudioChapter[] = [];
  for (const c of raw.slice(0, 500)) {
    const start = seconds((c as { start_time?: unknown })?.start_time);
    const title = text((c as { title?: unknown })?.title, 200);
    if (start === null || start >= duration || !title) continue;
    if (out.length && start <= out[out.length - 1].start) continue;
    out.push({ start: Math.round(start * 10) / 10, title });
  }
  return out.length > 1 ? out : [];
}

export type VideoDetails = { id: string; title: string; author: string; duration: number; chapters: AudioChapter[]; thumbnail?: string; url: string };

/** What yt-dlp says about a video, as the shelf wants it. Throws with a reason worth showing. */
export function videoDetails(info: unknown): VideoDetails {
  const v = (info ?? {}) as Record<string, unknown>;
  const id = text(v.id, 20);
  if (!VIDEO_ID.test(id)) throw new Error('That doesn’t look like a single video.');
  if (v.is_live === true || v.live_status === 'is_live' || v.live_status === 'is_upcoming') throw new Error('Live streams can’t be saved until they’ve finished.');
  const duration = seconds(v.duration);
  if (!duration) throw new Error('That video has no length, so it can’t be saved.');
  if (duration > MAX_AUDIO_SECONDS) throw new Error(`That’s over ${MAX_AUDIO_SECONDS / 3600} hours long.`);
  const thumbs = Array.isArray(v.thumbnails) ? v.thumbnails as { url?: unknown; width?: unknown; preference?: unknown }[] : [];
  const best = thumbs
    .filter((t) => typeof t.url === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(t.url))
    .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0) || (Number(b.preference) || 0) - (Number(a.preference) || 0))[0];
  const thumbnail = typeof best?.url === 'string' ? best.url : typeof v.thumbnail === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(v.thumbnail) ? v.thumbnail : undefined;
  return {
    id,
    title: text(v.title, 300) || 'Untitled video',
    author: text(v.channel, 200) || text(v.uploader, 200),
    duration,
    chapters: cleanChapters(v.chapters, duration),
    ...(thumbnail ? { thumbnail } : {}),
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

/** The videos in yt-dlp's flat listing of a playlist, in order. */
export function playlistEntries(info: unknown): { title: string; videos: { id: string; title: string }[] } {
  const p = (info ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(p.entries) ? p.entries as Record<string, unknown>[] : [];
  const videos = entries.flatMap((e) => (typeof e?.id === 'string' && VIDEO_ID.test(e.id) ? [{ id: e.id, title: text(e.title, 300) }] : [])).slice(0, MAX_PLAYLIST);
  return { title: text(p.title, 80) || 'YouTube playlist', videos };
}

/** yt-dlp's progress lines (from our --progress-template): "dl <done> <total>". */
export function readProgressLine(line: string): number | null {
  const m = /^dl (\d+) (\d+|NA|None)(?: (\d+|NA|None))?/.exec(line.trim());
  if (!m) return null;
  const done = Number(m[1]);
  const total = Number(m[2]) || Number(m[3]) || 0;
  return total > 0 ? Math.min(1, done / total) : null;
}

/** "1:02:03" or "4:05". */
export function clock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "1 h 12 min", "38 min", "45 s". */
export function spoken(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** The chapter playing at `t`, if the book has chapters. */
export function chapterAt(chapters: AudioChapter[], t: number) {
  let index = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= t + 0.25) index = i;
  return index;
}

// ── Which sound to download, and how big it comes out ───────────────────────

/** What yt-dlp is asked for when a video's formats aren't listed: AAC first (kept as it is), then anything. */
export const ANY_AUDIO = 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best';
/** Sound that isn't AAC already is made AAC at this many kbit/s. */
export const ENCODE_KBPS = 96;
/** A book too long to fit at that rate is made at this one: plenty for a voice, and it always fits. */
export const LONG_KBPS = 64;

/** The rate to re-encode at, so `duration` seconds of it stays under `maxBytes`. */
export function encodeKbps(duration: number, maxBytes: number) {
  return (duration * ENCODE_KBPS * 1000) / 8 <= maxBytes * 0.95 ? ENCODE_KBPS : LONG_KBPS;
}

type Format = { id: string; aac: boolean; kbps: number; bytes: number | null };

/**
 * The format to ask yt-dlp for. The best AAC that fits under `maxBytes` is kept as it is. A
 * long audiobook's best sound can be over the limit (20 hours is about 1.1 GB), and it's
 * re-encoded smaller anyway, so the smallest one that's still good enough is fetched instead
 * of the biggest. With no formats listed, yt-dlp chooses.
 */
export function chooseFormat(info: unknown, duration: number, maxBytes: number): string {
  const raw = (info as { formats?: unknown } | null)?.formats;
  if (!Array.isArray(raw)) return ANY_AUDIO;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const listed = raw.flatMap((f: Record<string, unknown>) => {
    if (!f || typeof f.format_id !== 'string' || !/^[\w.-]{1,40}$/.test(f.format_id)) return [];
    if (f.vcodec !== 'none' || typeof f.acodec !== 'string' || f.acodec === 'none' || f.has_drm === true) return [];
    const kbps = num(f.abr) || num(f.tbr);
    const bytes = num(f.filesize) || num(f.filesize_approx) || (kbps ? kbps * 125 * duration : 0);
    const format: Format = { id: f.format_id, aac: f.acodec.startsWith('mp4a'), kbps, bytes: bytes || null };
    return [{ format, language: typeof f.language_preference === 'number' ? f.language_preference : -1 }];
  });
  // A video with dubbed tracks: only the original language's.
  const original = Math.max(...listed.map((f) => f.language));
  const formats = listed.filter((f) => f.language === original).map((f) => f.format);
  if (!formats.length) return ANY_AUDIO;

  const fits = formats.filter((f) => f.aac && f.bytes !== null && f.bytes <= maxBytes * 0.97).sort((a, b) => b.kbps - a.kbps)[0];
  if (fits) return `${fits.id}/${ANY_AUDIO}`;
  // Nothing fits as it is. If that's because sizes aren't known, let yt-dlp choose.
  if (formats.every((f) => f.bytes === null)) return ANY_AUDIO;
  const target = encodeKbps(duration, maxBytes);
  const enough = formats.filter((f) => f.kbps >= target * 0.9).sort((a, b) => a.kbps - b.kbps)[0];
  const source = enough ?? [...formats].sort((a, b) => b.kbps - a.kbps)[0];
  return `${source.id}/${ANY_AUDIO}`;
}

/** ffmpeg's `-progress` lines: how many seconds of sound it has written so far. */
export function readFfmpegProgress(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
  return m ? Number(m[1]) / 1_000_000 : null;
}

export type SoundInfo = { codec: string; rate: number; channels: string; duration: number | null };

/** What `ffmpeg -i file` says about a file's sound: its codec, rate and channels, and its exact length. */
export function readSoundInfo(output: string): SoundInfo | null {
  const stream = /Stream #\d+:\d+.*?: Audio: ([\w-]+)(?: \(([^)]*)\))?[^,\n]*, (\d+) Hz, ([\w. ()]+?)[,\n]/.exec(output);
  if (!stream) return null;
  const length = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(output);
  return {
    codec: stream[2] ? `${stream[1]} ${stream[2]}` : stream[1],
    rate: Number(stream[3]),
    channels: stream[4].trim(),
    duration: length ? Number(length[1]) * 3600 + Number(length[2]) * 60 + Number(length[3]) : null,
  };
}

// ── Chapters you can change, and books joined end to end ────────────────────

export const MAX_CHAPTERS = 500;

/** Chapters as someone edited them: in order, inside the audio, each with a name. Any number, even none. */
export function cleanEditedChapters(raw: unknown, duration: number): AudioChapter[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: AudioChapter[] = [];
  for (const c of raw.slice(0, MAX_CHAPTERS * 2)) {
    const start = seconds((c as { start?: unknown })?.start);
    const title = text((c as { title?: unknown })?.title, 200);
    if (start === null || !title || (duration > 0 && start >= duration)) continue;
    const at = Math.round(start * 10) / 10;
    if (seen.has(at)) continue;
    seen.add(at);
    out.push({ start: at, title });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, MAX_CHAPTERS);
}

export type AudioPart = { title: string; duration: number; chapters: AudioChapter[] };

/**
 * The chapters of several audio books played one after another. A part with no chapters of
 * its own is one chapter, named after it; a part that has them keeps them, moved along.
 */
export function joinChapters(parts: AudioPart[]): AudioInfo {
  const chapters: AudioChapter[] = [];
  let offset = 0;
  for (const part of parts) {
    const at = (start: number) => Math.round((offset + start) * 10) / 10;
    if (!part.chapters.length) chapters.push({ start: at(0), title: part.title });
    else {
      if (part.chapters[0].start > 1) chapters.push({ start: at(0), title: part.title });
      for (const c of part.chapters) if (c.start < part.duration) chapters.push({ start: at(c.start), title: c.title });
    }
    offset += part.duration;
  }
  return { duration: Math.round(offset * 10) / 10, chapters: chapters.slice(0, MAX_CHAPTERS) };
}

/** What a run of titles have in common at the front, as a name for them joined: "Dune, part 1" and "Dune, part 2" → "Dune". */
export function sharedTitle(titles: string[]) {
  if (!titles.length) return '';
  let shared = titles[0];
  for (const title of titles) {
    let i = 0;
    while (i < shared.length && i < title.length && shared[i].toLowerCase() === title[i].toLowerCase()) i += 1;
    shared = shared.slice(0, i);
  }
  const tidy = shared.replace(/\b(part|pt|chapter|ch|episode|ep|book|vol|volume|lecture|section|disc|cd)\.?\s*\d*$/i, '').replace(/[\s\-–—:|,.(\[#]+$/, '').trim();
  return tidy.length >= 3 ? tidy : '';
}

/** "1:02:03", "4:05" or "90" as seconds, or null if it isn't a time. */
export function readClock(value: string) {
  const parts = value.trim().split(':');
  if (!parts.length || parts.length > 3 || !parts.every((p) => /^\d{1,5}(\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}
