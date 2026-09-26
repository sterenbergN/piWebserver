import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { getGalleryAlbums } from '@/lib/site-content';
import GalleryClient from './GalleryClient';
import './gallery.css';

// Albums are read on the server so the first paint already has them
// (no blank page while the browser fetches /api/gallery).
export default async function GalleryPage() {
  const [albums, isAdmin] = await Promise.all([getGalleryAlbums(), isAdminAuthenticated()]);
  return <GalleryClient initialAlbums={albums} initialIsAdmin={isAdmin} />;
}
