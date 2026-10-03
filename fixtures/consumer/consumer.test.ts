import { describe, expect, it } from "vitest";

import { validateExternalManifest } from "./src/index.js";

describe("external package consumer", () => {
  it("imports the built public package and validates a manifest", () => {
    expect(() =>
      validateExternalManifest({
        schemaVersion: "1.0.0",
        id: "manifest-1",
        source: { provider: "fixture", externalId: "template-1" },
        retrievedAt: "2026-10-03T12:00:00.000Z",
        provenanceUrl: "https://example.com/template-1",
        template: {
          schemaVersion: "1.0.0",
          id: "template-1",
          name: "Fixture",
          summary: "External fixture",
          creator: { name: "Fixture author" },
          categories: [],
          firstSeenAt: "2026-10-03T12:00:00.000Z",
          lastSeenAt: "2026-10-03T12:00:00.000Z",
          featured: false,
          provenance: {
            schemaVersion: "1.0.0",
            source: { provider: "fixture", externalId: "template-1" },
            retrievedAt: "2026-10-03T12:00:00.000Z",
            url: "https://example.com/template-1",
          },
        },
        memories: [],
        skills: [],
        routines: [],
        integrations: [],
        unavailableFields: [],
      }),
    ).not.toThrow();
  });
});
