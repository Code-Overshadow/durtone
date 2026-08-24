import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Bun workspace root (bun.lock lives here) - without this Next's file tracing for the
  // standalone build guesses the wrong root in a monorepo and misses hoisted node_modules.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
