import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { getPost } from '@/lib/journal/private-posts';
import { getCadProjects } from '@/lib/site-content';
import SignInPrompt from '@/components/journal/SignInPrompt';
import PrivatePostEditor from '@/components/journal/PrivatePostEditor';
import '@/components/blog/editor.css';
import '../../../journal.css';

export const metadata: Metadata = { title: 'Write a private post' };

// /journal/posts/new/edit starts a post; the editor moves the address to its id once saved.
export default async function EditPrivatePostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return <div className="jr"><SignInPrompt title="Sign in to write">Private posts are kept in your account and only you can read them.</SignInPrompt></div>;
  }
  const [post, cad] = await Promise.all([id === 'new' ? null : getPost(userId, id), getCadProjects()]);
  if (id !== 'new' && !post) notFound();
  return <PrivatePostEditor key={post?.id || 'new'} post={post} cadProjects={cad} />;
}
