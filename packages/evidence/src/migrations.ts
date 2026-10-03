import { readFileSync } from "node:fs";

export type Migration = { version: number; up: string; down: string };

export const migrations: readonly Migration[] = [{
  version: 1,
  up: readFileSync(new URL("../migrations/001_initial.sql", import.meta.url), "utf8"),
  down: readFileSync(new URL("../migrations/001_initial.down.sql", import.meta.url), "utf8"),
}];
