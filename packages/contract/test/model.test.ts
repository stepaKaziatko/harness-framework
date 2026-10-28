import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defineContract, normalize, type ContractModel } from "../src/index.js";
import { coreRoot, coreRootReordered } from "./fixtures/core-root.js";
import { defineProbe } from "./support/test-kind.js";

const expected = JSON.parse(
  readFileSync(new URL("./fixtures/core-model.json", import.meta.url), "utf8"),
) as ContractModel;

function modelOf(root: unknown): ContractModel {
  const result = normalize(root);
  if (!result.ok) {
    throw new Error(
      `expected a model, got ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result.model;
}

/** Every value that is not plain JSON, with its path. */
function nonJsonValues(value: unknown, path = "$"): string[] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return [];
  }
  if (typeof value === "number") return Number.isFinite(value) ? [] : [path];
  if (typeof value !== "object") return [`${path}: ${typeof value}`];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      nonJsonValues(item, `${path}[${index}]`),
    );
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    return [`${path}: prototype`];
  return Object.entries(value).flatMap(([key, item]) =>
    nonJsonValues(item, `${path}.${key}`),
  );
}

describe("the normalized model", () => {
  it("equals the pinned fixture (T1)", () => {
    const model = modelOf(coreRoot);
    expect(model).toEqual(expected);
    expect(JSON.stringify(model)).toBe(JSON.stringify(expected));
  });

  it("is plain JSON without code (T1)", () => {
    const model = modelOf(coreRoot);
    expect(JSON.parse(JSON.stringify(model))).toStrictEqual(model);
    expect(nonJsonValues(model)).toEqual([]);
  });

  it("gives the same text for the same contract in any order (T2)", () => {
    const first = JSON.stringify(modelOf(coreRoot));
    expect(JSON.stringify(modelOf(coreRoot))).toBe(first);
    expect(JSON.stringify(modelOf(coreRootReordered))).toBe(first);
  });

  it("sorts object keys at every level (T2)", () => {
    const model = modelOf(coreRoot);
    const unsorted: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value !== "object" || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      const keys = Object.keys(value);
      if (keys.join("\0") !== [...keys].sort().join("\0")) unsorted.push(path);
      for (const key of keys)
        walk((value as Record<string, unknown>)[key], `${path}.${key}`);
    };
    walk(model, "$");
    expect(unsorted).toEqual([]);
  });

  it("has a format version and the core sections even when empty (T4)", () => {
    const model = modelOf(defineContract({ name: "empty", version: "1.0.0" }));
    expect(model).toStrictEqual({
      contract: { name: "empty", version: "1.0.0" },
      declarations: {},
      formatVersion: 1,
      imports: {},
      permissions: {},
    });
    expect("extensions" in model).toBe(false);
  });

  it("stores qualified names in requires and references (T4)", () => {
    const model = modelOf(coreRoot);
    expect(model.formatVersion).toBe(1);
    expect(Object.keys(model.declarations)).toEqual([
      "trading.orders.history",
      "trading.orders.place",
      "trading.quotes.feed",
    ]);
    expect(model.declarations["trading.quotes.feed"]?.requires).toEqual([
      "trading.quotes.read",
    ]);
    expect(model.declarations["trading.orders.place"]?.spec).toMatchObject({
      refs: ["trading.quotes.feed", "trading.quotes.feed", "auth.users.get"],
    });
    expect(Object.keys(model.permissions)).toEqual([
      "trading.orders.place",
      "trading.quotes.read",
    ]);
  });

  it("drops repeats in requires and subjects and sorts them (T2)", () => {
    const model = modelOf(
      defineContract({
        name: "sets",
        version: "1.0.0",
        permissions: {
          b: { subjects: [{ kind: "end-user" }, { kind: "end-user" }] },
          a: {},
        },
        declarations: [defineProbe({ name: "x", requires: ["b", "a", "b"] })],
      }),
    );
    expect(model.declarations["sets.x"]?.requires).toEqual([
      "sets.a",
      "sets.b",
    ]);
    expect(model.permissions["sets.b"]?.subjects).toEqual([
      { kind: "end-user" },
    ]);
  });
});
