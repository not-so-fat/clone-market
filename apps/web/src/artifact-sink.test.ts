import { rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactSinkError,
  BOTMANCERS_IMPORT_ARTIFACT,
  FileArtifactSink,
  MemoryArtifactSink,
  artifactDigest,
} from "./artifact-sink.js";

const files = [
  { path: BOTMANCERS_IMPORT_ARTIFACT, content: '{"bot":{"name":"Projects Manager"}}' },
  { path: "botmancers/components.json", content: "[]" },
];

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("artifact sink [agent]", () => {
  it("digests canonical import.json bytes", () => {
    expect(artifactDigest(files[0]!.content)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(artifactDigest(files[0]!.content)).toBe(artifactDigest(files[0]!.content));
    expect(artifactDigest(`${files[0]!.content} `)).not.toBe(artifactDigest(files[0]!.content));
  });

  it("writes once and reuses the same identity without duplicating files", async () => {
    const sink = new MemoryArtifactSink();
    const first = await sink.put("export-1", files);
    const second = await sink.put("export-1", files);
    expect(first).toEqual({ identity: "export-1", created: true });
    expect(second).toEqual({ identity: "export-1", created: false });
    expect(await sink.list("export-1")).toEqual(["botmancers/components.json", BOTMANCERS_IMPORT_ARTIFACT]);
    expect(await sink.read("export-1", BOTMANCERS_IMPORT_ARTIFACT)).toBe(files[0]!.content);
  });

  it("fails without mutating when the sink is unavailable", async () => {
    const sink = new MemoryArtifactSink();
    sink.unavailable = true;
    await expect(sink.put("export-1", files)).rejects.toMatchObject({ code: "sink_unavailable" });
    expect(sink.store.size).toBe(0);
  });

  it("persists to a directory sink and rejects a file used as the root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clone-market-artifacts-"));
    temporaryDirectories.push(directory);
    const sink = new FileArtifactSink(join(directory, "out"));
    await sink.put("export-1", files);
    await sink.put("export-1", files);
    expect(await sink.read("export-1", BOTMANCERS_IMPORT_ARTIFACT)).toBe(files[0]!.content);

    const blocked = join(directory, "not-a-dir");
    writeFileSync(blocked, "nope");
    await expect(new FileArtifactSink(blocked).put("export-1", files)).rejects.toBeInstanceOf(ArtifactSinkError);
  });
});
