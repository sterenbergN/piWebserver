import Link from 'next/link';

/** The journal's two halves: daily entries and longer private posts. */
export default function JournalTabs({ current }: { current: 'entries' | 'posts' }) {
  return (
    <nav className="jr-tabs" aria-label="Journal">
      <Link href="/journal" aria-current={current === 'entries' ? 'page' : undefined}><span aria-hidden>📓</span> Entries</Link>
      <Link href="/journal/posts" aria-current={current === 'posts' ? 'page' : undefined}><span aria-hidden>📝</span> Private posts</Link>
    </nav>
  );
}
