#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

import { importEvidence, type ImportFormat } from "./importer.js";
import { SqliteEvidenceRepository } from "./sqlite-repository.js";

export type CliIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

export async function runEvidenceImportCli(
  args: string[],
  io: CliIo = { stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value) },
): Promise<number> {
  const database = option(args, "--database");
  const file = option(args, "--file");
  if (database === undefined || file === undefined) {
    io.stderr("Usage: clone-market-evidence-import --database PATH --file PATH [--format json|csv] [--dry-run]\n");
    return 2;
  }
  const specifiedFormat = option(args, "--format");
  const format = (specifiedFormat ?? (extname(file).toLowerCase() === ".csv" ? "csv" : "json")) as ImportFormat;
  if (format !== "json" && format !== "csv") {
    io.stderr("--format must be json or csv\n");
    return 2;
  }
  const repository = new SqliteEvidenceRepository(database);
  try {
    const result = await importEvidence(repository, await readFile(file, "utf8"), {
      format,
      dryRun: args.includes("--dry-run"),
    });
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return result.valid ? 0 : 1;
  } finally {
    repository.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runEvidenceImportCli(process.argv.slice(2));
}
