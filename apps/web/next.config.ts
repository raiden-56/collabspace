import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4100";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@collabspace/shared"],
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
  turbopack: {
    resolveAlias: { canvas: { browser: "./lib/empty-module.ts" } },
  },
  images: { remotePatterns: [{ protocol: "http", hostname: "localhost" }, { protocol: "https", hostname: "**" }] },
};

export default nextConfig;
