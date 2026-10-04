import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { verifyBotmancersPeerRepo } from "./peer-repo.js";

describe("Botmancers peer-repo check [agent]", () => {
  it("skips when BOTMANCERS_ROOT is unset", () => {
    expect(verifyBotmancersPeerRepo(undefined).status).toBe("skipped");
  });

  it("passes source inspection when npm test is absent and records tsc without requiring peer node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "clone-market-peer-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "botmancers",
        scripts: { lint: "eslint", "test:acceptance": "node test.js" },
      }));
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true } }));
      mkdirSync(join(root, "app/api/bots"), { recursive: true });
      writeFileSync(join(root, "app/api/bots/route.ts"), "export function GET() { return bots.getAll(); }\n");
      writeFileSync(join(root, "import.ts"), "bots.getByImportOperationId(body.operation_id);\n");
      const result = verifyBotmancersPeerRepo(root);
      expect(result.returnRouteConfirmed).toBe(true);
      expect(result.idempotencyKeyConfirmed).toBe(true);
      expect(result.test?.command).toMatch(/skipped/);
      expect(result.status).toBe("passed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs package scripts that exist and confirms bots route plus operation identity", () => {
    const root = mkdtempSync(join(tmpdir(), "clone-market-peer-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "botmancers-fixture",
        scripts: { typecheck: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" },
      }));
      mkdirSync(join(root, "app/api/bots"), { recursive: true });
      writeFileSync(join(root, "app/api/bots/route.ts"), "export function GET() { return '/bots/' + id }\n");
      writeFileSync(join(root, "import.ts"), "const import_operation_id = body.operation_id;\n");
      const result = verifyBotmancersPeerRepo(root);
      expect(result.status).toBe("passed");
      expect(result.returnRouteConfirmed).toBe(true);
      expect(result.idempotencyKeyConfirmed).toBe(true);
      expect(result.typecheck?.status).toBe(0);
      expect(result.test?.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
