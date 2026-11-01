'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Anchor, ReaderItem, Stroke } from '@/lib/reader/items';
import { getItems, putItems, type StoredItem } from './db';
import { noteBookChanged, syncBook } from './sync';

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

  useEffect(() => {
    let live = true;
    (async () => {
      await reload();
      // Whatever's come in from other devices. Offline, what's here is what there is.
      const news = await syncBook(book).catch(() => false);
      if (live && news) await reload();
    })();
    return () => { live = false; };
  }, [book, reload]);

  const save = useCallback((item: StoredItem) => {
    map.current.set(item.id, item);
    changed();
    void putItems([item]).then(() => noteBookChanged(book));
  }, [book, changed]);

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

  return { all, version, loaded, reload, addInk, addNote, addSketch, editNote, remove, restore };
}
