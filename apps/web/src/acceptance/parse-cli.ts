function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

/** Drop vite-node/npm script path and a forwarding `--` so flags reach the harness. */
export function acceptanceCliArgs(argv: string[]): string[] {
  let args = argv;
  const first = args[0];
  if (first !== undefined && (first.endsWith("cli.ts") || first.endsWith("cli.js") || first.endsWith("/cli"))) {
    args = args.slice(1);
  }
  if (args[0] === "--") args = args.slice(1);
  return args;
}

export type ParsedAcceptanceCli = {
  args: string[];
  wantsLive: boolean;
  parseOnly: boolean;
  reportPath?: string;
  template?: string;
  catalogPath?: string;
  evidencePath?: string;
};

export function parseAcceptanceCli(argv: string[]): ParsedAcceptanceCli {
  const args = acceptanceCliArgs(argv);
  const reportPath = option(args, "--report");
  const template = option(args, "--template");
  const catalogPath = option(args, "--catalog");
  const evidencePath = option(args, "--evidence");
  return {
    args,
    wantsLive: args.includes("--live"),
    parseOnly: args.includes("--parse-only"),
    ...(reportPath === undefined ? {} : { reportPath }),
    ...(template === undefined ? {} : { template }),
    ...(catalogPath === undefined ? {} : { catalogPath }),
    ...(evidencePath === undefined ? {} : { evidencePath }),
  };
}

export type LiveModeResolution = {
  live: boolean;
  error?: string;
};

/**
 * Live mode is env-driven so `vite-node file.ts --live` still works when vite-node
 * swallows flags. `--live` without `CLONE_MARKET_ACCEPTANCE_LIVE=1` is rejected.
 */
export function resolveLiveMode(argv: string[], env: NodeJS.ProcessEnv = process.env): LiveModeResolution {
  const { wantsLive } = parseAcceptanceCli(argv);
  const liveEnabled = env.CLONE_MARKET_ACCEPTANCE_LIVE === "1";
  if (wantsLive && !liveEnabled) {
    return {
      live: false,
      error: "Live V0 acceptance requires CLONE_MARKET_ACCEPTANCE_LIVE=1 (opt-in; may use network).",
    };
  }
  return { live: liveEnabled };
}
