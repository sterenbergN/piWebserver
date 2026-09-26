import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR?.trim();

// Release builds (CI → Raspberry Pi) use a self-contained `server.js` bundle;
// local `npm run build` / `npm start` keep working as before.
const standalone = process.env.NEXT_OUTPUT === 'standalone';

const nextConfig: NextConfig = {
  distDir: distDir || ".next",
  ...(standalone ? { output: 'standalone' as const } : {}),
  serverExternalPackages: [],
  async headers() {
    return [
      {
        // Always fetch a fresh service worker so updates roll out immediately.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '30mb',
    },
  },
};

export default nextConfig;
