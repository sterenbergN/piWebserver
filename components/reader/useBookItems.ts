'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { inkFromScaled, readInk } from '@/components/notes/read-ink';
import type { Anchor, ReaderItem, Stroke } from '@/lib/reader/items';
import { getItems, getKv, putItems, putKv, type StoredItem } from './db';
import { noteBookChanged, syncBook } from './sync';

/** Handwritten notes are kept in card widths; this makes them about the size of real writing for reading. */
const CARD_POINTS = 600;

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('');

/**
 * One book's notes and pen marks. They're in this device's database first, and every
 * change goes there straight away, then up to the server when it can. `onUpdate` is for
 * the pen layer, which draws outside React.
 */
export function useBookItems(book: string, onUpdate?: () => void) {
  const map = useRef(new Map<string, StoredItem>());
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const notify = useRef(onUpdate);
  useEffect(() => { notify.current = onUpdate; });

  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    notify.current?.();
  }, []);

  const reload = useCallback(async () => {
    const stored = await getItems(book);
    map.current = new Map(stored.map((item) => [item.id, item]));
    setLoaded(true);
    changed();
  }, [book, changed]);

  const save = useCallback((item: StoredItem) => {
    map.current.set(item.id, item);
    changed();
    void putItems([item]).then(() => noteBookChanged(book));
  }, [book, changed]);

  /**
   * Have the server read handwritten notes that haven't been, so they can be searched and turned
   * into typed notes. One device reading it is enough: the text travels with the note. Offline, or
   * if reading isn't available, it waits for next time; a note that turned out to say nothing
   * readable isn't asked about again.
   */
  const reading = useRef(new Set<string>());
  const readSketches = useCallback(async () => {
    for (const item of [...map.current.values()]) {
      if (item.kind !== 'sketch' || item.deleted || item.text || !item.strokes?.length || reading.current.has(item.id)) continue;
      if (await getKv(`unreadable:${item.id}`)) continue;
      reading.current.add(item.id);
      try {
        const text = (await readInk(inkFromScaled(item.strokes, CARD_POINTS))).trim();
        const now = map.current.get(item.id);
        if (text && now && !now.deleted && !now.text) save({ ...now, text, updatedAt: Date.now(), dirty: true });
        if (!text) await putKv(`unreadable:${item.id}`, Date.now());
      } catch {
        break;
      } finally {
        reading.current.delete(item.id);
      }
    }
  }, [save]);

  useEffect(() => {
    let live = true;
    (async () => {
      await reload();
      // Whatever's come in from other devices. Offline, what's here is what there is.
      const news = await syncBook(book).catch(() => false);
      if (live && news) await reload();
      if (live) void readSketches();
    })();
    return () => { live = false; };
  }, [book, reload, readSketches]);

  const addInk = useCallback((anchor: Anchor, stroke: Stroke) => {
    const now = Date.now();
    const item: StoredItem = { id: newId(), kind: 'ink', book, anchor, stroke, createdAt: now, updatedAt: now, dirty: true };
    save(item);
    return item;
  }, [book, save]);

  const addNote = useCallback((anchor: Anchor, text: string) => {
    const now = Date.now();
    save({ id: newId(), kind: 'note', book, anchor, text, createdAt: now, updatedAt: now, dirty: true });
  }, [book, save]);

  const addSketch = useCallback((anchor: Anchor, strokes: Stroke[], aspect: number) => {
    const now = Date.now();
    save({ id: newId(), kind: 'sketch', book, anchor, strokes, aspect, createdAt: now, updatedAt: now, dirty: true });
    void readSketches();
  }, [book, save, readSketches]);

  /** A handwritten note swapped for a typed one that says the same, in the same place. */
  const makeTyped = useCallback((item: ReaderItem, text: string) => {
    const now = Date.now();
    save({ id: newId(), kind: 'note', book, anchor: item.anchor, text, createdAt: item.createdAt, updatedAt: now, dirty: true });
    const { text: _text, stroke: _stroke, strokes: _strokes, aspect: _aspect, ...rest } = item as StoredItem;
    save({ ...rest, deleted: true, updatedAt: now, dirty: true });
  }, [book, save]);

  const editNote = useCallback((item: ReaderItem, text: string) => {
    save({ ...(item as StoredItem), text, updatedAt: Date.now(), dirty: true });
  }, [save]);

  /** Gone, on every device. The content stays in memory for undo; the database keeps only the marker. */
  const remove = useCallback((item: ReaderItem) => {
    const { text: _text, stroke: _stroke, strokes: _strokes, aspect: _aspect, ...rest } = item as StoredItem;
    save({ ...rest, deleted: true, updatedAt: Date.now(), dirty: true });
  }, [save]);

  /** Undo a delete. */
  const restore = useCallback((item: ReaderItem) => {
    save({ ...(item as StoredItem), deleted: false, updatedAt: Date.now(), dirty: true });
  }, [save]);

  const all = useCallback(() => [...map.current.values()], []);

  return { all, version, loaded, reload, addInk, addNote, addSketch, editNote, makeTyped, remove, restore };
}
