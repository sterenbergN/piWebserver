import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import '../daily/daily.css';
import '../habits/habits.css';
import '../journal/journal.css';
import './study.css';

export const metadata: Metadata = { title: 'Study', description: 'Practice tests and the questions you keep missing, only readable by your account.', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
