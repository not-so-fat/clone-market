import {
  CatalogRecordSchema,
  CatalogSourceMetadataSchema,
  TemplateSchema,
  type CatalogQuery,
  type CatalogRepository,
  type SourceAdapter,
  type SourceIdentity,
} from "@clone-market/core";

export class CatalogService {
  readonly #repository: CatalogRepository;
  readonly #now: () => string;

  constructor(repository: CatalogRepository, options?: { now?: () => string }) {
    this.#repository = repository;
    this.#now = options?.now ?? (() => new Date().toISOString());
  }

  async reconcile(adapter: SourceAdapter) {
    const templates = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await adapter.listTemplates(cursor === undefined ? undefined : { cursor });
      templates.push(...page.templates);
      if (page.nextCursor !== undefined) {
        if (cursors.has(page.nextCursor)) throw new Error(`Source adapter returned repeated cursor ${page.nextCursor}`);
        cursors.add(page.nextCursor);
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    const records = await Promise.all(templates.map(async (candidate) => {
      const template = TemplateSchema.parse(candidate);
      if (template.provenance.source.provider !== adapter.source) {
        throw new TypeError(`Template source ${template.provenance.source.provider} does not match adapter ${adapter.source}`);
      }
      const metadata = adapter.getCatalogMetadata === undefined
        ? {}
        : await adapter.getCatalogMetadata(template.provenance.source);
      return CatalogRecordSchema.parse({
        template,
        sourceMetadata: CatalogSourceMetadataSchema.parse(metadata ?? {}),
      });
    }));
    const retrievedAt = records.length === 0
      ? this.#now()
      : records.reduce(
          (latest, record) => Date.parse(record.template.provenance.retrievedAt) > Date.parse(latest)
            ? record.template.provenance.retrievedAt
            : latest,
          records[0]!.template.provenance.retrievedAt,
        );
    return this.#repository.reconcile({ source: adapter.source, retrievedAt, records });
  }

  listTemplates(query?: CatalogQuery) {
    return this.#repository.listTemplates(query);
  }

  getTemplate(source: SourceIdentity) {
    return this.#repository.getTemplate(source);
  }

  getSourceHistory(source: SourceIdentity) {
    return this.#repository.getSourceHistory(source);
  }
}
