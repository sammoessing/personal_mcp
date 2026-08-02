import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // OAuth discovery lives at fixed /.well-known/ paths that clients probe
      // directly. RFC 9728 also defines a path-suffix form, where metadata for
      // the resource https://host/api/mcp is fetched from
      // /.well-known/oauth-protected-resource/api/mcp — so both shapes are
      // mapped onto the same handlers.
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/metadata",
      },
      {
        source: "/.well-known/oauth-authorization-server/:path*",
        destination: "/api/oauth/metadata",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth/protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/oauth/protected-resource",
      },
    ];
  },
};

export default nextConfig;
