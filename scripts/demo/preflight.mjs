// Preflight gates for `npm run demo`. All checks fail fast with a DemoError that
// carries a concise remediation; nothing is launched when a gate fails.

import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { DEMO_MIN_NODE_MAJOR, DEMO_MIN_NODE_MINOR } from "./constants.mjs";
import { DemoError } from "./errors.mjs";

/**
 * Reject Node.js versions below 22.5 (the built-in SQLite API requirement).
 * @param {string} version process.versions.node (or the CLONE_MARKET_DEMO_NODE_VERSION test hook)
 */
export function checkNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  const major = match === null ? Number.NaN : Number(match[1]);
  const minor = match === null ? Number.NaN : Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new DemoError(
      "demo_node_version",
      `Unrecognized Node.js version "${version}".`,
      "install Node.js 22.5 or newer, then retry npm run demo.",
    );
  }
  if (major < DEMO_MIN_NODE_MAJOR || (major === DEMO_MIN_NODE_MAJOR && minor < DEMO_MIN_NODE_MINOR)) {
    throw new DemoError(
      "demo_node_version",
      `Node.js ${version} is below the required 22.5 (built-in SQLite API).`,
      "install Node.js 22.5 or newer, then retry npm run demo.",
    );
  }
}

/**
 * Reject checkouts whose dependencies are absent. The demo never installs them.
 * @param {string} root repository root
 */
export async function checkDependencies(root) {
  const missing = [];
  try {
    const info = await stat(join(root, "node_modules"));
    if (!info.isDirectory()) missing.push("node_modules/");
  } catch {
    missing.push("node_modules/");
  }
  if (missing.length === 0) {
    const require = createRequire(join(root, "package.json"));
    for (const specifier of ["next/package.json", "typescript/package.json"]) {
      try {
        require.resolve(specifier);
      } catch {
        missing.push(specifier.replace("/package.json", ""));
      }
    }
  }
  if (missing.length > 0) {
    throw new DemoError(
      "demo_dependencies_missing",
      `Dependencies are absent (${missing.join(", ")} not found under ${root}).`,
      "run npm ci from the repository root, then retry npm run demo.",
    );
  }
}

/** True when the path exists and is readable. */
export async function isReadable(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse and range-check a TCP port.
 * @param {unknown} value raw port value
 * @param {string} name human-readable port name for error messages
 */
export function checkPortNumber(value, name) {
  const port = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DemoError(
      "demo_invalid_args",
      `Invalid ${name} "${String(value)}": expected an integer from 1 to 65535.`,
      `pass --${name === "web port" ? "port" : "fixture-port"} <1-65535> or unset the corresponding CLONE_MARKET_DEMO_* variable.`,
    );
  }
  return port;
}

/**
 * Fail when the requested port cannot be bound. EADDRINUSE maps to
 * demo_port_occupied; any other bind failure maps to demo_port_unavailable.
 */
export async function checkPortFree(port, host, name) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      const code = error?.code;
      if (code === "EADDRINUSE") {
        reject(new DemoError(
          "demo_port_occupied",
          `${name} ${port} is already in use.`,
          `stop the process on port ${port}, or rerun with --${name === "web port" ? "port" : "fixture-port"} <free-port>.`,
        ));
      } else {
        reject(new DemoError(
          "demo_port_unavailable",
          `Cannot bind ${name} ${port} (${code ?? error?.message ?? "unknown error"}).`,
          "rerun where loopback listeners are permitted, or choose another port with --port / --fixture-port.",
        ));
      }
    });
    probe.listen(port, host, () => {
      probe.close(() => resolve());
    });
  });
}

/** Run every preflight gate. Resolves when the demo may proceed to build. */
export async function runPreflight({ root, version, webPort, fixturePort, host }) {
  checkNodeVersion(version);
  await checkDependencies(root);
  await checkPortFree(webPort, host, "web port");
  await checkPortFree(fixturePort, host, "fixture port");
}
