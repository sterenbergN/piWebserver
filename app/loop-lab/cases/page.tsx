import type { Metadata } from 'next';
import CasesList from '@/components/loop-lab/CasesList';

export const metadata: Metadata = {
  title: 'Case studies · Loop Lab',
  description: 'Worked control problems, from a flow loop where PI is the answer to a mixing tank that needs MPC, each ending in an honest verdict.',
};

export default function CasesPage() {
  return <CasesList />;
}
