#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function expandWorkspace(root, pattern) {
  if (!pattern.endsWith("/*")) {
    return [resolve(root, pattern)];
  }

  const parent = resolve(root, pattern.slice(0, -2));
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => resolve(parent, entry.name));
}

export async function checkBoundaries(root) {
  const rootPackage = await readJson(resolve(root, "package.json"));
  const patterns = Array.isArray(rootPackage.workspaces)
    ? rootPackage.workspaces
    : rootPackage.workspaces?.packages ?? [];
  const directories = (await Promise.all(patterns.map((pattern) => expandWorkspace(root, pattern)))).flat();
  const packages = [];
  const coreDependencies = new Set(rootPackage.cloneMarket?.coreDependencies ?? []);

  for (const directory of directories) {
    const packageJsonPath = resolve(directory, "package.json");
    try {
      const manifest = await readJson(packageJsonPath);
      packages.push({
        name: manifest.name,
        layer: manifest.cloneMarket?.layer,
        manifest,
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const violations = [];

  for (const pkg of packages) {
    if (!pkg.name || !pkg.layer) {
      violations.push(`${pkg.name ?? "<unnamed>"}: missing cloneMarket.layer`);
      continue;
    }

    for (const field of dependencyFields) {
      for (const dependency of Object.keys(pkg.manifest[field] ?? {})) {
        const target = byName.get(dependency);
        if (!target) {
          if (pkg.layer === "core" && !coreDependencies.has(dependency)) {
            violations.push(
              `${pkg.name} (core) -> ${dependency} (external): core dependency is not in cloneMarket.coreDependencies`,
            );
          }
          continue;
        }

        const edge = `${pkg.name} (${pkg.layer}) -> ${target.name} (${target.layer})`;
        if (pkg.layer === "core") {
          violations.push(`${edge}: core cannot depend on another workspace package`);
        } else if (pkg.layer === "compatibility" && target.name !== "@clone-market/core") {
          violations.push(`${edge}: compatibility can depend only on @clone-market/core`);
        } else if (pkg.layer === "source" && target.layer === "target") {
          violations.push(`${edge}: source packages cannot depend on target packages`);
        } else if (pkg.layer === "target" && target.layer === "source") {
          violations.push(`${edge}: target packages cannot depend on source packages`);
        }
      }
    }
  }

  return violations;
}

async function main() {
  const rootIndex = process.argv.indexOf("--root");
  const root = resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd());
  const violations = await checkBoundaries(root);
  if (violations.length > 0) {
    console.error("Package boundary violations:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log("Package boundaries valid.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
