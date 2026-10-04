#!/usr/bin/env node
import { EvidenceService } from "./service.js";
import { SqliteEvidenceRepository } from "./sqlite-repository.js";

export type CliIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

export async function runEvidenceDeriveCli(
  args: string[],
  io: CliIo = { stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value) },
): Promise<number> {
  const database = option(args, "--database");
  const templateId = option(args, "--template-id");
  if (database === undefined || templateId === undefined) {
    io.stderr("Usage: clone-market-evidence-derive --database PATH --template-id ID [--calculated-at ISO]\n");
    return 2;
  }
  const calculatedAt = option(args, "--calculated-at") ?? new Date().toISOString();
  const repository = new SqliteEvidenceRepository(database);
  try {
    const evidence = await repository.listEvidence(templateId);
    if (evidence.length === 0) {
      io.stderr(`No evidence rows for ${templateId}; import reviewed rows before derive\n`);
      return 1;
    }
    const query = await new EvidenceService(repository).derive(templateId, { calculatedAt });
    io.stdout(`${JSON.stringify({
      templateId,
      label: query.snapshot.label,
      calculatedAt: query.snapshot.calculatedAt,
      evidenceRows: query.evidence.length,
      contributions: query.contributions.length,
    }, null, 2)}\n`);
    return 0;
  } finally {
    repository.close();
  }
}

if (process.env.VITEST === undefined) {
  process.exitCode = await runEvidenceDeriveCli(process.argv.slice(2));
}
