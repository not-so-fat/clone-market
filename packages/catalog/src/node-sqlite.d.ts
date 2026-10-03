declare module "node:sqlite" {
  export type StatementResult = { changes: number | bigint; lastInsertRowid: number | bigint };
  export class StatementSync {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): StatementResult;
  }
  export class DatabaseSync {
    constructor(location: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
