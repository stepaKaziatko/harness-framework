import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALLOWED_EXPORTS = new Set([".", "./package.json"]);

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { exports: Record<string, unknown> };

describe("@paddockjs/sandbox", () => {
  it("loads its entry module", async () => {
    const entry: unknown = await import("../src/index.js");
    expect(entry).toBeTypeOf("object");
  });

  it("exposes only the allowlisted entry points", () => {
    const keys = Object.keys(manifest.exports);
    expect(keys).toContain(".");
    expect(keys.filter((key) => !ALLOWED_EXPORTS.has(key))).toEqual([]);
  });
});
