import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './loop-lab.css';
import LabNav from '@/components/loop-lab/LabNav';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = {
  ...homeScreenMetadata('loop-lab'),
  title: 'Loop Lab',
  description: 'A control strategy lab: put PID and its successors on realistic processes, test them the same way every time, and see the mechanical, control and automation sides of each loop.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LabNav />
      {children}
    </>
  );
}
