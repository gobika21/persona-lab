import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Production: a static export (web/out) that the Flask server serves, so the app stays one
// container on one origin. Development: `next dev` proxies the API and demo sites to Flask.
const FLASK = process.env.FLASK_URL || "http://127.0.0.1:5050";

const tailwind = {
  rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      turbopack: tailwind,
      async rewrites() {
        return [
          { source: "/api/:path*", destination: `${FLASK}/api/:path*` },
          { source: "/bench/:path*", destination: `${FLASK}/bench/:path*` },
        ];
      },
    };
  }
  return { output: "export", turbopack: tailwind, images: { unoptimized: true } };
}
