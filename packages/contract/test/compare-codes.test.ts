import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  changeCodes,
  comparisonDiagnosticCodes,
} from "../src/versioning/codes.js";
import {
  compareModels,
  type CompareOptions,
} from "../src/versioning/compare.js";
import { edited, model, type Model } from "./support/compare.js";
import { probe } from "./support/test-kind.js";

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

const ORDERS = "trading.orders.place";
const FEED = "trading.quotes.feed";
const schemaAt =
  (direction: "input" | "output", schema: unknown) => (m: Model) => {
    m.declarations["trading.orders.history"].spec[direction] = schema;
  };

/** Minimal pairs: [previous edit, next edit, options]. */
const pairs: [
  string,
  (m: Model) => void,
  (m: Model) => void,
  CompareOptions?,
][] = [
  ["entry", () => {}, (m) => delete m.declarations[ORDERS]],
  ["entry added", () => {}, (m) => (m.imports.extra = { range: "^1.0.0" })],
  ["value", () => {}, (m) => (m.contract.name = "other")],
  ["unclassified", () => {}, (m) => (m.notes = 1)],
  [
    "set",
    () => {},
    (m) => (m.declarations[ORDERS].requires = ["trading.zeta"]),
  ],
  [
    "order raised",
    () => {},
    (m) => (m.declarations[ORDERS].stability = "public"),
  ],
  ["order lowered", () => {}, (m) => (m.declarations[FEED].stability = "beta")],
  [
    "table missing",
    () => {},
    (m) => (m.declarations[FEED].spec.note = "x"),
    {},
  ],
  [
    "properties",
    schemaAt("input", { properties: { a: {}, b: {} }, required: ["b"] }),
    schemaAt("input", {
      properties: { b: {}, c: {}, d: {} },
      required: ["c"],
    }),
  ],
  [
    "required removed",
    schemaAt("input", { properties: { a: {} }, required: ["a"] }),
    schemaAt("input", { properties: { a: {} } }),
  ],
  [
    "narrowed and widened",
    schemaAt("input", { enum: [1, 2] }),
    schemaAt("input", { enum: [1, 3] }),
  ],
  [
    "type",
    schemaAt("input", { type: "string" }),
    schemaAt("input", { type: "number" }),
  ],
  [
    "default and annotation",
    schemaAt("input", { default: 1, title: "a" }),
    schemaAt("input", { default: 2, title: "b" }),
  ],
  ["unrecognized", schemaAt("input", {}), schemaAt("input", { not: {} })],
];

/** Calls that fail: [previous, next, options]. */
const failures: [string, unknown, unknown, unknown][] = [
  ["invalid model", null, model(), undefined],
  [
    "unsupported format",
    edited((m) => (m.formatVersion = 2)),
    model(),
    undefined,
  ],
  [
    "invalid table",
    model(),
    model(),
    { kinds: [{ kind: "probe", changes: {} }] },
  ],
  [
    "table conflict",
    model(),
    model(),
    { kinds: [probe, { kind: "probe", changes: { fields: {} } }] },
  ],
  [
    "insufficient bump",
    model(),
    edited((m) => delete m.declarations[ORDERS]),
    undefined,
  ],
];

describe("every code of both catalogs is produced by a case (C20)", () => {
  it("covers the change codes", () => {
    const seen = new Set<string>();
    for (const [, before, after, options] of pairs) {
      const result = compareModels(
        edited(before),
        edited(after),
        options ?? { kinds: [probe] },
      );
      if (!("changes" in result)) throw new Error(JSON.stringify(result));
      for (const change of result.changes) seen.add(change.code);
    }
    expect([...seen].sort()).toEqual(Object.keys(changeCodes).sort());
  });

  it("covers the diagnostic codes", () => {
    const seen = failures.map(
      ([, previous, next, options]) =>
        compareModels(previous, next, options as CompareOptions).diagnostics[0]
          ?.code,
    );
    expect(seen).toEqual(Object.keys(comparisonDiagnosticCodes));
  });
});
