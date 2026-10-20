'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clearWorkoutCache } from '@/lib/workout/offline-cache';

export type NavUser = { username: string } | null;

/**
 * Sign-in chip for the navbar. Accounts are the workout accounts (created by the
 * admin); one sign-in covers every page that remembers you. Everything still
 * works signed out, it just stays on this device.
 */
export default function AccountMenu({ user }: { user: NavUser }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the signed-in menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const signOut = async () => {
    await fetch('/api/workout/auth', { method: 'DELETE' });
    clearWorkoutCache();
    window.location.reload();
  };

  if (!user) {
    return (
      <>
        <button className="nav-account" onClick={() => setDialogOpen(true)} aria-label="Sign in" title="Sign in">
          <span aria-hidden>👤</span>
        </button>
        {dialogOpen && <SignInDialog onClose={() => setDialogOpen(false)} />}
      </>
    );
  }

  return (
    <div className="nav-group" ref={wrapRef}>
      <button
        className="nav-account is-signed-in"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-controls="nav-account-menu"
        title={`Signed in as ${user.username}`}
      >
        <span className="nav-avatar" aria-hidden>{user.username.slice(0, 1).toUpperCase()}</span>
        <span className="nav-account-name">{user.username}</span>
      </button>
      {menuOpen && (
        <div className="nav-menu is-right" id="nav-account-menu">
          <div className="nav-menu-panel">
            <p className="nav-menu-note">Signed in as <strong>{user.username}</strong></p>
            <Link href="/workout" onClick={() => setMenuOpen(false)}><span aria-hidden>🏋️</span>Workout</Link>
            <button type="button" onClick={signOut}><span aria-hidden>🚪</span>Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/workout/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        // A full reload so every page (and the navbar) picks up the new account.
        window.location.reload();
        return;
      }
      setError(data.message || 'Sign in failed.');
    } catch {
      setError('Network error. Try again.');
    }
    setBusy(false);
  };

  // Portal: the navbar would otherwise trap this fixed overlay inside it.
  return createPortal(
    <div className="signin-backdrop" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={onClose}>
      <form className="signin-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="signin-title">Sign in</h2>
        <p className="signin-sub">Saves your workouts, habits and daily questions to your account. Everything also works without signing in, on this device only.</p>
        <label htmlFor="signin-username" className="sr-only">Username</label>
        <input id="signin-username" ref={inputRef} name="username" autoComplete="username" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="signin-password" className="sr-only">Password</label>
        <input id="signin-password" name="password" type="password" autoComplete="current-password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="signin-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <p className="signin-foot">No account? Accounts are made by Noah, so just ask.</p>
      </form>
    </div>,
    document.body,
  );
}
