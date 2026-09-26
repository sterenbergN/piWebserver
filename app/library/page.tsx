import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { getLibraryDocuments } from '@/lib/site-content';
import LibraryClient from './LibraryClient';
import './library.css';

// Documents are read on the server so the list is in the first paint.
export default async function LibraryPage() {
  const [documents, isAdmin] = await Promise.all([getLibraryDocuments(), isAdminAuthenticated()]);
  return <LibraryClient initialDocuments={documents} initialIsAdmin={isAdmin} />;
}
