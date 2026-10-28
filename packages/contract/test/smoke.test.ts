import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED_EXPORTS = new Set([".", "./package.json"]);

/** The runtime values of the root entry point: an allowlist. */
const ENTRY_VALUES = [
  "MODEL_FORMAT_VERSION",
  "coreChangeTable",
  "defineContract",
  "defineDeclarationKind",
  "defineExtension",
  "diagnosticCodes",
  "normalize",
];

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("@paddockjs/contract", () => {
  it("loads its entry module", async () => {
    const entry: unknown = await import("../src/index.js");
    expect(entry).toBeTypeOf("object");
  });

  it("exposes only the allowlisted entry points", () => {
    const keys = Object.keys(manifest.exports);
    expect(keys).toContain(".");
    expect(keys.filter((key) => !ALLOWED_EXPORTS.has(key))).toEqual([]);
  });

  it("exports exactly the core values (P3)", async () => {
    const entry = (await import("../src/index.js")) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(ENTRY_VALUES);
    expect(entry.MODEL_FORMAT_VERSION).toBe(1);
  });

  it("depends on zod as a peer only (P1)", () => {
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.peerDependencies).toEqual({ zod: "^4.6.0" });
    expect(manifest.devDependencies).toEqual({ zod: "4.6.7" });
  });

  it("imports zod only from zod/v4/core (P2)", () => {
    const zodImports = sourceFiles().flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/from "(zod[^"]*)"/g)].map(
        (match) => match[1],
      ),
    );
    expect(zodImports.length).toBeGreaterThan(0);
    expect(new Set(zodImports)).toEqual(new Set(["zod/v4/core"]));
  });

  it("holds only the entry point, the core, kinds and versioning; the core names no concrete kind (T14)", () => {
    const files = sourceFiles().map((file) =>
      relative(sourceRoot, file).split("\\").join("/"),
    );
    expect(
      files.filter(
        (file) =>
          file !== "index.ts" &&
          !file.startsWith("core/") &&
          !/^kinds\/[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*\//.test(file) &&
          !file.startsWith("versioning/"),
      ),
    ).toEqual([]);
    const mentions = sourceFiles(join(sourceRoot, "core")).filter((file) =>
      /"(source|intent|widget|slot)"/.test(readFileSync(file, "utf8")),
    );
    expect(mentions).toEqual([]);
  });
});
