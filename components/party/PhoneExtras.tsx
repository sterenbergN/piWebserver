'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AVATARS, REACTIONS } from '@/lib/party/avatars';
import { GAME_GUIDES } from '@/lib/party/guides';
import { gamesForRoom } from '@/lib/party/catalog';
import { GameType } from '@/lib/party/types';

/** Emoji bar at the bottom of a phone: tap to throw a reaction onto the TV. */
export function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div className="party-reaction-bar" role="toolbar" aria-label="Send a reaction to the TV">
      {REACTIONS.map((e) => (
        <button key={e} aria-label={`React ${e}`} onClick={() => { navigator.vibrate?.(15); onReact(e); }}>{e}</button>
      ))}
    </div>
  );
}

/** One-tap Share / Copy Invite Link button for rooms. */
export function ShareInviteButton({ roomCode, compact = false }: { roomCode: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = `${window.location.origin}/party?code=${roomCode}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Join Party Room ${roomCode}`,
          text: `Join my party game with code ${roomCode}!`,
          url,
        });
        return;
      } catch {
        // User cancelled or share failed; fall back to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      title="Share or copy direct join link"
      style={{
        background: copied ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.08)',
        border: `1px solid ${copied ? 'var(--party-green)' : 'var(--party-border)'}`,
        borderRadius: compact ? '8px' : '12px',
        color: copied ? 'var(--party-green)' : 'var(--party-text)',
        fontSize: compact ? '0.75rem' : '0.85rem',
        fontWeight: 800,
        padding: compact ? '0.2rem 0.55rem' : '0.45rem 0.9rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? '✓ Copied Link!' : '🔗 Invite Link'}
    </button>
  );
}

/** Ultra-concise How to Play & Scoring modal (portaled to document.body). */
export function HowToPlayModal({
  initialGameType = 'quip-clash',
  onClose,
  onAction,
  actionLabel,
  phonesOnly = false,
}: {
  initialGameType?: string;
  onClose: () => void;
  onAction?: (gameType: GameType) => void;
  actionLabel?: string;
  phonesOnly?: boolean;
}) {
  const validInitial = (initialGameType in GAME_GUIDES ? initialGameType : 'quip-clash') as GameType;
  const [selected, setSelected] = useState<GameType>(validInitial);
  const guide = GAME_GUIDES[selected] || GAME_GUIDES['quip-clash'];
  const activePill = useRef<HTMLButtonElement>(null);

  // Games late in the list start off-screen in the pill row; bring the chosen one into view.
  useEffect(() => {
    activePill.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.84)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        backdropFilter: 'blur(6px)',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--party-surface)',
          border: '1.5px solid var(--party-border)',
          borderRadius: '22px',
          padding: '1.25rem',
          width: '100%',
          maxWidth: '460px',
          maxHeight: '90vh',
          overflowY: 'auto',
          margin: 'auto',
          boxShadow: 'var(--party-shadow-lg)',
          color: 'var(--party-text)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.9rem',
        }}
      >
        {/* Game Switcher Pills. flexShrink 0: as a scrolling flex item it would otherwise
            be squashed to nothing when a long guide overflows the modal. */}
        <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', flexShrink: 0, paddingBottom: '0.35rem', scrollbarWidth: 'thin' }}>
          {gamesForRoom(phonesOnly).map(({ id: gid }) => {
            const g = GAME_GUIDES[gid];
            const active = gid === selected;
            return (
              <button
                key={gid}
                ref={active ? activePill : undefined}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(gid)}
                style={{
                  background: active ? 'var(--party-purple, #7c3aed)' : 'rgba(255,255,255,0.06)',
                  border: `1.5px solid ${active ? 'var(--party-purple-lt)' : 'var(--party-border)'}`,
                  color: '#fff',
                  borderRadius: '999px',
                  padding: '0.25rem 0.65rem',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {g.emoji} {g.name}
              </button>
            );
          })}
        </div>

        {/* Title & Meta */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.45rem', margin: 0 }}>
              {guide.emoji} {guide.name}
            </h3>
            <div style={{ fontSize: '0.82rem', color: 'var(--party-text-muted)', fontWeight: 700, marginTop: '0.15rem' }}>
              {guide.players} · {guide.rounds}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close How to Play"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid var(--party-border)',
              color: 'var(--party-text)',
              borderRadius: '999px',
              width: '32px',
              height: '32px',
              fontWeight: 900,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Goal */}
        <div style={{ background: 'rgba(168, 85, 247, 0.12)', border: '1px solid rgba(168, 85, 247, 0.35)', borderRadius: '12px', padding: '0.65rem 0.85rem', fontSize: '0.9rem', fontWeight: 800 }}>
          🎯 <span style={{ color: 'var(--party-purple-lt)' }}>Goal:</span> {guide.goal}
        </div>

        {/* 3 Short Steps */}
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--party-cyan)', marginBottom: '0.45rem' }}>
            🕹️ How to Play (3 Steps)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {guide.steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '0.5rem 0.7rem', fontSize: '0.86rem', lineHeight: 1.35 }}>
                <span style={{ background: 'var(--party-cyan)', color: '#0b0b12', borderRadius: '999px', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '0.75rem', flexShrink: 0, marginTop: '0.05rem' }}>
                  {i + 1}
                </span>
                <span style={{ fontWeight: 600 }}>{step}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Scoring */}
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--party-yellow)', marginBottom: '0.4rem' }}>
            🏆 Scoring (Session Leaderboard)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', background: 'rgba(250, 204, 21, 0.07)', border: '1px solid rgba(250, 204, 21, 0.25)', borderRadius: '12px', padding: '0.6rem 0.8rem', fontSize: '0.82rem' }}>
            {guide.scoring.map((s, i) => (
              <div key={i} style={{ fontWeight: 700 }}>• {s}</div>
            ))}
          </div>
        </div>

        {/* Pro Tip */}
        <div style={{ fontSize: '0.8rem', color: 'var(--party-text-muted)', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '0.5rem 0.75rem' }}>
          💡 <strong>Tip:</strong> {guide.tip}
        </div>

        {/* Footer Buttons */}
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.15rem' }}>
          <button type="button" onClick={onClose} className="party-btn party-btn-outline" style={{ flex: 1, padding: '0.7rem', fontSize: '0.92rem' }}>
            Got It!
          </button>
          {onAction && actionLabel && (
            <button
              type="button"
              onClick={() => { onAction(selected); onClose(); }}
              className="party-btn party-btn-primary"
              style={{ flex: 1.3, padding: '0.7rem', fontSize: '0.92rem' }}
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Compact header buttons + modals for rules, editing name/avatar in-session, or leaving the room. */
export function PhoneSessionControls({
  roomCode,
  actorKey,
  currentName,
  currentAvatar,
  takenAvatars = [],
  isAudience = false,
  gameType = 'quip-clash',
  phonesOnly = false,
}: {
  roomCode: string;
  actorKey: string;
  currentName: string;
  currentAvatar?: string;
  takenAvatars?: string[];
  isAudience?: boolean;
  phonesOnly?: boolean;
  gameType?: string;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<'edit' | 'leave' | 'rules' | null>(null);
  const [name, setName] = useState(currentName);
  const [avatar, setAvatar] = useState(currentAvatar || AVATARS[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const openEdit = () => {
    setName(currentName);
    if (currentAvatar) setAvatar(currentAvatar);
    setErr('');
    setModal('edit');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setErr('Enter a nickname'); return; }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/party/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode,
          playerId: actorKey,
          action: {
            type: 'UPDATE_PROFILE',
            name: trimmed,
            ...(isAudience ? {} : { avatar }),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setErr(data.error || 'Could not update profile');
      } else {
        try {
          localStorage.setItem('partyNickname', trimmed);
          if (!isAudience && avatar) localStorage.setItem('partyAvatar', avatar);
        } catch { /* ignore */ }
        setModal(null);
      }
    } catch {
      setErr('Network error — try again');
    } finally {
      setSaving(false);
    }
  };

  const handleLeave = async () => {
    setSaving(true);
    try {
      await fetch('/api/party/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, playerId: actorKey, action: { type: 'LEAVE_ROOM' } }),
      });
    } catch { /* navigate anyway */ }
    try {
      localStorage.removeItem('partyLastPlayed');
    } catch { /* ignore */ }
    router.push('/party');
  };

  const takenSet = new Set(takenAvatars);

  const editModal = modal === 'edit' && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backdropFilter: 'blur(6px)', overflowY: 'auto' }}>
      <form onSubmit={handleSaveProfile} style={{ background: 'var(--party-surface)', border: '1px solid var(--party-border)', borderRadius: '20px', padding: '1.35rem', width: '100%', maxWidth: '380px', maxHeight: '90vh', overflowY: 'auto', margin: 'auto', boxShadow: 'var(--party-shadow-lg)', color: 'var(--party-text)' }}>
        <h3 style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.35rem', marginBottom: '1rem', textAlign: 'center' }}>
          ✏️ Edit Profile
        </h3>
        {err && <div className="party-error" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>⚠️ {err}</div>}
        <div className="party-form-group" style={{ marginBottom: '1rem' }}>
          <label className="party-label">Nickname</label>
          <input
            type="text"
            autoComplete="off"
            maxLength={16}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="party-input"
            style={{ fontSize: '1.1rem', fontWeight: 700, textAlign: 'center', padding: '0.75rem' }}
            placeholder="Enter nickname..."
            autoFocus
            required
          />
        </div>
        {!isAudience && (
          <div className="party-form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="party-label">Character {avatar}</label>
            <div className="party-avatar-grid" role="radiogroup" aria-label="Character">
              {AVATARS.map((a) => {
                const isTaken = takenSet.has(a) && a !== currentAvatar;
                return (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={avatar === a}
                    disabled={isTaken}
                    title={isTaken ? 'Taken by another player' : `Pick ${a}`}
                    className="party-avatar-option"
                    style={isTaken ? { opacity: 0.25, cursor: 'not-allowed' } : undefined}
                    onClick={() => setAvatar(a)}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" onClick={() => setModal(null)} disabled={saving} className="party-btn party-btn-outline" style={{ flex: 1, padding: '0.75rem', fontSize: '0.95rem' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className="party-btn party-btn-primary" style={{ flex: 1, padding: '0.75rem', fontSize: '0.95rem' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );

  const leaveModal = modal === 'leave' && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backdropFilter: 'blur(6px)', overflowY: 'auto' }}>
      <div style={{ background: 'var(--party-surface)', border: '2px solid rgba(239,68,68,0.45)', borderRadius: '20px', padding: '1.5rem', width: '100%', maxWidth: '360px', margin: 'auto', textAlign: 'center', boxShadow: 'var(--party-shadow-lg)', color: 'var(--party-text)' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚪</div>
        <h3 style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.35rem', marginBottom: '0.4rem' }}>Leave Room {roomCode}?</h3>
        <p style={{ color: 'var(--party-text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
          You will exit this session and return to the Party lobby.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" onClick={() => setModal(null)} disabled={saving} className="party-btn party-btn-outline" style={{ flex: 1, padding: '0.75rem', fontSize: '0.95rem' }}>
            Stay
          </button>
          <button type="button" onClick={handleLeave} disabled={saving} className="party-btn" style={{ flex: 1, padding: '0.75rem', fontSize: '0.95rem', background: 'var(--party-red)', color: '#fff' }}>
            {saving ? 'Leaving…' : 'Leave'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setModal('rules')}
          title="How to Play & Scoring"
          aria-label="How to Play"
          style={{
            background: 'rgba(6, 182, 212, 0.14)',
            border: '1px solid rgba(6, 182, 212, 0.45)',
            color: 'var(--party-cyan)',
            borderRadius: '8px',
            padding: '0.3rem 0.5rem',
            fontSize: '0.95rem',
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          ❓
        </button>
        <button
          type="button"
          onClick={openEdit}
          title="Change nickname or character"
          aria-label="Edit profile"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid var(--party-border)',
            color: 'var(--party-text)',
            borderRadius: '8px',
            padding: '0.3rem 0.5rem',
            fontSize: '0.95rem',
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          ✏️
        </button>
        <button
          type="button"
          onClick={() => setModal('leave')}
          title="Leave session"
          aria-label="Leave session"
          style={{
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.4)',
            color: 'var(--party-red)',
            borderRadius: '8px',
            padding: '0.3rem 0.5rem',
            fontSize: '0.95rem',
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          🚪
        </button>
      </div>
      {typeof document !== 'undefined' && editModal ? createPortal(editModal, document.body) : null}
      {typeof document !== 'undefined' && leaveModal ? createPortal(leaveModal, document.body) : null}
      {modal === 'rules' && <HowToPlayModal initialGameType={gameType} phonesOnly={phonesOnly} onClose={() => setModal(null)} />}
    </>
  );
}

// Canned answers for when your brain is empty (Jackbox's "safety quip").
const SAFETY_QUIPS = [
  'A suspiciously damp sock', 'My ex', 'Three raccoons in a trench coat', 'Taxes, but spicy', 'The Wi-Fi password',
  'A disappointed goose', 'Grandma’s secret recipe (it’s ketchup)', 'Crocs with socks', 'An emotional support cactus',
  'Whatever is in the office fridge', 'A motivational poster about naps', 'Nicolas Cage', 'Soup, but in a shoe',
  'Your browser history', 'A haunted Roomba', 'Mild disappointment', 'A llama with a lawyer', 'Gas station sushi',
];

export function safetyQuip() {
  return SAFETY_QUIPS[Math.floor(Math.random() * SAFETY_QUIPS.length)];
}

/** Buzz the phone when it's this player's turn to do something. */
export function useTurnBuzz(key: string | null, needsInput: boolean) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!key || key === last.current) return;
    const first = last.current === null;
    last.current = key;
    if (!first && needsInput) navigator.vibrate?.([60, 40, 60]);
  }, [key, needsInput]);
}
