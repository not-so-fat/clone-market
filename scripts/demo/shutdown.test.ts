import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

import { stopChild } from "./launcher.mjs";

describe("demo child shutdown [agent]", () => {
  it("stops a child with SIGTERM", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000);"], { stdio: "ignore" });
    const result = await stopChild(child, { graceMs: 5000 });
    expect(result.code).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBe("SIGTERM");
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setTimeout(() => {}, 30000);"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
    const result = await stopChild(child, { graceMs: 200 });
    expect(result.signal).toBe("SIGKILL");
  });

  it("resolves immediately for an already-exited child", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(3);"], { stdio: "ignore" });
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await expect(stopChild(child)).resolves.toEqual({ code: 3, signal: null });
  });
});
