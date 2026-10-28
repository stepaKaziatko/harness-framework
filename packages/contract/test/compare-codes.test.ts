import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  changeCodes,
  comparisonDiagnosticCodes,
} from "../src/versioning/codes.js";

const CODE =
  /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*\.[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/;

describe("the catalogs of version comparison (C20)", () => {
  it("has exactly the 19 change codes", () => {
    expect(Object.keys(changeCodes)).toEqual([
      "entry.added",
      "entry.removed",
      "value.changed",
      "value.unclassified",
      "set.added",
      "set.removed",
      "order.raised",
      "order.lowered",
      "table.missing",
      "schema.property-added",
      "schema.property-removed",
      "schema.required-added",
      "schema.required-removed",
      "schema.narrowed",
      "schema.widened",
      "schema.type-changed",
      "schema.default-changed",
      "schema.annotation-changed",
      "schema.unrecognized",
    ]);
  });

  it.each(Object.entries(changeCodes))(
    "%s has a summary and follows the grammar of codes",
    (code, info) => {
      expect(code).toMatch(CODE);
      expect(Object.keys(info)).toEqual(["summary"]);
      expect(info.summary.length).toBeGreaterThan(0);
    },
  );

  it("has exactly the 5 diagnostic codes, all errors", () => {
    expect(Object.keys(comparisonDiagnosticCodes)).toEqual([
      "compare.invalid-model",
      "compare.unsupported-format",
      "compare.invalid-table",
      "compare.table-conflict",
      "compare.insufficient-bump",
    ]);
    for (const [code, info] of Object.entries(comparisonDiagnosticCodes)) {
      expect(code).toMatch(CODE);
      expect(info.severity).toBe("error");
      expect(info.summary.length).toBeGreaterThan(0);
    }
  });

  it("freezes both catalogs and their entries", () => {
    expect(Object.isFrozen(changeCodes)).toBe(true);
    expect(Object.isFrozen(comparisonDiagnosticCodes)).toBe(true);
    for (const info of Object.values(changeCodes)) {
      expect(Object.isFrozen(info)).toBe(true);
    }
    for (const info of Object.values(comparisonDiagnosticCodes)) {
      expect(Object.isFrozen(info)).toBe(true);
    }
  });
});

describe("the engine knows no concrete kind (R12)", () => {
  const directory = new URL("../src/versioning/", import.meta.url);
  const files = readdirSync(directory);

  it("has its modules in src/versioning", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s names no source, intent, widget or slot", (file) => {
    const text = readFileSync(new URL(file, directory), "utf8");
    expect(text).not.toMatch(/"(source|intent|widget|slot)"/);
  });
});
