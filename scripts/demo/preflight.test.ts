import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DemoError } from "./errors.mjs";
import { checkDependencies, checkNodeVersion, checkPortNumber } from "./preflight.mjs";

describe("demo preflight gates [agent]", () => {
  it("accepts Node.js 22.5 and newer", () => {
    expect(() => checkNodeVersion("22.5.0")).not.toThrow();
    expect(() => checkNodeVersion("22.9.1")).not.toThrow();
    expect(() => checkNodeVersion("v26.10.0")).not.toThrow();
    expect(() => checkNodeVersion(process.versions.node)).not.toThrow();
  });

  it("rejects old or unrecognized Node.js versions with remediation", () => {
    for (const version of ["22.4.9", "20.19.0", "18.0.0", "not-a-version", ""]) {
      try {
        checkNodeVersion(version);
        expect.unreachable(`version ${version} should fail preflight`);
      } catch (error) {
        expect(error).toBeInstanceOf(DemoError);
        const demoError = error as DemoError;
        expect(demoError.code).toBe("demo_node_version");
        expect(demoError.remediation).toContain("22.5");
        expect(demoError.format()).toContain("error[demo_node_version]");
      }
    }
  });

  it("passes dependency checks on the real checkout and fails on an empty root", async () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    await expect(checkDependencies(root)).resolves.toBeUndefined();
    const empty = mkdtempSync(join(tmpdir(), "demo-empty-root-"));
    try {
      await expect(checkDependencies(empty)).rejects.toMatchObject({
        code: "demo_dependencies_missing",
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("names the remediation for missing dependencies", async () => {
    const empty = mkdtempSync(join(tmpdir(), "demo-empty-root-"));
    try {
      const failure = await checkDependencies(empty).then(
        () => undefined,
        (error: unknown) => error as DemoError,
      );
      expect(failure?.code).toBe("demo_dependencies_missing");
      expect(failure?.remediation).toContain("npm ci");
      expect(failure?.format()).toContain("error[demo_dependencies_missing]");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("validates port numbers", () => {
    expect(checkPortNumber("3100", "web port")).toBe(3100);
    expect(checkPortNumber(3101, "fixture port")).toBe(3101);
    for (const value of ["abc", "", "  ", 0, -1, 65536, 3.5, undefined]) {
      expect(() => checkPortNumber(value, "web port")).toThrowError(DemoError);
    }
    try {
      checkPortNumber("abc", "web port");
      expect.unreachable("invalid port should throw");
    } catch (error) {
      expect((error as DemoError).code).toBe("demo_invalid_args");
    }
  });

  it("formats failures as error[code]: message Fix: remediation", () => {
    const error = new DemoError("demo_port_occupied", "Fixture port 3101 is already in use.", "stop it.");
    expect(error.format()).toBe("error[demo_port_occupied]: Fixture port 3101 is already in use. Fix: stop it.");
  });
});
