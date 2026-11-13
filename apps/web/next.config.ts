import type { NextConfig } from "next";

const dataSource = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "demo";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * In api mode the browser talks to apps/api through this app's own origin: Better Auth on
 * /api/auth/* and everything else on /api-proxy/*. The session cookie is then first-party on each
 * product host (blueprint p17 rule 4; ADR 0029). The demo build has no proxy.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui", "@workspace/shared"],
  devIndicators: false,
  env: {
    NEXT_PUBLIC_DATA_SOURCE: dataSource,
    NEXT_PUBLIC_API_URL: apiUrl,
  },
  async rewrites() {
    if (dataSource !== "api") return [];
    return [
      { source: "/api/auth/:path*", destination: `${apiUrl}/api/auth/:path*` },
      { source: "/api-proxy/:path*", destination: `${apiUrl}/:path*` },
    ];
  },
};

export default nextConfig;
