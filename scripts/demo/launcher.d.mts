import type { ChildProcess } from "node:child_process";
import type { DemoError } from "./errors.mjs";

export declare function resolveRepoRoot(environment?: NodeJS.ProcessEnv): string;

export type ParsedDemoArgs =
  | { help: true }
  | {
      webPort?: number;
      fixturePort?: number;
      demoDir?: string;
      skipBuild?: true;
    };

export declare function parseDemoArgs(argv: string[], environment?: NodeJS.ProcessEnv): ParsedDemoArgs;
export declare function demoUsage(): string;

export type DemoPlan = {
  root: string;
  demoRoot: string;
  webDir: string;
  catalogPath: string;
  evidencePath: string;
  artifactDir: string;
  host: string;
  webPort: number;
  fixturePort: number;
  webUrl: string;
  fixtureBaseUrl: string;
  nextDistDir: string;
};

export declare function planDemo(input: {
  root: string;
  demoRoot?: string;
  webPort?: number;
  fixturePort?: number;
  host?: string;
}): DemoPlan;

export declare function ensureDemoRootWritable(plan: DemoPlan): Promise<void>;
export declare function buildWorkspacePackages(input: {
  root: string;
  stderr: (chunk: string) => void;
}): Promise<void>;
export declare function cleanDemoNextDir(plan: DemoPlan, stderr: (chunk: string) => void): Promise<void>;
export declare function webChildEnv(plan: DemoPlan, environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;

export declare function stopChild(
  child: ChildProcess,
  options?: { signal?: NodeJS.Signals; graceMs?: number; killGroup?: boolean },
): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

export declare function waitForWebReady(input: {
  url: string;
  timeoutMs: number;
  child: ChildProcess;
}): Promise<void>;

export type DemoDone = {
  code: number;
  error?: DemoError;
};

export type DemoHandle = {
  plan: DemoPlan;
  seed: {
    catalog: {
      total: number;
      added: number;
      changed: number;
      removed: number;
      reappeared: number;
      unchanged: number;
    };
    evidence: { rows: number; snapshotId: string; label: string };
  };
  stop(): Promise<void>;
  done: Promise<DemoDone>;
};

export declare function runDemo(options?: {
  root?: string;
  demoRoot?: string;
  webPort?: number;
  fixturePort?: number;
  host?: string;
  skipBuild?: boolean;
  readyTimeoutMs?: number;
  webGraceMs?: number;
  handleSignals?: boolean;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  version?: string;
  environment?: NodeJS.ProcessEnv;
}): Promise<DemoHandle>;
