import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/newsreader/opsz.css';
import '../journal/journal.css';
import './reader.css';

export const metadata: Metadata = {
  title: { absolute: 'Reader' },
  description: 'Your books and notes, on every device, with or without a connection.',
  robots: { index: false, follow: false },
  // Its own app on a home screen. Setting `icons` here replaces the site's file icons, for these pages only.
  applicationName: 'Reader',
  manifest: '/reader/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Reader', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/reader-192.png', apple: '/icons/reader-apple-touch-icon.png' },
};

// `cover` lets the page use the whole screen, around the notch too. Pinch-zooming the
// whole app is off because a pinch means zooming the page of the book.
export const viewport: Viewport = {
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#14161c',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
