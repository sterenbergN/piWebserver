'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { announceAccountChange, signOut } from './account-session';
import { useHomeScreen } from './AddToHomeScreen';
import { useTheme } from './ThemeProvider';
import FeedbackLink from '@/components/tickets/FeedbackLink';

export type NavUser = { username: string; /** Starts on PA Today, not the main site. */ studyHome?: boolean } | null;

/**
 * Sign-in chip for the navbar. Personal accounts unlock and sync personal rooms
 * (Today, Daily Questions, Study, Reader, Notes, Journal, Skills, Habits, Chores,
 * Kitchen, Workouts) across devices. Site Admin sign-in is separate and manages
 * site publishing & settings (shown here when signed in as admin).
 */
export default function AccountMenu({ user, isAdmin }: { user: NavUser; isAdmin: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const homeScreen = useHomeScreen();
  const { theme, toggleTheme } = useTheme();

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

  // Pages can open the sign-in dialog with window.dispatchEvent(new Event('site:sign-in')).
  useEffect(() => {
    const open = () => setDialogOpen(true);
    window.addEventListener('site:sign-in', open);
    return () => window.removeEventListener('site:sign-in', open);
  }, []);

  const name = user?.username ?? 'Admin';

  if (!user && !isAdmin) {
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
        title={`Signed in as ${name}`}
      >
        <span className="nav-avatar" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
        <span className="nav-account-name">{name}</span>
      </button>
      {menuOpen && (
        <div className="nav-menu is-right" id="nav-account-menu">
          <div className="nav-menu-panel">
            <p className="nav-menu-note">Signed in as <strong>{name}</strong></p>
            {user ? (
              <>
                {user.studyHome && <Link href="/study" onClick={() => setMenuOpen(false)}><span aria-hidden>🩺</span>PA Today</Link>}
                <Link href="/today" onClick={() => setMenuOpen(false)}><span aria-hidden>☀️</span>Today</Link>
                <Link href="/daily" onClick={() => setMenuOpen(false)}><span aria-hidden>🧠</span>Questions</Link>
                <Link href="/habits" onClick={() => setMenuOpen(false)}><span aria-hidden>✅</span>Habits</Link>
                <Link href="/chores" onClick={() => setMenuOpen(false)}><span aria-hidden>🧹</span>Chores</Link>
                <Link href="/household" onClick={() => setMenuOpen(false)}><span aria-hidden>🏠</span>Household</Link>
                <Link href="/journal" onClick={() => setMenuOpen(false)}><span aria-hidden>📓</span>Journal</Link>
                <Link href="/recipes?view=list" onClick={() => setMenuOpen(false)}><span aria-hidden>🛒</span>Grocery list</Link>
                <Link href="/workout" onClick={() => setMenuOpen(false)}><span aria-hidden>🏋️</span>Workout</Link>
                <a href="/api/account/export" download onClick={() => setMenuOpen(false)}><span aria-hidden>📦</span>Download my data</a>
                {!homeScreen.installed && <button type="button" onClick={() => { setMenuOpen(false); homeScreen.add(); }}><span aria-hidden>📲</span>Add this page to home screen</button>}
                {homeScreen.installed && homeScreen.canPickIcon() && <button type="button" onClick={() => { setMenuOpen(false); homeScreen.changeIcon(); }}><span aria-hidden>🎨</span>Home screen icon</button>}
              </>
            ) : (
              <button type="button" onClick={() => { setMenuOpen(false); setDialogOpen(true); }}><span aria-hidden>👤</span>Sign in to your account</button>
            )}
            {isAdmin && <Link href="/admin" onClick={() => setMenuOpen(false)}><span aria-hidden>🔧</span>Admin</Link>}
            <FeedbackLink onOpen={() => setMenuOpen(false)}><span aria-hidden>💬</span>Feedback</FeedbackLink>
            <button type="button" onClick={() => { toggleTheme(); setMenuOpen(false); }}>
              <span aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <button type="button" onClick={signOut}><span aria-hidden>🚪</span>Sign out</button>
          </div>
        </div>
      )}
      {dialogOpen && <SignInDialog onClose={() => setDialogOpen(false)} />}
      {homeScreen.dialog}
    </div>
  );
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { theme, toggleTheme } = useTheme();

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
        announceAccountChange();
        // Signing in on the home page takes you to your own; anywhere else, you stay where you were going.
        if (data.user?.studyHome && window.location.pathname === '/') {
          window.location.assign('/study');
          return;
        }
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <h2 id="signin-title">Sign in</h2>
          <button
            type="button"
            className="nav-theme"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
        <p className="signin-sub">Personal accounts unlock and sync your personal rooms (Today, Daily Questions, Study, Reader, Notes, Journal, Skills, Habits, Chores, Kitchen, and Workouts) across devices. Site Admin sign-in is separate and manages site publishing &amp; settings.</p>
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
