import { SCHEMA_VERSION, type BotTemplateManifest, type SourceIdentity, type Template } from "@clone-market/core";

import { SourceSchemaDriftError, type GrokRetrievalMetadata } from "./errors.js";

type JsonRecord = Record<string, unknown>;

export type RawGrokDocument = GrokRetrievalMetadata & { body: string };
export type ParsedTemplate = { template: Template; installCount: number };
export type ParsedManifest = { manifest: BotTemplateManifest; installCount: number };

const PROVIDER = "grok-marketplace";
const INDEX_MARKER = "__GROK_MARKETPLACE_INDEX__";
const DETAIL_MARKER = "__GROK_MARKETPLACE_DETAIL__";
const END_MARKER = "__END_GROK_MARKETPLACE__";

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

function decodeFlightChunks(body: string): string {
  let decoded = "";
  const pattern = /self\.__next_f\.push\((\[[\s\S]*?\])\)\s*;?/g;
  for (const match of body.matchAll(pattern)) {
    try {
      const frame = JSON.parse(match[1] ?? "") as unknown;
      if (Array.isArray(frame) && typeof frame[1] === "string") decoded += frame[1];
    } catch {
      // A malformed flight frame will be reported as a missing payload marker below.
    }
  }
  return decoded;
}

function payload(document: RawGrokDocument, marker: string): JsonRecord {
  const decoded = decodeFlightChunks(document.body);
  const searchable = decoded.length > 0 ? decoded : document.body;
  const start = searchable.indexOf(marker);
  if (start < 0) drift(document, "$", `RSC payload marker ${marker}`, undefined);
  const jsonStart = start + marker.length;
  const end = searchable.indexOf(END_MARKER, jsonStart);
  if (end < 0) drift(document, "$", `RSC payload terminator ${END_MARKER}`, undefined);
  try {
    return record(JSON.parse(searchable.slice(jsonStart, end)), "$", document);
  } catch (error) {
    if (error instanceof SourceSchemaDriftError) throw error;
    drift(document, "$", "valid JSON RSC payload", searchable.slice(jsonStart, end));
  }
}

function parseCreator(value: unknown, path: string, metadata: GrokRetrievalMetadata): { id?: string; name: string } {
  const creator = record(value, path, metadata);
  const id = optionalString(creator.id, `${path}.id`, metadata);
  const name = string(creator.displayName, `${path}.displayName`, metadata);
  return id === undefined ? { name } : { id, name };
}

function parseBase(value: unknown, path: string, metadata: GrokRetrievalMetadata) {
  const item = record(value, path, metadata);
  const externalId = string(item.id, `${path}.id`, metadata);
  const slug = string(item.slug, `${path}.slug`, metadata);
  const name = string(item.name, `${path}.name`, metadata);
  const summary = optionalString(item.description, `${path}.description`, metadata);
  const creator = parseCreator(item.creator, `${path}.creator`, metadata);
  const categories = item.categories === undefined ? undefined : stringArray(item.categories, `${path}.categories`, metadata);
  const installCount = number(item.installCount, `${path}.installCount`, metadata);
  const placements = stringArray(item.placements, `${path}.placements`, metadata);
  return { item, externalId, slug, name, summary, creator, categories, installCount, featured: placements.includes("featured") };
}

function normalizeTemplate(base: ReturnType<typeof parseBase>, metadata: GrokRetrievalMetadata): Template {
  const identity = source(base.externalId);
  const url = metadata.source.externalId === "index"
    ? new URL(base.slug, metadata.url.endsWith("/") ? metadata.url : `${metadata.url}/`).toString()
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
  const root = payload(document, INDEX_MARKER);
  const marketplace = record(root.marketplace, "marketplace", document);
  if (marketplace.complete !== true) drift(document, "marketplace.complete", "literal true", marketplace.complete);
  const entries = array(marketplace.templates, "marketplace.templates", document);
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const path = `marketplace.templates.${index}`;
    const base = parseBase(entry, path, document);
    if (seen.has(base.externalId)) drift(document, `${path}.id`, "unique source identifier", base.externalId);
    seen.add(base.externalId);
    return { template: normalizeTemplate(base, document), installCount: base.installCount };
  });
}

function componentArray<T>(input: unknown, path: string, metadata: GrokRetrievalMetadata, parser: (item: JsonRecord, itemPath: string) => T): T[] | undefined {
  if (input === undefined || input === null) return undefined;
  return array(input, path, metadata).map((value, index) => parser(record(value, `${path}.${index}`, metadata), `${path}.${index}`));
}

export function parseDetail(document: RawGrokDocument): ParsedManifest {
  const root = payload(document, DETAIL_MARKER);
  const marketplace = record(root.marketplace, "marketplace", document);
  const base = parseBase(marketplace.template, "marketplace.template", document);
  const path = "marketplace.template";
  const unavailableFields: string[] = [];
  if (base.summary === undefined) unavailableFields.push("template.summary");
  if (base.categories === undefined) unavailableFields.push("template.categories");
  if (base.creator.id === undefined) unavailableFields.push("template.creator.id");
  const instructions = optionalString(base.item.systemPrompt, `${path}.systemPrompt`, document);
  if (instructions === undefined) unavailableFields.push("instructions");

  const memories = componentArray(base.item.memories, `${path}.memories`, document, (item, itemPath) => ({
    id: string(item.id, `${itemPath}.id`, document),
    name: string(item.name, `${itemPath}.name`, document),
    content: string(item.content, `${itemPath}.content`, document),
  }));
  const skills = componentArray(base.item.skills, `${path}.skills`, document, (item, itemPath) => {
    const skillInstructions = optionalString(item.instructions, `${itemPath}.instructions`, document);
    const skill = {
      id: string(item.id, `${itemPath}.id`, document),
      name: string(item.name, `${itemPath}.name`, document),
      description: string(item.description, `${itemPath}.description`, document),
    };
    return skillInstructions === undefined ? skill : { ...skill, instructions: skillInstructions };
  });
  const routines = componentArray(base.item.routines, `${path}.routines`, document, (item, itemPath) => ({
    id: string(item.id, `${itemPath}.id`, document),
    name: string(item.name, `${itemPath}.name`, document),
    instructions: string(item.instructions, `${itemPath}.instructions`, document),
  }));
  const integrations = componentArray(base.item.integrations, `${path}.integrations`, document, (item, itemPath) => ({
    id: string(item.id, `${itemPath}.id`, document),
    name: string(item.name, `${itemPath}.name`, document),
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
    source: source(base.externalId),
    retrievedAt: document.retrievedAt,
    provenanceUrl: template.provenance.url,
    template,
    memories: memories ?? [],
    skills: skills ?? [],
    routines: routines ?? [],
    integrations: integrations ?? [],
    unavailableFields,
  };
  return {
    manifest: instructions === undefined ? manifestBase : { ...manifestBase, instructions },
    installCount: base.installCount,
  };
}
