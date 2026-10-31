import { redirect } from 'next/navigation';
import Home from '@/components/loop-lab/Home';

export default async function LoopLabPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  // Shared links from before the bench had its own address. The browser keeps the #tab across the redirect.
  const { setup } = await searchParams;
  if (typeof setup === 'string') redirect(`/loop-lab/bench?setup=${encodeURIComponent(setup)}`);
  return <Home />;
}
