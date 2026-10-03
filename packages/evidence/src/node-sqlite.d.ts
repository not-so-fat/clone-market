declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): {
      get(...parameters: unknown[]): Record<string, unknown> | undefined;
      all(...parameters: unknown[]): Record<string, unknown>[];
      run(...parameters: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
    };
  }
}
