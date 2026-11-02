'use client';

import { useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import type { Share } from '@/lib/study/sharing';
import { sharedPost } from './api';
import { Icon } from './Icon';

// Sharing one test: a private link, or published for everyone signed in to find. The
// link stays the same whichever it is, and stopping sharing ends it at once.

export function ShareCard({ testId, share, onChange }: { testId: string; share: Share | null; onChange: (share: Share | null) => void }) {
  const { confirm, popup } = useSitePopup();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const link = share && typeof window !== 'undefined' ? `${window.location.origin}/study/shared/${share.id}` : '';

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    }
    setBusy(false);
  };
  const shareIt = (isPublic: boolean) => run(async () => {
    const body = await sharedPost<{ share: Share }>('share', { testId, public: isPublic });
    onChange(body.share);
  });
  const stop = async () => {
    const ok = await confirm({ title: 'Stop sharing this test?', message: 'The link stops working and it leaves Shared tests. Anyone who already added it keeps their copy.', confirmLabel: 'Stop sharing', danger: true });
    if (ok) await run(async () => { await sharedPost('unshare', { testId }); onChange(null); });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Couldn’t reach the clipboard. Copy the link from the box.');
    }
  };

  return (
    <section className="sd-card sd-share">
      {popup}
      <h2><Icon name="share" /> {share ? 'Shared' : 'Share it'}</h2>
      {!share ? (
        <>
          <p className="hb-hint">Friends with an account here can add their own copy to take, and anyone without one can take it from the link, with their answers kept in their own browser. Everything in the test goes with it: questions, answers, explanations and the lines from your notes. Your tries and misses stay yours.</p>
          <div className="sd-actions">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => shareIt(false)}><Icon name="link" /> Get a private link</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => shareIt(true)}><Icon name="users" /> Publish for everyone</button>
          </div>
        </>
      ) : (
        <>
          <p className="hb-hint">{share.public ? 'Anyone signed in can find it in Shared tests. Anyone with the link can open it, account or not.' : 'Only people you send the link to can open it, account or not.'} Without an account, their answers stay in their own browser. They’ll see it as it is now, so your edits reach anyone who opens it later.</p>
          <div className="sd-share-link">
            <input readOnly value={link} aria-label="Link to this test" onFocus={(e) => e.target.select()} />
            <button type="button" className="hb-small-btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy'}</button>
          </div>
          <label className="sd-check">
            <input type="checkbox" checked={share.public} disabled={busy} onChange={(e) => shareIt(e.target.checked)} />
            <span>List it in Shared tests for everyone</span>
          </label>
          <button type="button" className="hb-text-btn sd-danger-link sd-self-start" disabled={busy} onClick={stop}>Stop sharing</button>
        </>
      )}
      {error && <p className="sd-warning" role="alert">{error}</p>}
    </section>
  );
}
