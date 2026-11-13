import test from 'node:test';
import { strict as assert } from 'node:assert';
import { chapterAt, cleanChapters, clock, playlistEntries, readProgressLine, readYouTubeLink, spoken, videoDetails } from './audio';
import { progressText } from './items';

test('YouTube links are tidied, and nothing else gets through', () => {
  const v = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.deepEqual(readYouTubeLink('https://youtu.be/dQw4w9WgXcQ?t=42'), { kind: 'video', id: 'dQw4w9WgXcQ', url: v });
  assert.deepEqual(readYouTubeLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890&index=3'), { kind: 'video', id: 'dQw4w9WgXcQ', url: v }, 'a video in a playlist is the video');
  assert.equal(readYouTubeLink('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.url, v);
  assert.equal(readYouTubeLink('  https://music.youtube.com/watch?v=dQw4w9WgXcQ ')?.url, v);
  assert.deepEqual(readYouTubeLink('https://www.youtube.com/playlist?list=PLabcdefghij'), { kind: 'playlist', id: 'PLabcdefghij', url: 'https://www.youtube.com/playlist?list=PLabcdefghij' });
  for (const bad of ['https://evil.example/watch?v=dQw4w9WgXcQ', 'file:///etc/passwd', 'https://www.youtube.com/watch?v=--exec', 'https://www.youtube.com/@channel', 'not a url', 42, 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ']) {
    assert.equal(readYouTubeLink(bad), null, String(bad));
  }
});

test('a video’s details: chapters, cover, and the ones that are refused', () => {
  const info = {
    id: 'dQw4w9WgXcQ', title: '  Rocket  propulsion,   lecture 1 ', channel: 'MIT OCW', duration: 3600,
    chapters: [{ start_time: 0, title: 'Intro' }, { start_time: 600, title: 'Thrust' }, { start_time: 600, title: 'Duplicate' }, { start_time: 4000, title: 'Past the end' }],
    thumbnails: [{ url: 'https://i.ytimg.com/vi/x/default.jpg', width: 120 }, { url: 'https://i.ytimg.com/vi/x/maxres.jpg', width: 1280 }, { url: 'https://evil.example/x.jpg', width: 9999 }],
  };
  const d = videoDetails(info);
  assert.equal(d.title, 'Rocket propulsion, lecture 1');
  assert.equal(d.author, 'MIT OCW');
  assert.deepEqual(d.chapters, [{ start: 0, title: 'Intro' }, { start: 600, title: 'Thrust' }]);
  assert.equal(d.thumbnail, 'https://i.ytimg.com/vi/x/maxres.jpg');
  assert.equal(d.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.deepEqual(cleanChapters([{ start_time: 0, title: 'Only one' }], 100), [], 'one chapter isn’t worth listing');
  assert.throws(() => videoDetails({ ...info, is_live: true }), /Live/);
  assert.throws(() => videoDetails({ ...info, duration: 31 * 3600 }), /hours long/);
  assert.throws(() => videoDetails({ ...info, duration: undefined }), /no length/);
  assert.throws(() => videoDetails({ _type: 'playlist' }), /single video/);
});

test('playlists, progress lines and times', () => {
  assert.deepEqual(playlistEntries({ title: 'Lectures', entries: [{ id: 'dQw4w9WgXcQ', title: 'One' }, { id: 'bad' }, { id: 'aaaaaaaaaaa' }] }), { title: 'Lectures', videos: [{ id: 'dQw4w9WgXcQ', title: 'One' }, { id: 'aaaaaaaaaaa', title: '' }] });
  assert.equal(readProgressLine('dl 50 200 NA'), 0.25);
  assert.equal(readProgressLine('dl 50 NA 100'), 0.5, 'an estimate when the size isn’t known');
  assert.equal(readProgressLine('dl 50 NA NA'), null);
  assert.equal(readProgressLine('[download] Destination: x'), null);
  assert.equal(clock(3723), '1:02:03');
  assert.equal(clock(65), '1:05');
  assert.equal(spoken(4320), '1 h 12 min');
  assert.equal(spoken(2280), '38 min');
  assert.equal(chapterAt([{ start: 0, title: 'a' }, { start: 60, title: 'b' }], 59.9), 1, 'just before a chapter counts as it (seeks land a hair early)');
  assert.equal(chapterAt([{ start: 0, title: 'a' }, { start: 60, title: 'b' }], 30), 0);
  assert.equal(progressText({ anchor: { page: 1800 }, pct: 0.5, at: 1, total: 3600, startedAt: 1 }, 'audio'), '50% · 30 min left');
  assert.equal(progressText(undefined, 'audio'), 'Not started listening');
  assert.equal(progressText({ anchor: { page: 12 }, pct: 0.5, at: 1, total: 24, startedAt: 1 }), '50% · p. 12 of 24', 'books are unchanged');
});
