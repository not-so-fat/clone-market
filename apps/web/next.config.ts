import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  output: "standalone",
  // The fixture demo (CLONE_MARKET_DEMO=1) uses an isolated cache so stale
  // normal-development bundles can never mask the checked-out code.
  distDir: process.env.CLONE_MARKET_DEMO === "1" ? ".next-demo" : ".next",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  serverExternalPackages: [
    "@clone-market/catalog",
    "@clone-market/compatibility",
    "@clone-market/core",
    "@clone-market/evidence",
    "@clone-market/source-grok",
    "@clone-market/target-botmancers",
  ],
  webpack(webpackConfig) {
    // Keep workspace package requests under node_modules so Next can honor
    // serverExternalPackages instead of bundling their filesystem migrations.
    webpackConfig.resolve.symlinks = false;
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return webpackConfig;
  },
};

export default config;
