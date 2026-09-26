import type { Metadata } from 'next';
import { getResume } from '@/lib/resume-store';
import ResumeView from '@/components/resume/ResumeView';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { profile } = await getResume();
  return { title: `${profile.name} — Resume`, description: profile.headline };
}

export default async function ResumePage() {
  const resume = await getResume();
  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <div className="resume-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginBottom: '1rem' }}>
        <PrintButton />
      </div>
      <ResumeView resume={resume} />
    </div>
  );
}
