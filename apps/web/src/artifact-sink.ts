import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const BOTMANCERS_IMPORT_ARTIFACT = "botmancers/import.json";

export type ArtifactFile = {
  path: string;
  content: string;
};

export type ArtifactPutResult = {
  identity: string;
  created: boolean;
};

export interface ArtifactSink {
  put(identity: string, files: readonly ArtifactFile[]): Promise<ArtifactPutResult>;
  read(identity: string, path: string): Promise<string | undefined>;
  list(identity: string): Promise<string[]>;
}

export class ArtifactSinkError extends Error {
  constructor(
    readonly code: "sink_unavailable" | "identity_conflict",
    message: string,
  ) {
    super(message);
    this.name = "ArtifactSinkError";
  }
}

export function artifactDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function assertIdentity(identity: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(identity)) {
    throw new ArtifactSinkError("sink_unavailable", "Artifact identity is not a safe sink key");
  }
}

function assertRelativePath(path: string): void {
  if (path.length === 0 || path.startsWith("/") || path.includes("..") || path.includes("\0")) {
    throw new ArtifactSinkError("sink_unavailable", `Refusing unsafe artifact path ${path}`);
  }
}

export class MemoryArtifactSink implements ArtifactSink {
  readonly store = new Map<string, Map<string, string>>();
  unavailable = false;

  async put(identity: string, files: readonly ArtifactFile[]): Promise<ArtifactPutResult> {
    assertIdentity(identity);
    if (this.unavailable) throw new ArtifactSinkError("sink_unavailable", "Artifact sink is unavailable");
    const next = new Map<string, string>();
    for (const file of files) {
      assertRelativePath(file.path);
      next.set(file.path, file.content);
    }
    const existing = this.store.get(identity);
    if (existing !== undefined) {
      if (existing.size === next.size && [...next.entries()].every(([path, content]) => existing.get(path) === content)) {
        return { identity, created: false };
      }
      throw new ArtifactSinkError("identity_conflict", `Artifact ${identity} already exists with different content`);
    }
    this.store.set(identity, next);
    return { identity, created: true };
  }

  async read(identity: string, path: string): Promise<string | undefined> {
    assertIdentity(identity);
    assertRelativePath(path);
    return this.store.get(identity)?.get(path);
  }

  async list(identity: string): Promise<string[]> {
    assertIdentity(identity);
    return [...(this.store.get(identity)?.keys() ?? [])].sort();
  }
}

export class FileArtifactSink implements ArtifactSink {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async put(identity: string, files: readonly ArtifactFile[]): Promise<ArtifactPutResult> {
    assertIdentity(identity);
    let rootStat;
    try {
      mkdirSync(this.#root, { recursive: true });
      rootStat = statSync(this.#root);
    } catch (error) {
      throw new ArtifactSinkError("sink_unavailable", error instanceof Error ? error.message : "Artifact sink is unavailable");
    }
    if (!rootStat.isDirectory()) {
      throw new ArtifactSinkError("sink_unavailable", `Artifact sink ${this.#root} is not a directory`);
    }
    const identityDir = join(this.#root, identity);
    if (existsSync(identityDir)) {
      return this.#putExisting(identity, files);
    }
    const tmpDir = mkdtempSync(join(this.#root, `.tmp-${identity}-`));
    try {
      for (const file of files) {
        assertRelativePath(file.path);
        const destination = join(tmpDir, file.path);
        const relativePath = relative(tmpDir, destination);
        if (relativePath.startsWith("..") || relativePath.includes(`..${sep}`)) {
          throw new ArtifactSinkError("sink_unavailable", `Refusing unsafe artifact path ${file.path}`);
        }
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, file.content, "utf8");
      }
      renameSync(tmpDir, identityDir);
    } catch (error) {
      rmSync(tmpDir, { recursive: true, force: true });
      if (error instanceof ArtifactSinkError) throw error;
      if (existsSync(identityDir)) {
        return this.#putExisting(identity, files);
      }
      throw new ArtifactSinkError("sink_unavailable", error instanceof Error ? error.message : "Artifact sink is unavailable");
    }
    return { identity, created: true };
  }

  async #putExisting(identity: string, files: readonly ArtifactFile[]): Promise<ArtifactPutResult> {
    const current = new Map<string, string>();
    for (const path of await this.list(identity)) {
      const content = await this.read(identity, path);
      if (content !== undefined) current.set(path, content);
    }
    const same = files.length === current.size
      && files.every((file) => current.get(file.path) === file.content);
    if (same) return { identity, created: false };
    throw new ArtifactSinkError("identity_conflict", `Artifact ${identity} already exists with different content`);
  }

  async read(identity: string, path: string): Promise<string | undefined> {
    assertIdentity(identity);
    assertRelativePath(path);
    const destination = join(this.#root, identity, path);
    if (!existsSync(destination)) return undefined;
    return readFileSync(destination, "utf8");
  }

  async list(identity: string): Promise<string[]> {
    assertIdentity(identity);
    const identityDir = join(this.#root, identity);
    if (!existsSync(identityDir)) return [];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(relative(identityDir, full).split(sep).join("/"));
      }
    };
    walk(identityDir);
    return files.sort();
  }
}
