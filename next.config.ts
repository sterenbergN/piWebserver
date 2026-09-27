import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR?.trim();

// Release builds (CI → Raspberry Pi) use a self-contained `server.js` bundle;
// local `npm run build` / `npm start` keep working as before.
const standalone = process.env.NEXT_OUTPUT === 'standalone';

const nextConfig: NextConfig = {
  distDir: distDir || ".next",
  ...(standalone ? { output: 'standalone' as const } : {}),
  serverExternalPackages: [],
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Safe defaults for every page and API response. (A full script CSP
        // would need nonces for Next's inline scripts, so only framing is limited.)
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          // Location is used by the restaurant finder; nothing needs the camera, mic or payment APIs.
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()' },
          // The site is only served over HTTPS (Cloudflare); browsers ignore this header on plain HTTP.
          { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
        ],
      },
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
