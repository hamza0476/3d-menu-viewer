import type { NextConfig } from "next";

// Content-Security-Policy starts in Report-Only mode (Phase 1): browsers
// report violations but block nothing, so the Three.js viewer, camera
// capture and external dish photos keep working while we learn what the
// real policy must allow. It becomes enforcing once reports are clean.
// Notes on the allowances: images/media may come from https: (restaurant
// photos are hot-linked today), blob:/data: cover camera capture and
// in-browser GLB/QR handling, worker-src blob: is required by Three.js
// loaders, and 'unsafe-inline' for scripts/styles reflects Next.js inline
// bootstrap + the app's inline styles until nonces are adopted.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  // Only fully effective over HTTPS; harmless on local http.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // SAMEORIGIN: the public menu stays embeddable on our own pages; third-party
  // iframing of the menu is a later, deliberate allowlist decision.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Phase 5: the service worker itself must revalidate on every load
      // (a cached SW would pin guests to a stale shell) and is allowed
      // to control the whole origin although it lives at the root.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
