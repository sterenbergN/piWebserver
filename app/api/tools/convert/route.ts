import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { conversionById, kindOf } from '@/lib/convert/formats';
import { cleanOfficeOptions } from '@/lib/convert/office-options';
import { createConvertJobs, PI_MAX_BYTES, toolWorks } from '@/lib/convert/pi-jobs';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { recordServerIssue } from '@/lib/tickets/auto-store';

// Tools › File converter, the conversions that run on the Pi (signed in only).
//   GET                 → which tools the Pi has: { signedIn, ffmpeg, office }
//   POST (form: file, conversion, options?) → starts a job: { id, status }; options are Office layout choices (JSON)
//   GET ?id=            → how it's going
//   GET ?id=&download=1 → the finished file
//   DELETE ?id=         → stop it and delete its files

export const dynamic = 'force-dynamic';
const PRIVATE = { 'Cache-Control': 'no-store, private' };

const globalJobs = globalThis as unknown as { __convertJobs?: ReturnType<typeof createConvertJobs>; __convertTools?: { at: number; tools: Promise<{ ffmpeg: boolean; office: boolean }> } };
// Kept on globalThis so a dev-server reload doesn't lose running jobs.
const jobs = (globalJobs.__convertJobs ??= createConvertJobs({
  // Grouped by conversion; the tool's last lines of output say why.
  onFailure: (id, message) => recordServerIssue({ source: 'job', title: `Converting (${id}) failed on the Pi`, detail: message.slice(0, 500) }),
}));

/** Checked once every ten minutes, so installing one shows up without a restart. */
function tools() {
  const cached = globalJobs.__convertTools;
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.tools;
  const fresh = Promise.all([toolWorks('ffmpeg'), toolWorks('office')]).then(([ffmpeg, office]) => ({ ffmpeg, office }));
  globalJobs.__convertTools = { at: Date.now(), tools: fresh };
  return fresh;
}

async function owner() {
  const [userId, isAdmin] = await Promise.all([getAuthenticatedWorkoutUserId(), isAdminAuthenticated().catch(() => false)]);
  return userId ? `user:${userId}` : isAdmin ? 'admin' : null;
}

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status, headers: PRIVATE });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const who = await owner();
  if (!id) return NextResponse.json({ success: true, signedIn: !!who, ...(who ? await tools() : { ffmpeg: false, office: false }) }, { headers: PRIVATE });
  if (!who) return fail('Sign in to convert files on the Pi.', 401);

  if (params.get('download')) {
    const file = jobs.result(who, id);
    if (!file) return fail('That file isn’t ready, or it’s gone (they’re kept for 30 minutes).', 404);
    const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream;
    return new Response(stream, {
      headers: {
        ...PRIVATE,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(file.size),
        'Content-Disposition': `attachment; filename="${file.name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      },
    });
  }
  const job = jobs.get(who, id);
  return job ? NextResponse.json({ success: true, job }, { headers: PRIVATE }) : fail('That conversion is gone. Try again.', 404);
}

export async function POST(request: Request) {
  const who = await owner();
  if (!who) return fail('Sign in to convert files on the Pi.', 401);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > PI_MAX_BYTES + 1024 * 1024) return fail(`Files for the Pi can be up to ${PI_MAX_BYTES / 1024 / 1024} MB.`, 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('That upload couldn’t be read.', 400);
  }
  const file = form.get('file');
  const conversion = conversionById(form.get('conversion'));
  if (!(file instanceof File) || !file.size) return fail('No file came with that.', 400);
  if (!conversion || conversion.where !== 'pi' || !conversion.tool) return fail('That isn’t a conversion the Pi does.', 400);
  if (!conversion.takes.includes(kindOf(file.name, file.type))) return fail(`${conversion.label} doesn’t take ${file.name}.`, 400);
  const available = await tools();
  if (!available[conversion.tool]) return fail(`${conversion.tool === 'ffmpeg' ? 'ffmpeg' : 'LibreOffice'} isn’t installed on the Pi yet.`, 503);
  try {
    let options = {};
    try { options = cleanOfficeOptions(JSON.parse(String(form.get('options') ?? '{}'))); } catch { /* none */ }
    const job = await jobs.start(who, conversion, file.name, new Uint8Array(await file.arrayBuffer()), options);
    return NextResponse.json({ success: true, job }, { status: 202, headers: PRIVATE });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Couldn’t start that.', 400);
  }
}

export async function DELETE(request: Request) {
  const who = await owner();
  if (!who) return fail('Sign in first.', 401);
  const id = new URL(request.url).searchParams.get('id');
  if (id) await jobs.remove(who, id);
  return NextResponse.json({ success: true }, { headers: PRIVATE });
}
