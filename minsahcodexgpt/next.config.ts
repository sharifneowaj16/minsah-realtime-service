import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "minsahbeauty.cloud" },
      { protocol: "https", hostname: "minio.minsahbeauty.cloud" },
      { protocol: "http",  hostname: "minio",     port: "9000" },
      { protocol: "http",  hostname: "localhost",  port: "9000" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "graph.facebook.com" },
      { protocol: "https", hostname: "platform-lookaside.fbsbx.com" },
      { protocol: "https", hostname: "placehold.co" },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 31,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  env: {
    NEXT_PUBLIC_APP_URL: "https://minsahbeauty.cloud",
    NEXT_PUBLIC_REALTIME_WS_URL: "wss://realtime.minsahbeauty.cloud/ws",
    NEXT_PUBLIC_WS_AUTH_SECRET: "438e261811e8de9de98d1d1d4b87d68d315fa1494166226f",
    NEXT_PUBLIC_MINIO_PUBLIC_URL: "https://minio.minsahbeauty.cloud",
  },

  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
    optimizePackageImports: ["lucide-react"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control",    value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options",    value: "nosniff" },
          { key: "X-Frame-Options",           value: "DENY" },
          { key: "X-XSS-Protection",          value: "1; mode=block" },
          { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/_next/image",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },

  async redirects() {
    return [
      {
        source: "/admin",
        destination: "/admin/login",
        permanent: false,
        missing: [{ type: "cookie", key: "admin_access_token" }],
      },
    ];
  },

  logging: { fetches: { fullUrl: process.env.NODE_ENV === "development" } },
  turbopack: {},

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    }
    return config;
  },
};

export default nextConfig;
