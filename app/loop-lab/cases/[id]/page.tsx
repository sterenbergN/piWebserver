import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CaseStudy from '@/components/loop-lab/CaseStudy';
import { CASES, getCase } from '@/lib/loop-lab/content';

export const dynamicParams = false;

export function generateStaticParams() {
  return CASES.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const study = getCase((await params).id);
  return study ? { title: `${study.title} · Loop Lab`, description: study.question } : {};
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getCase(id)) notFound();
  return <CaseStudy id={id} />;
}
