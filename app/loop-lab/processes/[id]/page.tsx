import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProcessReference } from '@/components/loop-lab/Reference';
import { PROCESSES, isProcessId, getProcess } from '@/lib/loop-lab/processes';

export const dynamicParams = false;

export function generateStaticParams() {
  return PROCESSES.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isProcessId(id)) return {};
  const proc = getProcess(id);
  return { title: `${proc.name} · Loop Lab`, description: proc.summary };
}

export default async function ProcessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isProcessId(id)) notFound();
  return <ProcessReference id={id} />;
}
