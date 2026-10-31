import type { Metadata } from 'next';
import Bench from '@/components/loop-lab/Bench';

export const metadata: Metadata = {
  title: 'Bench · Loop Lab',
  description: 'Put a controller on a realistic process, run the same tests every time and compare the results.',
};

export default function BenchPage() {
  return <Bench />;
}
