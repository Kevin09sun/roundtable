import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 detects agent/CI environments and appends its own
  // instruction block to the repo's CLAUDE.md on every build. CLAUDE.md is
  // this project's working agreement and must never be modified by tooling.
  agentRules: false,
};

export default nextConfig;
