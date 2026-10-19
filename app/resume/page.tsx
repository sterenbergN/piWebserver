import type { Metadata } from 'next';
import { getResume } from '@/lib/resume-store';
import ResumeView from '@/components/resume/ResumeView';
import Link from 'next/link';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { profile } = await getResume();
  return { title: 'Resume', description: profile.headline };
}

export default async function ResumePage() {
  const [resume, isAdmin] = await Promise.all([getResume(), isAdminAuthenticated()]);
  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <div className="resume-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginBottom: '1rem' }}>
        {isAdmin && <Link href="/admin/resume" className="btn btn-secondary">✏️ Edit resume</Link>}
        <PrintButton />
      </div>
      <ResumeView resume={resume} />
    </div>
  );
}
