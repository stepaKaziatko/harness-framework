// An own key `__proto__`, which `JSON.parse` creates as a plain key, is
// refused with the existing diagnostics instead of being lost (ADR 0007).

import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  defineContract,
  defineIntent,
  defineSource,
  normalize,
} from "../src/index.js";
import { compareModels } from "../src/versioning/compare.js";
import { model, type Model } from "./support/compare.js";
import { defineProbe, probe } from "./support/test-kind.js";

const HISTORY = ["declarations", "trading.orders.history", "spec"];

/** The reference model as JSON text, with `entry` put first into a spec. */
function parsedWith(entry: string): unknown {
  const plain = JSON.stringify(model());
  const spec = '"spec":{"level":"low","refs":[],"tags":[]}';
  expect(plain.split(spec)).toHaveLength(2);
  return JSON.parse(
    plain.replace(spec, `"spec":{${entry},"level":"low","refs":[],"tags":[]}`),
  );
}

/** `[code, path]` of each diagnostic. */
function codes(result: { readonly diagnostics: readonly unknown[] }) {
  return (
    result.diagnostics as { code: string; path: readonly (string | number)[] }[]
  ).map((item) => [item.code, item.path]);
}

describe("an own __proto__ key in a compared model", () => {
  it.each([
    ["an object", '"__proto__":{"x":1}'],
    ["a primitive", '"__proto__":1'],
  ])("holding %s is refused on the previous side", (_title, entry) => {
    const previous = parsedWith(entry);
    const spec = (previous as Model).declarations["trading.orders.history"]
      .spec as object;
    expect(Object.keys(spec)).toContain("__proto__");
    const result = compareModels(previous, model(), { kinds: [probe] });
    expect(result.ok).toBe(false);
    expect("changes" in result).toBe(false);
    expect(codes(result)).toEqual([
      ["compare.invalid-model", ["previous", ...HISTORY, "__proto__"]],
    ]);
  });

  it("is refused on the next side", () => {
    const result = compareModels(model(), parsedWith('"__proto__":{"x":1}'), {
      kinds: [probe],
    });
    expect("changes" in result).toBe(false);
    expect(codes(result)).toEqual([
      ["compare.invalid-model", ["next", ...HISTORY, "__proto__"]],
    ]);
  });

  it("is refused at the root of a model", () => {
    const next = JSON.parse(
      JSON.stringify(model()).replace(/^\{/, '{"__proto__":{"x":1},'),
    ) as unknown;
    expect(codes(compareModels(model(), next, { kinds: [probe] }))).toEqual([
      ["compare.invalid-model", ["next", "__proto__"]],
    ]);
  });
});

describe("an own __proto__ key in the input of define*", () => {
  it("is an unknown field of the contract root", () => {
    const root = defineContract(
      JSON.parse('{"__proto__":1,"name":"t","version":"1.0.0"}') as never,
    );
    expect(Object.keys(root)).toContain("__proto__");
    expect(codes(normalize(root))).toEqual([
      ["root.unknown-field", ["__proto__"]],
    ]);
  });

  it("holding an object is an unknown field and does not become the prototype", () => {
    const root = defineContract(
      JSON.parse(
        '{"__proto__":{"name":"evil","declarations":[]},"name":"t","version":"1.0.0"}',
      ) as never,
    );
    expect(Object.getPrototypeOf(root)).toBe(Object.prototype);
    const result = normalize(root);
    expect(codes(result)).toEqual([["root.unknown-field", ["__proto__"]]]);
  });

  it("is an invalid window of intent limits", () => {
    const root = defineContract({
      name: "t",
      version: "1.0.0",
      permissions: { "orders.place": {} },
      declarations: [
        defineIntent({
          name: "orders.place",
          requires: ["orders.place"],
          confirmation: "user",
          limits: JSON.parse('{"__proto__":5}') as never,
        }),
      ],
    });
    expect(codes(normalize(root))).toEqual([
      ["intent.invalid-limit", ["declarations", 0, "limits", "__proto__"]],
    ]);
  });

  it("is an unknown field of a source", () => {
    const input = {
      ...(JSON.parse('{"__proto__":{"intervalMs":1}}') as object),
      name: "quotes.feed",
      result: z.object({ price: z.number() }),
    };
    const root = defineContract({
      name: "t",
      version: "1.0.0",
      declarations: [defineSource(input as never)],
    });
    expect(codes(normalize(root))).toEqual([
      ["source.unknown-field", ["declarations", 0, "__proto__"]],
    ]);
  });
});

describe("an own __proto__ key in the shape of a zod schema", () => {
  it("is kept by zod and refused as unrepresentable", () => {
    const shape: Record<string, z.ZodType> = {};
    Object.defineProperty(shape, "__proto__", {
      value: z.string(),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const schema = z.object(shape);
    expect(Object.keys(schema.shape)).toEqual(["__proto__"]);
    const root = defineContract({
      name: "t",
      version: "1.0.0",
      declarations: [defineProbe({ name: "a", input: schema })],
    });
    expect(codes(normalize(root))).toEqual([
      ["schema.unrepresentable", ["declarations", 0, "input"]],
    ]);
  });
});
