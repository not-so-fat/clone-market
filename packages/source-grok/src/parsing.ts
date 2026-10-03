import { SCHEMA_VERSION, type BotTemplateManifest, type SourceIdentity, type Template } from "@clone-market/core";

import { SourceSchemaDriftError, type GrokRetrievalMetadata } from "./errors.js";

type JsonRecord = Record<string, unknown>;
type LocatedValue = { path: string; value: unknown };

export type RawGrokDocument = GrokRetrievalMetadata & { body: string };
export type ParsedTemplate = { template: Template; installCount: number; slug: string };
export type ParsedManifest = { manifest: BotTemplateManifest; installCount: number };

const PROVIDER = "grok-marketplace";
const INDEX_KEYS = ["marketplaceBots", "initialBots", "allBots", "templates", "bots"] as const;
const DETAIL_KEYS = ["marketplaceBot", "botData", "template", "bot"] as const;

function actual(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function drift(metadata: GrokRetrievalMetadata, path: string, expected: string, value: unknown): never {
  throw new SourceSchemaDriftError({
    code: "source_schema_drift",
    source: metadata.source,
    url: metadata.url,
    retrievedAt: metadata.retrievedAt,
    path,
    expected,
    actual: actual(value),
  });
}

function record(value: unknown, path: string, metadata: GrokRetrievalMetadata): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) drift(metadata, path, "object", value);
  return value as JsonRecord;
}

function string(value: unknown, path: string, metadata: GrokRetrievalMetadata): string {
  if (typeof value !== "string" || value.length === 0) drift(metadata, path, "non-empty string", value);
  return value;
}

function optionalString(value: unknown, path: string, metadata: GrokRetrievalMetadata): string | undefined {
  if (value === undefined || value === null) return undefined;
  return string(value, path, metadata);
}

function number(value: unknown, path: string, metadata: GrokRetrievalMetadata): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) drift(metadata, path, "non-negative integer", value);
  return value;
}

function array(value: unknown, path: string, metadata: GrokRetrievalMetadata): unknown[] {
  if (!Array.isArray(value)) drift(metadata, path, "array", value);
  return value;
}

function stringArray(value: unknown, path: string, metadata: GrokRetrievalMetadata): string[] {
  return array(value, path, metadata).map((item, index) => string(item, `${path}.${index}`, metadata));
}

function source(externalId: string): SourceIdentity {
  return { provider: PROVIDER, externalId };
}

function flightChunks(body: string): string[] {
  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\((\[[\s\S]*?\])\)\s*;?/g;
  for (const match of body.matchAll(pattern)) {
    try {
      const frame = JSON.parse(match[1] ?? "") as unknown;
      if (Array.isArray(frame) && typeof frame[1] === "string") chunks.push(frame[1]);
    } catch {
      // The caller emits one typed document-level drift if no usable value remains.
    }
  }
  for (const match of body.matchAll(/<script[^>]+type=["']text\/x-component["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1] !== undefined) chunks.push(match[1]);
  }
  return chunks;
}

function jsonValues(chunk: string): unknown[] {
  const values: unknown[] = [];
  for (let start = 0; start < chunk.length; start += 1) {
    const opening = chunk[start];
    if (opening !== "{" && opening !== "[") continue;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let end = start; end < chunk.length; end += 1) {
      const character = chunk[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.pop() !== expected) break;
        if (stack.length === 0) {
          try {
            values.push(JSON.parse(chunk.slice(start, end + 1)) as unknown);
            start = end;
          } catch {
            // Flight also contains non-data rows; continue looking for JSON values.
          }
          break;
        }
      }
    }
  }
  return values;
}

function rscValues(document: RawGrokDocument): LocatedValue[] {
  const located = flightChunks(document.body).flatMap((chunk, chunkIndex) =>
    jsonValues(chunk).map((value, valueIndex) => ({ value, path: `$rsc.${chunkIndex}.${valueIndex}` })),
  );
  if (located.length === 0) drift(document, "$", "decodable Next.js Flight JSON payload", undefined);
  return located;
}

function walk(value: unknown, path: string, visit: (record: JsonRecord, path: string) => LocatedValue | undefined): LocatedValue | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = walk(value[index], `${path}.${index}`, visit);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = value as JsonRecord;
  const direct = visit(object, path);
  if (direct !== undefined) return direct;
  for (const [key, child] of Object.entries(object)) {
    const found = walk(child, `${path}.${key}`, visit);
    if (found !== undefined) return found;
  }
  return undefined;
}

function locateProperty(document: RawGrokDocument, keys: readonly string[]): LocatedValue {
  for (const root of rscValues(document)) {
    const found = walk(root.value, root.path, (candidate, path) => {
      for (const key of keys) {
        if (Object.hasOwn(candidate, key)) return { value: candidate[key], path: `${path}.${key}` };
      }
      return undefined;
    });
    if (found !== undefined) return found;
  }
  return drift(document, "$", `RSC property ${keys.join(" or ")}`, undefined);
}

function parseCreator(value: unknown, path: string, metadata: GrokRetrievalMetadata): { id?: string; name: string } {
  const creator = record(value, path, metadata);
  const id = optionalString(creator.id, `${path}.id`, metadata);
  const name = string(creator.displayName ?? creator.name, `${path}.displayName`, metadata);
  return id === undefined ? { name } : { id, name };
}

function parseBase(value: unknown, path: string, metadata: GrokRetrievalMetadata, featuredIds?: ReadonlySet<string>) {
  const item = record(value, path, metadata);
  const externalId = string(item.id, `${path}.id`, metadata);
  const slug = string(item.slug, `${path}.slug`, metadata);
  const name = string(item.name, `${path}.name`, metadata);
  const summary = optionalString(item.description, `${path}.description`, metadata);
  const creator = parseCreator(item.creator, `${path}.creator`, metadata);
  const categories = item.categories === undefined ? undefined : stringArray(item.categories, `${path}.categories`, metadata);
  const installCount = number(item.installCount, `${path}.installCount`, metadata);
  const placements = item.placements === undefined ? [] : stringArray(item.placements, `${path}.placements`, metadata);
  const featured = featuredIds?.has(externalId) === true || featuredIds?.has(slug) === true || item.featured === true || placements.includes("featured");
  return { item, externalId, slug, name, summary, creator, categories, installCount, featured };
}

function normalizeTemplate(base: ReturnType<typeof parseBase>, metadata: GrokRetrievalMetadata): Template {
  const identity = source(base.externalId);
  const url = metadata.source.externalId === "index"
    ? new URL(`bots/${encodeURIComponent(base.slug)}`, metadata.url.endsWith("/") ? metadata.url : `${metadata.url}/`).toString()
    : metadata.url;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${PROVIDER}:${base.externalId}`,
    name: base.name,
    summary: base.summary ?? "",
    creator: base.creator,
    categories: base.categories ?? [],
    firstSeenAt: metadata.retrievedAt,
    lastSeenAt: metadata.retrievedAt,
    featured: base.featured,
    provenance: { schemaVersion: SCHEMA_VERSION, source: identity, retrievedAt: metadata.retrievedAt, url },
  };
}

export function parseIndex(document: RawGrokDocument): ParsedTemplate[] {
  const located = locateProperty(document, INDEX_KEYS);
  const entries = array(located.value, located.path, document);
  let featuredLocation: LocatedValue | undefined;
  try { featuredLocation = locateProperty(document, ["featuredBotIds", "featuredIds"]); } catch (error) {
    if (!(error instanceof SourceSchemaDriftError)) throw error;
  }
  const featuredIds = new Set(featuredLocation === undefined ? [] : stringArray(featuredLocation.value, featuredLocation.path, document));
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  return entries.map((entry, index) => {
    const path = `${located.path}.${index}`;
    const base = parseBase(entry, path, document, featuredIds);
    if (seenIds.has(base.externalId)) drift(document, `${path}.id`, "unique source identifier", base.externalId);
    if (seenSlugs.has(base.slug)) drift(document, `${path}.slug`, "unique public slug", base.slug);
    seenIds.add(base.externalId);
    seenSlugs.add(base.slug);
    return { template: normalizeTemplate(base, document), installCount: base.installCount, slug: base.slug };
  });
}

function componentArray<T>(input: unknown, path: string, metadata: GrokRetrievalMetadata, parser: (item: JsonRecord, itemPath: string) => T): T[] | undefined {
  if (input === undefined || input === null) return undefined;
  return array(input, path, metadata).map((value, index) => parser(record(value, `${path}.${index}`, metadata), `${path}.${index}`));
}

export function parseDetail(document: RawGrokDocument): ParsedManifest {
  const located = locateProperty(document, DETAIL_KEYS);
  const base = parseBase(located.value, located.path, document);
  const path = located.path;
  if (document.source.externalId !== "unknown" && document.source.externalId !== base.externalId) {
    drift(document, `${path}.id`, `requested source identifier ${document.source.externalId}`, base.externalId);
  }
  const unavailableFields: string[] = [];
  if (base.summary === undefined) unavailableFields.push("template.summary");
  if (base.categories === undefined) unavailableFields.push("template.categories");
  if (base.creator.id === undefined) unavailableFields.push("template.creator.id");
  const instructions = optionalString(base.item.systemPrompt, `${path}.systemPrompt`, document);
  if (instructions === undefined) unavailableFields.push("instructions");
  const memories = componentArray(base.item.memories, `${path}.memories`, document, (item, itemPath) => ({
    id: string(item.id, `${itemPath}.id`, document), name: string(item.name, `${itemPath}.name`, document), content: string(item.content, `${itemPath}.content`, document),
  }));
  const skills = componentArray(base.item.skills, `${path}.skills`, document, (item, itemPath) => {
    const skillInstructions = optionalString(item.instructions, `${itemPath}.instructions`, document);
    const skill = { id: string(item.id, `${itemPath}.id`, document), name: string(item.name, `${itemPath}.name`, document), description: string(item.description, `${itemPath}.description`, document) };
    return skillInstructions === undefined ? skill : { ...skill, instructions: skillInstructions };
  });
  const routines = componentArray(base.item.routines, `${path}.routines`, document, (item, itemPath) => ({
    id: string(item.id, `${itemPath}.id`, document), name: string(item.name, `${itemPath}.name`, document), instructions: string(item.instructions, `${itemPath}.instructions`, document),
  }));
  const integrations = componentArray(base.item.integrations, `${path}.integrations`, document, (item, itemPath) => ({
    id: string(item.id, `${itemPath}.id`, document), name: string(item.name, `${itemPath}.name`, document),
    required: item.required === true ? true : item.required === false ? false : drift(document, `${itemPath}.required`, "boolean", item.required),
  }));
  if (memories === undefined) unavailableFields.push("memories");
  if (skills === undefined) unavailableFields.push("skills");
  if (routines === undefined) unavailableFields.push("routines");
  if (integrations === undefined) unavailableFields.push("integrations");
  const template = normalizeTemplate(base, document);
  const manifestBase = {
    schemaVersion: SCHEMA_VERSION,
    id: `${PROVIDER}:${base.externalId}:manifest`,
    source: source(base.externalId), retrievedAt: document.retrievedAt, provenanceUrl: template.provenance.url, template,
    memories: memories ?? [], skills: skills ?? [], routines: routines ?? [], integrations: integrations ?? [], unavailableFields,
  };
  return { manifest: instructions === undefined ? manifestBase : { ...manifestBase, instructions }, installCount: base.installCount };
}
