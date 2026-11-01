import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/newsreader/opsz.css';
import '../journal/journal.css';
import './notes.css';

export const metadata: Metadata = {
  title: { absolute: 'Notes' },
  description: 'Handwritten and typed notes, on every device, with or without a connection.',
  robots: { index: false, follow: false },
  // Its own app on a home screen. Setting `icons` here replaces the site's file icons, for these pages only.
  applicationName: 'Notes',
  manifest: '/notes/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Notes', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/notes-192.png', apple: '/icons/notes-apple-touch-icon.png' },
};

// The same as the Reader, and for the same reasons: no `viewportFit: 'cover'`, which on an
// iPad puts the page under the status bar and gets a dark gradient over the top of it, and
// no pinch-zooming the whole app, because a pinch means zooming the page.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1a1c22',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
