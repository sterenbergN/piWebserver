// Next.js calls register() once per server start, in each runtime. Node-only
// work (backups, stats collector) lives in instrumentation-node.ts and is
// only loaded under Node.js, so the Edge build never sees fs/os imports.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
