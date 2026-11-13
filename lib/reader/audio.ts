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
