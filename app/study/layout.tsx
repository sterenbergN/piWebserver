import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import '../daily/daily.css';
import '../habits/habits.css';
import '../journal/journal.css';
import './study.css';
import './plan.css';
import './games.css';

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

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
