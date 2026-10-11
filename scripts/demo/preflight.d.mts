export declare function checkNodeVersion(version: string): void;
export declare function checkDependencies(root: string): Promise<void>;
export declare function isReadable(path: string): Promise<boolean>;
export declare function checkPortNumber(value: unknown, name: string): number;
export declare function checkPortFree(port: number, host: string, name: string): Promise<void>;
export declare function runPreflight(input: {
  root: string;
  version: string;
  webPort: number;
  fixturePort: number;
  host: string;
}): Promise<void>;
