import type { Metadata } from 'next';
import Link from 'next/link';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { listPosts } from '@/lib/journal/private-posts';
import JournalTabs from '@/components/journal/JournalTabs';
import SignInPrompt from '@/components/journal/SignInPrompt';
import '../../habits/habits.css';
import '../journal.css';

export const metadata: Metadata = { title: 'Private posts' };

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });

// Read on the server for the signed-in account only; signed out shows nothing but a sign-in prompt.
export default async function PrivatePostsPage() {
  const userId = await getAuthenticatedWorkoutUserId();
  const posts = userId ? await listPosts(userId) : [];

  return (
    <div className="jr animate-fade-in">
      <header className="jr-head">
        <div>
          <h1>Journal</h1>
          <p><span aria-hidden>🔒</span> Private to your account. Nobody else can read it.</p>
        </div>
        {userId && <Link className="btn btn-primary" href="/journal/posts/new/edit">+ New post</Link>}
      </header>
      <JournalTabs current="posts" />

      {!userId ? (
        <SignInPrompt title="Sign in to see your private posts">Private posts are written with the blog editor but never published. They’re kept in your account and only you can read them.</SignInPrompt>
      ) : posts.length === 0 ? (
        <section className="jr-locked">
          <div className="jr-lock" aria-hidden>📝</div>
          <h2>No private posts yet</h2>
          <p className="jr-hint">Longer writing with headings, photos and the full blog editor, that stays yours. Nothing here is ever published.</p>
          <Link className="btn btn-primary" href="/journal/posts/new/edit">Write one</Link>
        </section>
      ) : (
        <ul className="jr-posts">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={`/journal/posts/${p.id}`} className="jr-post-card">
                {p.cover ? <img src={p.cover} alt="" loading="lazy" /> : <span className="jr-post-card-icon" aria-hidden>📝</span>}
                <span className="jr-post-card-text">
                  <strong>{p.title || 'Untitled'}</strong>
                  {p.description && <span>{p.description}</span>}
                  <small>{fmt(p.updatedAt)} · {p.words.toLocaleString()} words</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
