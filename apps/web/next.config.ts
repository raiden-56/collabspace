import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4100";

// Set by the GitHub Pages workflow: build a static export served from /<repo>.
// Rewrites, headers and the proxy need a Node server, so they are left out of that build.
const PAGES_BASE_PATH = process.env.BASE_PATH?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@collabspace/shared"],
  ...(PAGES_BASE_PATH !== undefined
    ? { output: "export", basePath: PAGES_BASE_PATH, trailingSlash: true }
    : {
        async rewrites() {
          // Same-origin API access in development/production-behind-one-domain: cookies stay first-party.
          return [{ source: "/api/v1/:path*", destination: `${API_URL}/api/v1/:path*` }];
        },
        async headers() {
          return [
            {
              source: "/(.*)",
              headers: [
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                { key: "X-Frame-Options", value: "SAMEORIGIN" },
                { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
              ],
            },
          ];
        },
      }),
  turbopack: {
    resolveAlias: { canvas: { browser: "./lib/empty-module.ts" } },
  },
  images: {
    unoptimized: PAGES_BASE_PATH !== undefined,
    remotePatterns: [{ protocol: "http", hostname: "localhost" }, { protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
