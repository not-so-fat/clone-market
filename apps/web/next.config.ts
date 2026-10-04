import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@clone-market/catalog",
    "@clone-market/compatibility",
    "@clone-market/core",
    "@clone-market/evidence",
    "@clone-market/source-grok",
    "@clone-market/target-botmancers",
  ],
};

export default config;
