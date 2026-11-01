'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { OwnerSessionView } from '@/lib/study/partner';
import { practiceGet, SignedOut } from './api';

// The private link for whoever's quizzing her or playing the patient, and a watch
// on how it's going, so her screen keeps up without her touching it.

/** Her open link, kept fresh every few seconds until it's over. */
export function useLiveSession() {
  const [session, setSession] = useState<OwnerSessionView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const running = !!session && !session.finished;

  useEffect(() => {
    let cancelled = false;
    const load = () => practiceGet<{ session: OwnerSessionView | null }>('session=1').then((body) => {
      if (cancelled) return;
      setSession(body.session);
      setLoaded(true);
    }).catch((error) => {
      if (cancelled) return;
      if (error instanceof SignedOut) setSignedOut(true);
      setLoaded(true);
    });
    if (!loaded) load();
    if (!running) return () => { cancelled = true; };
    const timer = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [running, loaded]);

  return { session, setSession, loaded, signedOut };
}

export function PartnerLink({ token, onEnd, who }: { token: string; onEnd: () => void; who: string }) {
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const link = `${window.location.origin}/study/partner/${token}`;
    setUrl(link);
    QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: '#0b0b12', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
  }, [token]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="sd-card pr-link">
      <h2>{who} scans this</h2>
      <div className="pr-link-body">
        {qr && <img src={qr} alt="QR code for the private link" width={160} height={160} />}
        <div className="pr-link-text">
          <p className="hb-hint">No account needed. Anyone with this link can see what’s in this sitting, until it’s over, you end it, or a day has passed.</p>
          <input readOnly value={url} aria-label="The private link" onFocus={(e) => e.target.select()} />
          <div className="sd-actions">
            <button type="button" className="hb-small-btn" onClick={copy}>{copied ? '✓ Copied' : 'Copy link'}</button>
            <button type="button" className="hb-text-btn" onClick={onEnd}>End this link</button>
          </div>
        </div>
      </div>
    </section>
  );
}
