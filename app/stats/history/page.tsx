import type { Metadata } from 'next';
import Link from 'next/link';
import HistoryView from '@/components/stats/history/HistoryView';
import { loadSiteHistory } from '@/lib/site-history/load';

export const metadata: Metadata = { title: 'How this site was built', description: 'The commit history of this site: activity, areas, and checkpoints through time.' };
// Read from disk at request time; the file is made by the build, not by this page.
export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const data = await loadSiteHistory();
  if (!data || !data.commits.length) {
    return (
      <div className="animate-fade-in" style={{ padding: '2rem 0' }}>
        <Link href="/stats" style={{ color: 'var(--muted)', fontSize: '0.85rem', textDecoration: 'none' }}>‹ Stats</Link>
        <h1>How this site was built</h1>
        <div className="glass-panel" style={{ padding: '1.2rem' }}>
          <p style={{ marginTop: 0 }}>The history hasn't been generated for this build yet.</p>
          <p style={{ marginBottom: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>It's made from git when the site is built. On a development machine, run <code>node scripts/site-history.mjs</code> and reload.</p>
        </div>
      </div>
    );
  }
  return <HistoryView data={data} />;
}
