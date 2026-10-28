import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  defineContract,
  defineSource,
  normalize,
  sourceKind,
  type ContractModel,
  type Diagnostic,
  type Source,
  type SourceDiagnosticCode,
  type SourceInput,
  type SourceSpec,
  type SourceSubscription,
} from "../src/index.js";
import {
  History,
  HistoryParams,
  Quote,
  quotesFeed,
  quotesHistory,
  sourceRoot,
  sourceRootReordered,
} from "./fixtures/source-root.js";

const expected = JSON.parse(
  readFileSync(
    new URL("./fixtures/source-model.json", import.meta.url),
    "utf8",
  ),
) as ContractModel;

/** A root with the permission `quotes.read` and the given declarations. */
function rootOf(...declarations: unknown[]): unknown {
  return defineContract({
    name: "trading",
    version: "0.1.0",
    permissions: { "quotes.read": { description: "Read market quotes" } },
    declarations,
  } as never);
}

/** A source built from a loose payload, as a product with a typo would write it. */
function loose(payload: Record<string, unknown>): unknown {
  return defineSource({ name: "s", ...payload } as never);
}

function codesAndPaths(diagnostics: readonly Diagnostic[]) {
  return diagnostics.map((item) => [item.code, item.path]);
}

/** Normalizes one source and returns the full list of `[code, path]` pairs. */
function failures(source: unknown): unknown {
  const result = normalize(rootOf(source));
  expect(result.ok).toBe(false);
  // The kind must never be blamed for its own failure.
  expect(
    result.diagnostics.filter((item) => item.code.startsWith("descriptor.")),
  ).toEqual([]);
  return codesAndPaths(result.diagnostics);
}

function specOf(source: unknown, name = "trading.s"): SourceSpec {
  const result = normalize(rootOf(source));
  if (!result.ok) {
    throw new Error(
      `expected a model, got ${JSON.stringify(result.diagnostics)}`,
    );
  }
  const declaration = result.model.declarations[name];
  if (declaration === undefined) throw new Error(`no declaration ${name}`);
  return declaration.spec as unknown as SourceSpec;
}

function modelOf(root: unknown): ContractModel {
  const result = normalize(root);
  if (!result.ok) {
    throw new Error(
      `expected a model, got ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result.model;
}

const Anything = z.object({ a: z.string() });
const at = (...path: (string | number)[]) => ["declarations", 0, ...path];

describe("the entry point and the types (A1, A2, A3, A4)", () => {
  it("exposes defineSource and the descriptor sourceKind", () => {
    expect(defineSource).toBeTypeOf("function");
    expect(sourceKind.kind).toBe("source");
  });

  it("exports the types of the kind (A2)", () => {
    expectTypeOf<SourceDiagnosticCode>().toEqualTypeOf<
      | "source.unknown-field"
      | "source.missing-result"
      | "source.params-not-object"
      | "source.invalid-subscription"
      | "source.interval-out-of-range"
    >();
    // @ts-expect-error a code that the kind does not have
    const other: SourceDiagnosticCode = "source.other";
    expect(other).toBe("source.other");
    expectTypeOf<SourceSubscription>().toEqualTypeOf<{
      readonly intervalMs: number;
    }>();
    expectTypeOf<SourceSpec["subscription"]>().toEqualTypeOf<
      SourceSubscription | undefined
    >();
    // The input of `defineSource` is a public type of the entry point.
    const input: SourceInput<typeof HistoryParams, typeof History> = {
      name: "history",
      params: HistoryParams,
      result: History,
    };
    expectTypeOf(input.result).toEqualTypeOf<typeof History>();
    expectTypeOf(defineSource<typeof HistoryParams, typeof History>)
      .parameter(0)
      .toEqualTypeOf<SourceInput<typeof HistoryParams, typeof History>>();
    expect(defineSource(input)).toMatchObject({
      kind: "source",
      name: "history",
    });
  });

  it("keeps the types of the schemas in the declaration (A4)", () => {
    expectTypeOf(quotesHistory.params).toEqualTypeOf<
      typeof HistoryParams | undefined
    >();
    expectTypeOf(quotesHistory.result).toEqualTypeOf<typeof History>();
    expectTypeOf(quotesFeed.result).toEqualTypeOf<z.ZodArray<typeof Quote>>();
    expectTypeOf(quotesHistory).toExtend<
      Source<typeof HistoryParams, typeof History>
    >();
    // @ts-expect-error the result of the history is not the result of the feed
    const wrong: typeof quotesFeed.result = quotesHistory.result;
    expect(wrong).toBe(History);
  });

  it("creates a frozen declaration of kind source and never throws (A3)", () => {
    const source = defineSource({ name: "a", result: z.string() });
    expect(source.kind).toBe("source");
    expect(Object.isFrozen(source)).toBe(true);
    expect(() => defineSource({} as never)).not.toThrow();
    expect(() => defineSource(null as never)).not.toThrow();
    expect(() => defineSource({ name: "x", result: 5 } as never)).not.toThrow();
    for (const bad of [
      {} as never,
      { name: "x", result: 5 } as never,
      { name: "x", result: z.string(), subscription: 5 } as never,
    ]) {
      const result = normalize(rootOf(defineSource(bad)));
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});

describe("normalization (N1 to N6)", () => {
  it("equals the pinned fixture (N1)", () => {
    const model = modelOf(sourceRoot);
    expect(model).toEqual(expected);
    expect(JSON.stringify(model)).toBe(JSON.stringify(expected));
    expect(Object.keys(model.declarations)).toEqual([
      "trading.quotes.feed",
      "trading.quotes.history",
    ]);
    const feed = model.declarations["trading.quotes.feed"];
    const history = model.declarations["trading.quotes.history"];
    expect(feed).toMatchObject({
      kind: "source",
      requires: ["trading.quotes.read"],
      stability: "beta",
      description: "Latest quotes of all instruments",
    });
    expect(history).toMatchObject({
      kind: "source",
      requires: ["trading.quotes.read"],
      stability: "internal",
    });
    expect((feed?.spec as unknown as SourceSpec).subscription).toEqual({
      intervalMs: 1000,
    });
  });

  it("writes no subscription key for a source without one (N2)", () => {
    const model = modelOf(sourceRoot);
    const spec = (name: string) =>
      model.declarations[name]?.spec as unknown as SourceSpec;
    expect(Object.keys(spec("trading.quotes.history")).sort()).toEqual([
      "params",
      "result",
    ]);
    expect(Object.keys(spec("trading.quotes.feed")).sort()).toEqual([
      "params",
      "result",
      "subscription",
    ]);
    expect(Object.keys(spec("trading.quotes.feed").subscription!)).toEqual([
      "intervalMs",
    ]);
    const explicit = specOf(
      defineSource({
        name: "s",
        result: z.string(),
        subscription: undefined,
      }),
    );
    expect(Object.keys(explicit).sort()).toEqual(["params", "result"]);
  });

  it("converts params as input and result as output (N3)", () => {
    const history = modelOf(sourceRoot).declarations["trading.quotes.history"]
      ?.spec as unknown as SourceSpec;
    expect(history.params.required).toEqual(["symbol"]);
    expect(history.params.properties).toMatchObject({
      limit: { default: 120 },
    });
    const output = specOf(
      defineSource({
        name: "s",
        result: z.object({ a: z.string().default("x") }),
      }),
    );
    expect(output.result.required).toEqual(["a"]);
    expect(output.result.additionalProperties).toBe(false);
    // A transform is fine in the input direction and not in the output one.
    expect(
      specOf(
        defineSource({
          name: "s",
          params: z.object({ s: z.string().transform(Number) }),
          result: z.string(),
        }),
      ).params.properties,
    ).toEqual({ s: { type: "string" } });
    expect(
      failures(
        defineSource({
          name: "s",
          result: z.object({ s: z.string().transform(Number) }),
        }),
      ),
    ).toEqual([["schema.unrepresentable", at("result")]]);
  });

  it("writes the same empty parameters however they are omitted (N4)", () => {
    const empty = { properties: {}, type: "object" };
    const omitted = specOf(defineSource({ name: "s", result: z.string() }));
    const undefinedParams = specOf(
      defineSource({ name: "s", params: undefined, result: z.string() }),
    );
    const explicit = specOf(
      defineSource({ name: "s", params: z.object({}), result: z.string() }),
    );
    expect(omitted.params).toEqual(empty);
    expect(undefinedParams.params).toEqual(empty);
    expect(explicit.params).toEqual(empty);
    expect(omitted.params).toEqual(explicit.params);
  });

  it("is plain JSON and does not depend on the order of declarations (N5)", () => {
    const model = modelOf(sourceRoot);
    expect(JSON.parse(JSON.stringify(model))).toStrictEqual(model);
    const text = JSON.stringify(model);
    expect(JSON.stringify(modelOf(sourceRoot))).toBe(text);
    expect(JSON.stringify(modelOf(sourceRootReordered))).toBe(text);
  });

  it("keeps the error of one source from hiding another (N6)", () => {
    const result = normalize(
      rootOf(
        loose({
          name: "a",
          result: z.string(),
          subscription: { intervalMs: 50 },
        }),
        loose({ name: "b", result: z.string(), permisions: ["quotes.read"] }),
      ),
    );
    expect(result.ok).toBe(false);
    expect(codesAndPaths(result.diagnostics)).toEqual([
      [
        "source.interval-out-of-range",
        ["declarations", 0, "subscription", "intervalMs"],
      ],
      ["source.unknown-field", ["declarations", 1, "permisions"]],
    ]);
  });

  it("accepts a source with every field of the envelope", () => {
    expect(
      normalize(
        rootOf(
          defineSource({
            name: "full",
            description: "d",
            stability: "public",
            requires: ["quotes.read"],
            params: z.object({}),
            result: z.string(),
            subscription: { intervalMs: 5000 },
          }),
        ),
      ).ok,
    ).toBe(true);
  });
});

describe("diagnostics of the kind (D1 to D9)", () => {
  it("reports unknown fields in the order of the input (D1)", () => {
    expect(
      failures(loose({ result: Anything, permisions: [], interval: 1000 })),
    ).toEqual([
      ["source.unknown-field", at("permisions")],
      ["source.unknown-field", at("interval")],
    ]);
  });

  it("reports a missing result (D2)", () => {
    expect(failures(loose({}))).toEqual([["source.missing-result", at()]]);
    expect(failures(loose({ result: undefined }))).toEqual([
      ["source.missing-result", at()],
    ]);
  });

  it.each([
    ["a string", z.string()],
    ["an array", z.array(z.string())],
    [
      "a union of objects",
      z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
    ],
    ["a nullable object", z.object({ a: z.string() }).nullable()],
  ])("rejects parameters that are %s (D3)", (_, params) => {
    expect(failures(loose({ params, result: Anything }))).toEqual([
      ["source.params-not-object", at("params")],
    ]);
  });

  it.each([
    ["a record", z.record(z.string(), z.number())],
    ["a strict object", z.strictObject({ a: z.string() })],
    ["an optional object", z.object({ a: z.string() }).optional()],
  ])("accepts parameters that are %s (D3)", (_, params) => {
    expect(normalize(rootOf(loose({ params, result: Anything }))).ok).toBe(
      true,
    );
  });

  it.each([
    ["a number", 1000],
    ["null", null],
    ["an array", []],
    ["a string", "fast"],
  ])("rejects a subscription that is %s (D4)", (_, subscription) => {
    expect(failures(loose({ result: Anything, subscription }))).toEqual([
      ["source.invalid-subscription", at("subscription")],
    ]);
  });

  it("rejects a subscription without intervalMs (D4)", () => {
    expect(failures(loose({ result: Anything, subscription: {} }))).toEqual([
      ["source.invalid-subscription", at("subscription")],
    ]);
    expect(
      failures(
        loose({ result: Anything, subscription: { intervalMs: undefined } }),
      ),
    ).toEqual([["source.invalid-subscription", at("subscription")]]);
  });

  it("reports an unknown key and a missing intervalMs together (D4)", () => {
    const found = normalize(
      rootOf(loose({ result: Anything, subscription: { mode: "delta" } })),
    );
    expect(found.ok).toBe(false);
    expect(found.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual(
      [
        {
          code: "source.invalid-subscription",
          path: ["declarations", 0, "subscription", "mode"],
        },
        {
          code: "source.invalid-subscription",
          path: ["declarations", 0, "subscription"],
        },
      ],
    );
  });

  it("rejects an unknown key of a subscription (D4)", () => {
    expect(
      failures(
        loose({
          result: Anything,
          subscription: { intervalMs: 1000, mode: "delta" },
        }),
      ),
    ).toEqual([["source.invalid-subscription", at("subscription", "mode")]]);
  });

  it.each([
    ["fractional", 1000.5],
    ["a string", "1000"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
  ])("rejects an interval that is %s (D4)", (_, intervalMs) => {
    expect(
      failures(loose({ result: Anything, subscription: { intervalMs } })),
    ).toEqual([
      ["source.invalid-subscription", at("subscription", "intervalMs")],
    ]);
  });

  it.each([99, 0, -1000, 3_600_001])(
    "rejects the interval %s as out of range (D5)",
    (intervalMs) => {
      expect(
        failures(loose({ result: Anything, subscription: { intervalMs } })),
      ).toEqual([
        ["source.interval-out-of-range", at("subscription", "intervalMs")],
      ]);
    },
  );

  it.each([100, 3_600_000])(
    "accepts the interval %s and writes it as it is (D5)",
    (intervalMs) => {
      expect(
        specOf(loose({ result: Anything, subscription: { intervalMs } }))
          .subscription,
      ).toEqual({ intervalMs });
    },
  );

  it("reports a schema that cannot be JSON Schema (D6)", () => {
    expect(failures(loose({ result: z.date() }))).toEqual([
      ["schema.unrepresentable", at("result")],
    ]);
    expect(failures(loose({ result: z.string().transform(Number) }))).toEqual([
      ["schema.unrepresentable", at("result")],
    ]);
    expect(
      failures(loose({ params: z.object({ at: z.date() }), result: Anything })),
    ).toEqual([["schema.unrepresentable", at("params")]]);
  });

  it("reports a value that is not a zod schema (D7)", () => {
    expect(failures(loose({ result: "string" }))).toEqual([
      ["schema.invalid", at("result")],
    ]);
    expect(failures(loose({ result: {} }))).toEqual([
      ["schema.invalid", at("result")],
    ]);
    expect(failures(loose({ params: 5, result: Anything }))).toEqual([
      ["schema.invalid", at("params")],
    ]);
    expect(failures(loose({ params: null, result: Anything }))).toEqual([
      ["schema.invalid", at("params")],
    ]);
  });

  it("leaves requires to the core (D8)", () => {
    expect(
      failures(
        defineSource({
          name: "s",
          result: Anything,
          requires: ["quotes.write"],
        }),
      ),
    ).toEqual([["permission.unknown", at("requires", 0)]]);
  });

  it("reports in a fixed order (D9)", () => {
    const source = defineSource({
      name: "s",
      zzz: 1,
      aaa: 2,
      params: z.string(),
      subscription: { intervalMs: 50 },
    } as never);
    expect(failures(source)).toEqual([
      ["source.unknown-field", at("zzz")],
      ["source.unknown-field", at("aaa")],
      ["source.params-not-object", at("params")],
      ["source.missing-result", at()],
      ["source.interval-out-of-range", at("subscription", "intervalMs")],
    ]);
  });
});

describe("the catalog of codes (D10)", () => {
  const CODES: SourceDiagnosticCode[] = [
    "source.unknown-field",
    "source.missing-result",
    "source.params-not-object",
    "source.invalid-subscription",
    "source.interval-out-of-range",
  ];

  /** A declaration that produces each code; a new code needs a new entry. */
  const CASES: Record<SourceDiagnosticCode, unknown> = {
    "source.unknown-field": loose({ result: Anything, extra: 1 }),
    "source.missing-result": loose({}),
    "source.params-not-object": loose({ params: z.string(), result: Anything }),
    "source.invalid-subscription": loose({ result: Anything, subscription: 1 }),
    "source.interval-out-of-range": loose({
      result: Anything,
      subscription: { intervalMs: 1 },
    }),
  };

  it("has exactly the five codes, all errors with their own prefix", () => {
    expect(Object.keys(sourceKind.diagnostics).sort()).toEqual(
      [...CODES].sort(),
    );
    for (const [code, info] of Object.entries(sourceKind.diagnostics)) {
      expect(code.startsWith("source.")).toBe(true);
      expect(info.severity).toBe("error");
      expect(info.summary.length).toBeGreaterThan(0);
    }
  });

  it("has a case in this file for every code", () => {
    expect(Object.keys(CASES).sort()).toEqual(
      Object.keys(sourceKind.diagnostics).sort(),
    );
    for (const code of CODES) {
      const result = normalize(rootOf(CASES[code]));
      expect(result.diagnostics.map((item) => item.code)).toContain(code);
    }
  });
});

describe("the change table and the registration (C1 to C3)", () => {
  it("is the table of the design, with the known limitation (C1)", () => {
    expect(sourceKind.changes).toStrictEqual({
      fields: {
        params: { rule: "schema", direction: "input" },
        result: { rule: "schema", direction: "output" },
        subscription: {
          rule: "nested",
          table: { fields: { intervalMs: { rule: "breaking" } } },
        },
      },
    });
    // Known limitation (HAF-25): the subscription has no presence class and
    // intervalMs no direction, so every change of it is breaking.
    const subscription = sourceKind.changes.fields.subscription;
    expect(subscription).toMatchObject({ rule: "nested" });
    expect(sourceKind.changes.entry).toBeUndefined();
  });

  it("is accepted by the core without a descriptor problem (C2)", () => {
    const result = normalize(sourceRoot);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("has a rule for every key that normalize writes (C3)", () => {
    const model = modelOf(sourceRoot);
    const fields = sourceKind.changes.fields;
    for (const declaration of Object.values(model.declarations)) {
      const spec = declaration.spec as unknown as Record<string, unknown>;
      for (const key of Object.keys(spec)) {
        expect(Object.keys(fields)).toContain(key);
      }
    }
    const feed = model.declarations["trading.quotes.feed"]
      ?.spec as unknown as SourceSpec;
    const rule = fields.subscription;
    if (rule?.rule !== "nested" || typeof rule.table !== "object") {
      throw new Error("subscription must be a nested rule");
    }
    for (const key of Object.keys(feed.subscription ?? {})) {
      expect(Object.keys(rule.table.fields)).toContain(key);
    }
    expect(Object.keys(feed.subscription ?? {}).length).toBeGreaterThan(0);
  });
});
