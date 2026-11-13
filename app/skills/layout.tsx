import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';
import 'katex/dist/katex.min.css';
import '../daily/daily.css';
import '../journal/journal.css';
import './skills.css';
import './board.css';
import './subject.css';
import './review.css';
import './prompt.css';

export const metadata: Metadata = {
  ...homeScreenMetadata('skills'),
  title: 'Skills',
  description: 'What you know, what you’re learning and where you’re the expert: subjects, books and projects, and questions that keep it fresh.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="sk-space">{children}</div>;
}
