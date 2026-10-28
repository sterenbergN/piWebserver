import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ControllerReference } from '@/components/loop-lab/Reference';
import { CONTROLLER_CONTENT } from '@/lib/loop-lab/content';
import { CONTROLLER_KINDS, controllerMeta, type ControllerKind } from '@/lib/loop-lab/controllers';

export const dynamicParams = false;

const isKind = (v: string): v is ControllerKind => CONTROLLER_KINDS.some((k) => k.kind === v);

export function generateStaticParams() {
  return CONTROLLER_KINDS.map((k) => ({ kind: k.kind }));
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  if (!isKind(kind)) return {};
  return { title: `${controllerMeta(kind).name} · Loop Lab`, description: CONTROLLER_CONTENT[kind].summary };
}

export default async function ControllerPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isKind(kind)) notFound();
  return <ControllerReference kind={kind} />;
}
