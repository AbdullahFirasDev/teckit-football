import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The scanner library touches browser APIs only; keep the PDF renderer out of
  // the server bundle to avoid node-only polyfill warnings on Vercel builds.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
