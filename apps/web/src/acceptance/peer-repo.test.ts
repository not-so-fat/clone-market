import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { verifyBotmancersPeerRepo } from "./peer-repo.js";

function writePeerFixture(root: string, files: Record<string, string>): void {
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
}

describe("Botmancers peer-repo check [agent]", () => {
  it("skips when BOTMANCERS_ROOT is unset", () => {
    expect(verifyBotmancersPeerRepo(undefined).status).toBe("skipped");
  });

  it("does not treat an API bots route as the UI bots/<id> page", () => {
    const root = mkdtempSync(join(tmpdir(), "clone-market-peer-"));
    try {
      writePeerFixture(root, {
        "package.json": JSON.stringify({
          name: "botmancers",
          scripts: { lint: "node -e \"process.exit(0)\"", typecheck: "node -e \"process.exit(0)\"" },
        }),
        "app/api/bots/route.ts": "export function GET() { return bots.getAll(); }\n",
        "import.ts": "bots.getByImportOperationId(body.operation_id);\n",
      });
      const result = verifyBotmancersPeerRepo(root);
      expect(result.returnRouteConfirmed).toBe(false);
      expect(result.status).toBe("failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("confirms a Botmancers UI page at app/bots/[id] and passing lint/typecheck", () => {
    const root = mkdtempSync(join(tmpdir(), "clone-market-peer-"));
    try {
      writePeerFixture(root, {
        "package.json": JSON.stringify({
          name: "botmancers-fixture",
          scripts: {
            lint: "node -e \"process.exit(0)\"",
            typecheck: "node -e \"process.exit(0)\"",
            test: "node -e \"process.exit(0)\"",
          },
        }),
        "app/bots/[id]/page.tsx": "export default function BotPage() { return null }\n",
        "import.ts": "const import_operation_id = body.operation_id;\n",
      });
      const result = verifyBotmancersPeerRepo(root);
      expect(result.status).toBe("passed");
      expect(result.returnRouteConfirmed).toBe(true);
      expect(result.idempotencyKeyConfirmed).toBe(true);
      expect(result.lint?.status).toBe(0);
      expect(result.typecheck?.status).toBe(0);
      expect(result.test?.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never reports passed when tsc was executed and failed", () => {
    const root = mkdtempSync(join(tmpdir(), "clone-market-peer-"));
    try {
      writePeerFixture(root, {
        "package.json": JSON.stringify({
          name: "botmancers",
          scripts: { lint: "node -e \"process.exit(0)\"" },
        }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true, strict: true } }),
        "broken.ts": "const x: number = \"nope\";\n",
        "app/bots/[id]/page.tsx": "export default function BotPage() { return null }\n",
        "import.ts": "const operation_id = body.operation_id;\n",
      });
      const result = verifyBotmancersPeerRepo(root);
      expect(result.typecheck?.status).not.toBe(0);
      expect(result.status).not.toBe("passed");
      expect(["failed", "unverified"]).toContain(result.status);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports failed (not passed) when a typecheck script exits nonzero with node_modules present", () => {
    const root = mkdtempSync(join(tmpdir(), "clone-market-peer-"));
    try {
      writePeerFixture(root, {
        "package.json": JSON.stringify({
          name: "botmancers",
          scripts: { typecheck: "node -e \"process.exit(1)\"" },
        }),
        "node_modules/.keep": "",
        "app/bots/[id]/page.tsx": "export default function BotPage() { return null }\n",
        "import.ts": "const operation_id = body.operation_id;\n",
      });
      const result = verifyBotmancersPeerRepo(root);
      expect(result.typecheck?.status).toBe(1);
      expect(result.status).toBe("failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
