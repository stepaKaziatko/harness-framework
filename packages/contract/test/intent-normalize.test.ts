import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  defineContract,
  defineIntent,
  normalize,
  type ContractModel,
} from "../src/index.js";
import { defineSourceStub } from "./support/source-stub.js";

const placeOrderParams = z.object({
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().int().min(1).max(10_000),
});

const placeOrderResult = z.object({
  id: z.number(),
  symbol: z.string(),
  totalCents: z.number(),
});

function tradingRoot(intents: readonly unknown[]): unknown {
  return defineContract({
    name: "trading",
    version: "0.1.0",
    permissions: { "orders.place": {} },
    declarations: [
      defineSourceStub({ name: "balance.get" }),
      defineSourceStub({ name: "operations.list" }),
      ...intents,
    ],
  } as never);
}

function modelOf(root: unknown): ContractModel {
  const result = normalize(root);
  expect(result.diagnostics).toEqual([]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("normalize failed");
  return result.model;
}

function specOf(intent: unknown, name: string): unknown {
  return modelOf(tradingRoot([intent])).declarations[name]?.spec;
}

const placeOrder = (invalidates: readonly string[]) =>
  defineIntent({
    name: "orders.place",
    stability: "beta",
    requires: ["orders.place"],
    description: "Place a market order for the selected instrument",
    params: placeOrderParams,
    result: placeOrderResult,
    confirmation: "user",
    limits: { perMinute: 10, perDay: 200 },
    invalidates,
  });

/** The model entry of the full intent of T1, written out by hand. */
const expectedPlaceOrder = {
  description: "Place a market order for the selected instrument",
  kind: "intent",
  requires: ["trading.orders.place"],
  spec: {
    confirmation: { policy: "user" },
    invalidates: ["trading.balance.get", "trading.operations.list"],
    limits: { perDay: 200, perMinute: 10 },
    params: {
      properties: {
        quantity: { maximum: 10000, minimum: 1, type: "integer" },
        side: { enum: ["buy", "sell"], type: "string" },
        symbol: { type: "string" },
      },
      required: ["quantity", "side", "symbol"],
      type: "object",
    },
    result: {
      additionalProperties: false,
      properties: {
        id: { type: "number" },
        symbol: { type: "string" },
        totalCents: { type: "number" },
      },
      required: ["id", "symbol", "totalCents"],
      type: "object",
    },
  },
  stability: "beta",
};

const minimal = {
  name: "session.end",
  requires: ["orders.place"],
  confirmation: "none",
} as const;

const DEFAULT_SPEC = {
  confirmation: { policy: "none" },
  invalidates: [],
  limits: {},
  params: { properties: {}, type: "object" },
  result: {},
};

describe("a full intent (T1)", () => {
  it("normalizes into a model entry without diagnostics", () => {
    const model = modelOf(
      tradingRoot([placeOrder(["operations.list", "balance.get"])]),
    );
    const entry = model.declarations["trading.orders.place"];
    expect(entry).toStrictEqual(expectedPlaceOrder);
    expect(JSON.stringify(entry)).toBe(JSON.stringify(expectedPlaceOrder));
  });

  it("has exactly the five keys of the spec", () => {
    const spec = specOf(
      placeOrder(["balance.get"]),
      "trading.orders.place",
    ) as object;
    expect(Object.keys(spec)).toEqual([
      "confirmation",
      "invalidates",
      "limits",
      "params",
      "result",
    ]);
  });
});

describe("defaults (T2)", () => {
  it("are written into the spec of a minimal intent", () => {
    expect(specOf(defineIntent(minimal), "trading.session.end")).toStrictEqual(
      DEFAULT_SPEC,
    );
  });

  it("give the same JSON when written explicitly or as undefined", () => {
    const expected = JSON.stringify(
      specOf(defineIntent(minimal), "trading.session.end"),
    );
    const explicit = defineIntent({ ...minimal, limits: {}, invalidates: [] });
    const undefinedKeys = defineIntent({
      ...minimal,
      params: undefined,
      result: undefined,
      limits: undefined,
      invalidates: undefined,
      stability: undefined,
      description: undefined,
    });
    const undefinedWindow = defineIntent({
      ...minimal,
      limits: { perMinute: undefined },
    });
    for (const intent of [explicit, undefinedKeys, undefinedWindow]) {
      expect(JSON.stringify(specOf(intent, "trading.session.end"))).toBe(
        expected,
      );
    }
  });

  it("are each written on their own", () => {
    const spec = specOf(defineIntent(minimal), "trading.session.end") as Record<
      string,
      unknown
    >;
    expect(spec.params).toStrictEqual({ properties: {}, type: "object" });
    expect(spec.result).toStrictEqual({});
    expect(spec.limits).toStrictEqual({});
    expect(spec.invalidates).toStrictEqual([]);
  });

  it("keep each of the three policies", () => {
    for (const policy of ["none", "user", "step-up"] as const) {
      const spec = specOf(
        defineIntent({ ...minimal, confirmation: policy }),
        "trading.session.end",
      ) as Record<string, unknown>;
      expect(spec.confirmation).toStrictEqual({ policy });
    }
  });
});

describe("schema directions (T3)", () => {
  const withDefault = z.object({
    symbol: z.string(),
    type: z.string().default("market"),
  });

  it("read params as input and result as output", () => {
    const spec = specOf(
      defineIntent({ ...minimal, params: withDefault, result: withDefault }),
      "trading.session.end",
    ) as Record<string, { required?: unknown }>;
    expect(spec.params?.required).toEqual(["symbol"]);
    expect(spec.result?.required).toEqual(["symbol", "type"]);
  });

  it("accept any object schema as params, a record included", () => {
    const spec = specOf(
      defineIntent({ ...minimal, params: z.record(z.string(), z.number()) }),
      "trading.session.end",
    ) as Record<string, { type?: unknown }>;
    expect(spec.params?.type).toBe("object");
  });

  it("accept a non-object result", () => {
    const spec = specOf(
      defineIntent({ ...minimal, result: z.string() }),
      "trading.session.end",
    ) as Record<string, unknown>;
    expect(spec.result).toStrictEqual({ type: "string" });
  });
});

describe("repeats and order of invalidates (T4)", () => {
  it("give the same spec", () => {
    const sorted = specOf(
      placeOrder(["balance.get", "operations.list"]),
      "trading.orders.place",
    );
    const shuffled = specOf(
      placeOrder(["operations.list", "balance.get", "operations.list"]),
      "trading.orders.place",
    );
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(sorted));
    expect((shuffled as { invalidates: unknown }).invalidates).toEqual([
      "trading.balance.get",
      "trading.operations.list",
    ]);
  });

  it("collapse a repeated name to one", () => {
    const spec = specOf(
      placeOrder(["balance.get", "balance.get"]),
      "trading.orders.place",
    ) as { invalidates: unknown };
    expect(spec.invalidates).toEqual(["trading.balance.get"]);
  });

  it("give one JSON text for two normalizations of one root", () => {
    const root = tradingRoot([placeOrder(["operations.list", "balance.get"])]);
    expect(JSON.stringify(modelOf(root))).toBe(JSON.stringify(modelOf(root)));
  });
});

describe("a model without code (T5)", () => {
  function foreignValues(value: unknown, path = "$"): string[] {
    if (value === null) return [];
    switch (typeof value) {
      case "function":
      case "undefined":
      case "symbol":
      case "bigint":
        return [`${path}: ${typeof value}`];
      case "object":
        return Object.entries(value).flatMap(([key, item]) =>
          foreignValues(item, `${path}.${key}`),
        );
      default:
        return [];
    }
  }

  it("holds only JSON values", () => {
    const model = modelOf(
      tradingRoot([placeOrder(["operations.list", "balance.get"])]),
    );
    expect(foreignValues(model)).toEqual([]);
    expect(JSON.parse(JSON.stringify(model))).toStrictEqual(model);
  });
});
