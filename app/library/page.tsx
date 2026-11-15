import { permanentRedirect } from 'next/navigation';

// The Library used to be a page of its own. It's a shelf in the Reader now, where its
// books open like any others, so old links and bookmarks land there.
export default function LibraryPage() {
  permanentRedirect('/reader?shelf=library');
}
