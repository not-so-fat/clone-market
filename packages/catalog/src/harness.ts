import type { SourceAdapter } from "@clone-market/core";

import { CatalogService } from "./service.js";
import { SqliteCatalogRepository } from "./sqlite-repository.js";

/** Library harness for jobs/CLIs. The returned object is directly JSON serializable. */
export async function runCatalogReconciliation(input: {
  adapter: SourceAdapter;
  databasePath: string;
  now?: () => string;
}) {
  const repository = new SqliteCatalogRepository(input.databasePath);
  try {
    return await new CatalogService(repository, input.now === undefined ? undefined : { now: input.now }).reconcile(input.adapter);
  } finally {
    repository.close();
  }
}
