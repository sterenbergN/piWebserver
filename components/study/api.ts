'use client';

import { localToday } from '@/lib/habits/dates';

// Talking to /api/study: a 401 means signed out (the pages show a way in), and
// anything else that fails carries a message worth showing.

export class SignedOut extends Error {}

async function read<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new SignedOut();
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'Something went wrong. Try again.');
  return body as T;
}

export async function studyGet<T>(query = ''): Promise<T> {
  const params = new URLSearchParams(query);
  params.set('today', localToday());
  return read<T>(await fetch(`/api/study?${params}`, { cache: 'no-store' }));
}

export async function studyPost<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return read<T>(await fetch('/api/study', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, today: localToday(), ...payload }),
  }));
}

export async function practiceGet<T>(query = ''): Promise<T> {
  const params = new URLSearchParams(query);
  params.set('today', localToday());
  return read<T>(await fetch(`/api/study/practice?${params}`, { cache: 'no-store' }));
}

export async function practicePost<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return read<T>(await fetch('/api/study/practice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, today: localToday(), ...payload }),
  }));
}

export async function sharedGet<T>(query = ''): Promise<T> {
  return read<T>(await fetch(`/api/study/shared?${new URLSearchParams(query)}`, { cache: 'no-store' }));
}

export async function sharedPost<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return read<T>(await fetch('/api/study/shared', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  }));
}
