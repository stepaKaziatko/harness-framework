import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  defineContract,
  defineIntent,
  diagnosticCodes,
  intentKind,
  normalize,
} from "../src/index.js";
import { isTable } from "../src/core/changes.js";
import { defineSourceStub } from "./support/source-stub.js";

const DESCRIPTOR = Symbol.for("@paddockjs/contract/descriptor");

const CODES = [
  "intent.unknown-field",
  "intent.params-not-object",
  "intent.missing-confirmation",
  "intent.unknown-confirmation",
  "intent.invalid-limit",
  "intent.missing-requires",
  "intent.invalid-invalidates",
  "intent.foreign-invalidates",
];

const fullIntent = defineIntent({
  name: "orders.place",
  stability: "beta",
  requires: ["orders.place"],
  description: "Place a market order",
  params: z.object({ symbol: z.string() }),
  result: z.object({ id: z.number() }),
  confirmation: "user",
  limits: { perMinute: 10, perHour: 100, perDay: 200 },
  invalidates: ["balance.get"],
});

function normalizeFull() {
  return normalize(
    defineContract({
      name: "trading",
      version: "0.1.0",
      permissions: { "orders.place": {} },
      declarations: [defineSourceStub({ name: "balance.get" }), fullIntent],
    }),
  );
}

function deeplyFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

describe("defineIntent (T6)", () => {
  it("returns a frozen declaration of kind intent", () => {
    expect(fullIntent.kind).toBe("intent");
    expect(Object.isFrozen(fullIntent)).toBe(true);
  });

  it("carries the intent kind descriptor", () => {
    expect((fullIntent as Record<symbol, unknown>)[DESCRIPTOR]).toBe(
      intentKind,
    );
    expect(intentKind.kind).toBe("intent");
  });

  it("is normalized by the intent kind", () => {
    const result = normalizeFull();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.declarations["trading.orders.place"]?.kind).toBe(
      "intent",
    );
  });

  it("does not throw on a wrong input; normalize reports it", () => {
    let declarations: unknown[] = [];
    expect(() => {
      declarations = [
        defineIntent({} as never),
        defineIntent({ name: 1 } as never),
      ];
    }).not.toThrow();
    const result = normalize(
      defineContract({
        name: "trading",
        version: "0.1.0",
        declarations,
      } as never),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["declaration.invalid-envelope", ["declarations", 0]],
      ["declaration.invalid-envelope", ["declarations", 1]],
    ]);
  });
});

describe("the catalog of the intent kind (T14)", () => {
  const catalog = intentKind.diagnostics as Record<
    string,
    { severity: unknown; summary: unknown }
  >;

  it("holds exactly the eight intent codes", () => {
    expect(Object.keys(catalog).sort()).toEqual([...CODES].sort());
  });

  it("gives every code the intent prefix, error severity and a summary", () => {
    for (const code of Object.keys(catalog)) {
      expect(code.startsWith("intent.")).toBe(true);
      expect(catalog[code]?.severity).toBe("error");
      expect(typeof catalog[code]?.summary).toBe("string");
      expect(String(catalog[code]?.summary).length).toBeGreaterThan(0);
    }
  });

  it("does not add a code to the core catalog", () => {
    const core = Object.keys(diagnosticCodes);
    expect(core.filter((code) => code.startsWith("intent."))).toEqual([]);
    expect(Object.keys(catalog).filter((code) => core.includes(code))).toEqual(
      [],
    );
  });

  it("has every code covered by the diagnostics tests", () => {
    const tests = readFileSync(
      new URL("./intent-diagnostics.test.ts", import.meta.url),
      "utf8",
    );
    const covered = new Set(
      [...tests.matchAll(/"(intent\.[a-z-]+)"/g)].map((match) => match[1]),
    );
    expect([...covered].sort()).toEqual(Object.keys(catalog).sort());
  });
});

describe("the change table of the intent kind (T15)", () => {
  it("holds exactly the rows of the intent spec", () => {
    expect(intentKind.changes).toStrictEqual({
      fields: {
        params: { rule: "schema", direction: "input" },
        result: { rule: "schema", direction: "output" },
        confirmation: {
          rule: "nested",
          table: {
            fields: {
              policy: {
                rule: "ordered",
                order: ["none", "user", "step-up"],
                raised: "compatible",
                lowered: "breaking",
              },
            },
          },
        },
        limits: {
          rule: "nested",
          table: {
            fields: {
              perMinute: { rule: "compatible" },
              perHour: { rule: "compatible" },
              perDay: { rule: "compatible" },
            },
          },
        },
        invalidates: {
          rule: "set",
          added: "compatible",
          removed: "compatible",
        },
      },
    });
  });

  it("is a table of the closed set, frozen and serializable", () => {
    expect(isTable(intentKind.changes)).toBe(true);
    expect(deeplyFrozen(intentKind.changes)).toBe(true);
    expect(JSON.parse(JSON.stringify(intentKind.changes))).toStrictEqual(
      intentKind.changes,
    );
  });

  it("has a row for every field of the spec and every window of limits", () => {
    const result = normalizeFull();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spec = result.model.declarations["trading.orders.place"]
      ?.spec as Record<string, object>;
    const fields = intentKind.changes.fields;
    expect(Object.keys(fields).sort()).toEqual(Object.keys(spec).sort());
    const limits = fields.limits as {
      table: { fields: Record<string, unknown> };
    };
    expect(Object.keys(limits.table.fields).sort()).toEqual(
      ["perDay", "perHour", "perMinute"].sort(),
    );
    expect(Object.keys(spec.limits as object).sort()).toEqual(
      Object.keys(limits.table.fields).sort(),
    );
  });

  it("is accepted by the core where the kind is used", () => {
    const codes = normalizeFull().diagnostics.map((item) => item.code);
    expect(codes).not.toContain("descriptor.invalid-changes");
    expect(codes).toEqual([]);
  });
});
