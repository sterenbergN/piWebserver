import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { KEYS_COMMAND, SECTION_TITLES, SHORTCUTS, groupBy, keyText, onPath, shortcutsFor, type Section } from './shortcuts';

test('ids are unique and every entry says what it does', () => {
  const ids = SHORTCUTS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SHORTCUTS) assert.ok(s.does.trim(), s.id);
});

test('every entry has something to press, type or read, and no empty combos', () => {
  for (const s of SHORTCUTS) {
    assert.ok(s.keys?.length || s.typed?.length || s.label, `${s.id} has nothing to show`);
    for (const combo of s.keys ?? []) assert.ok(combo.length > 0, s.id);
  }
});

test('no two entries share the same keys on the same page', () => {
  const seen = new Set<string>();
  for (const s of SHORTCUTS) {
    const sig = JSON.stringify([s.section, s.page ?? '', s.where ?? [], s.group ?? '', s.keys ?? [], s.typed ?? [], s.label ?? '']);
    assert.ok(!seen.has(sig), `${s.id} duplicates another entry`);
    seen.add(sig);
  }
});

test('every section has entries, and page entries say where they work', () => {
  for (const section of Object.keys(SECTION_TITLES) as Section[]) assert.ok(SHORTCUTS.some((s) => s.section === section), section);
  for (const s of SHORTCUTS.filter((x) => x.section === 'page')) {
    assert.ok(s.where?.length && s.page, `${s.id} needs where and page`);
    for (const p of s.where!) assert.ok(p.startsWith('/'), s.id);
  }
});

test('keys read per computer', () => {
  assert.equal(keyText({ mac: '⌘', pc: 'Ctrl' }, true), '⌘');
  assert.equal(keyText({ mac: '⌘', pc: 'Ctrl' }, false), 'Ctrl');
  assert.equal(keyText('Esc', true), 'Esc');
});

test('a page owns its path and what is under it, not look-alikes', () => {
  const reader = SHORTCUTS.find((s) => s.id === 'reader-turn')!;
  assert.ok(onPath(reader, '/reader'));
  assert.ok(onPath(reader, '/reader/abc'));
  assert.ok(!onPath(reader, '/readers'));
  const here = shortcutsFor('/notes');
  assert.ok(here.here.every((s) => s.page === 'Notes'));
  assert.ok(here.here.length > 0);
  assert.ok(!here.other.some((s) => s.page === 'Notes'));
  assert.equal(shortcutsFor('/').here.length, 0);
});

test('groupBy keeps order and puts ungrouped entries first', () => {
  const grouped = groupBy(SHORTCUTS.filter((s) => s.section === 'anywhere'), (s) => s.group);
  assert.equal(grouped[0][0], '');
  assert.ok(grouped.some(([g]) => g === 'Calculator'));
});

test('the key can be reached by its typed commands', () => {
  for (const text of ['/keys', '/shortcuts', '/help', '/KEYS ']) assert.ok(KEYS_COMMAND.test(text), text);
  for (const text of ['keys', 'help me', '/keysx']) assert.ok(!KEYS_COMMAND.test(text), text);
});

// The Navbar's keyboard handler is the one place shortcuts are invented, so check each of its keys is listed.
test('the keys the Navbar handles are all in the key', () => {
  const navbar = readFileSync(join(__dirname, '..', 'components', 'Navbar.tsx'), 'utf8');
  const handled: [string, string][] = [
    ["e.key === '/'", 'open-search'],
    ["e.key.toLowerCase() === 'k'", 'open-search'],
    ["e.key === '?'", 'open-ask'],
    ["e.code === 'KeyN'", 'open-note'],
    ["e.code === 'KeyC'", 'toggle-calc'],
    ["'/calc '", 'toggle-calc'],
    ["e.code === 'Slash'", 'open-keys'],
  ];
  for (const [snippet, id] of handled) {
    assert.ok(navbar.includes(snippet), `Navbar no longer contains ${snippet}: update this test and the entry ${id}`);
    assert.ok(SHORTCUTS.some((s) => s.id === id), `${id} missing from SHORTCUTS`);
  }
});
