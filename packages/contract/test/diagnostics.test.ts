import { describe, expect, it } from "vitest";
import { diagnosticCodes, type CoreDiagnosticCode } from "../src/index.js";

const RESERVED_AREAS = [
  "root",
  "contract",
  "name",
  "import",
  "reference",
  "permission",
  "declaration",
  "descriptor",
  "schema",
];

describe("the catalog of core codes (T9)", () => {
  const codes = Object.keys(diagnosticCodes);

  it("has 28 codes", () => {
    expect(codes).toHaveLength(28);
  });

  it.each(codes)("%s follows the grammar of codes", (code) => {
    expect(code).toMatch(
      /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*\.[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/,
    );
    expect(RESERVED_AREAS).toContain(code.split(".")[0]);
    const info = diagnosticCodes[code as CoreDiagnosticCode];
    expect(info.severity).toBe("error");
    expect(info.summary.length).toBeGreaterThan(0);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(diagnosticCodes)).toBe(true);
    expect(Object.isFrozen(diagnosticCodes["root.invalid-shape"])).toBe(true);
  });
});
