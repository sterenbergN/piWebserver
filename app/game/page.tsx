import ArcadeClient from './ArcadeClient';

/** Arcade: ?game= picks the game on the server, so the right one renders first. */
export default async function ArcadePage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { game } = await searchParams;
  const initialGame = typeof game === 'string' ? game : undefined;
  // Keyed so following a link to the other game (e.g. from search) switches to it.
  return <ArcadeClient key={initialGame} initialGame={initialGame} />;
}
