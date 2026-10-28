import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { getPost } from '@/lib/journal/private-posts';
import { getCadProjects } from '@/lib/site-content';
import { cadIdsIn } from '@/lib/cad/embeds';
import SignInPrompt from '@/components/journal/SignInPrompt';
import PrivatePostView from '@/components/journal/PrivatePostView';
import '../../journal.css';

export const metadata: Metadata = { title: 'Private post' };

// Someone else's post id is simply "not found": nothing says it exists.
export default async function PrivatePostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
    return <div className="jr"><SignInPrompt title="Sign in to read this">Private posts are only shown to the account that wrote them.</SignInPrompt></div>;
  }
  const [post, cad] = await Promise.all([getPost(userId, id), getCadProjects()]);
  if (!post) notFound();
  const shown = new Set(cadIdsIn(post.markdown));
  return <PrivatePostView post={post} cadProjects={cad.filter((c) => shown.has(c.id))} />;
}
