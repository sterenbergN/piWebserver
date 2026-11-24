// Next.js calls register() once per server start, in each runtime. Node-only
// work (backups, stats collector) lives in instrumentation-node.ts and is
// only loaded under Node.js, so the Edge build never sees fs/os imports.
/** Server errors Next.js catches itself (a page or route that threw), filed as the site's own tickets. */
export async function onRequestError(error: unknown, request: { path: string; method: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { describeError, recordServerIssue } = await import('./lib/tickets/auto-store');
  const { title, detail } = describeError(error);
  recordServerIssue({ source: 'server', title: `${context.routePath ?? request.path}: ${title}`, detail: `${request.method} ${request.path} (${context.routeType ?? 'request'})\n${detail ?? ''}`.trim(), page: request.path });
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
