#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const forbidden = [
  /@clone-market\/(?:source-grok|compatibility|target-botmancers)\/src\//,
  /packages\/(?:source-grok|compatibility|target-botmancers)\/src\//,
  /(?:function|const)\s+(?:parseDetail|parseIndex|deriveAdoptionSnapshot|payloadFor|rationaleClassifications)\b/,
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.filter((entry) => ![".next", "node_modules", "dist"].includes(entry.name)).map((entry) => entry.isDirectory()
    ? files(join(directory, entry.name))
    : [join(directory, entry.name)]))).flat();
}

export async function checkWebBoundaries(root) {
  const web = resolve(root, "apps/web");
  const candidates = (await files(web)).filter((file) => [".ts", ".tsx", ".js", ".mjs"].includes(extname(file)));
  const violations = [];
  for (const file of candidates) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbidden) if (pattern.test(source)) violations.push(`${relative(root, file)} crosses a package implementation boundary`);
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = await checkWebBoundaries(process.cwd());
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else console.log("Web package boundaries valid.");
}
