import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/newsreader/opsz.css';
import 'katex/dist/katex.min.css';
import '../daily/daily.css';
import '../habits/habits.css';
import '../journal/journal.css';
import './study.css';
import './plan.css';
import './games.css';
import './sets.css';
import './practice.css';
import './cards.css';
import './theme.css';

export const metadata: Metadata = {
  title: { absolute: 'PA Study' },
  description: 'Practice tests, missed questions and your PANCE map, only readable by your account.',
  robots: { index: false, follow: false },
  // Its own app on a home screen. Setting `icons` here replaces the site's file icons, for these pages only.
  applicationName: 'PA Study',
  manifest: '/study/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'PA Study', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/study-192.png', apple: '/icons/study-apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#11141b' },
    { media: '(prefers-color-scheme: light)', color: '#f6f3ec' },
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="study-space">{children}</div>;
}
