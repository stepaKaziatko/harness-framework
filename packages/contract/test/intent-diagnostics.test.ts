import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  defineContract,
  defineIntent,
  defineSource,
  type Diagnostic,
  diagnosticCodes,
  intentKind,
  normalize,
} from "../src/index.js";

/** A source of the contract: an intent sees only its name and kind. */
const sourceNamed = (name: string) =>
  defineSource({ name, result: z.object({}) });

/** Index of the intent under test in `declarations` of {@link rootWith}. */
const INTENT = 2;
const D = ["declarations", INTENT] as const;

function rootWith(
  intent: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): unknown {
  return defineContract({
    name: "trading",
    version: "0.1.0",
    permissions: { "orders.place": {} },
    declarations: [
      sourceNamed("balance.get"),
      sourceNamed("operations.list"),
      defineIntent(intent as never),
    ],
    ...extra,
  } as never);
}

const base = {
  name: "orders.place",
  requires: ["orders.place"],
  confirmation: "user",
};

function without(key: keyof typeof base): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(base).filter(([field]) => field !== key),
  );
}

function severityOf(code: string): unknown {
  const kindCatalog = intentKind.diagnostics as Record<
    string,
    { severity: string }
  >;
  const coreCatalog = diagnosticCodes as Record<string, { severity: string }>;
  return (kindCatalog[code] ?? coreCatalog[code])?.severity;
}

/** Normalizes without throwing and returns `[code, path]` of each diagnostic. */
function check(root: unknown): [string, readonly (string | number)[]][] {
  let result: ReturnType<typeof normalize> | undefined;
  expect(() => {
    result = normalize(root);
  }).not.toThrow();
  const outcome = result as ReturnType<typeof normalize>;
  for (const item of outcome.diagnostics as Diagnostic[]) {
    expect(item.severity).toBe(severityOf(item.code));
    expect(item.message).not.toBe("");
  }
  if (outcome.diagnostics.length > 0) expect(outcome.ok).toBe(false);
  return outcome.diagnostics.map((item) => [item.code, item.path]);
}

function diagnose(fields: Record<string, unknown>) {
  return check(rootWith({ ...base, ...fields }));
}

describe("a closed set of keys (T7)", () => {
  it("refuses a handler", () => {
    expect(diagnose({ handler: () => ({}) })).toEqual([
      ["intent.unknown-field", [...D, "handler"]],
    ]);
  });

  it("refuses a handler whose value is undefined", () => {
    // `undefined` counts as absent only for the fields an intent declares.
    expect(diagnose({ handler: undefined })).toEqual([
      ["intent.unknown-field", [...D, "handler"]],
    ]);
  });

  it("refuses the typo confirm next to confirmation", () => {
    expect(diagnose({ confirm: "user" })).toEqual([
      ["intent.unknown-field", [...D, "confirm"]],
    ]);
  });

  it("reports each unknown key", () => {
    expect(diagnose({ execute: "x", retries: 3 })).toEqual([
      ["intent.unknown-field", [...D, "execute"]],
      ["intent.unknown-field", [...D, "retries"]],
    ]);
  });

  it("accepts every key of the envelope and the payload", () => {
    expect(
      diagnose({
        kind: "intent",
        stability: "public",
        description: "Place an order",
        params: z.object({ symbol: z.string() }),
        result: z.object({ id: z.number() }),
        limits: { perMinute: 1 },
        invalidates: ["balance.get"],
      }),
    ).toEqual([]);
  });
});

describe("params and result (T8)", () => {
  it("refuses params that are a string schema", () => {
    expect(diagnose({ params: z.string() })).toEqual([
      ["intent.params-not-object", [...D, "params"]],
    ]);
  });

  it("refuses params that are a union of objects", () => {
    expect(
      diagnose({
        params: z.union([
          z.object({ a: z.string() }),
          z.object({ b: z.string() }),
        ]),
      }),
    ).toEqual([["intent.params-not-object", [...D, "params"]]]);
  });

  it("reports only schema.unrepresentable for unrepresentable params", () => {
    expect(diagnose({ params: z.date() })).toEqual([
      ["schema.unrepresentable", [...D, "params"]],
    ]);
  });

  it("reports only schema.invalid for params that are not a schema", () => {
    expect(diagnose({ params: "x" })).toEqual([
      ["schema.invalid", [...D, "params"]],
    ]);
  });

  it("reports schema.unrepresentable for an unrepresentable result", () => {
    expect(diagnose({ result: z.date() })).toEqual([
      ["schema.unrepresentable", [...D, "result"]],
    ]);
  });

  it("accepts a result that is not an object", () => {
    expect(diagnose({ result: z.string() })).toEqual([]);
  });
});

describe("confirmation (T9)", () => {
  it("has no default", () => {
    expect(check(rootWith(without("confirmation")))).toEqual([
      ["intent.missing-confirmation", [...D, "confirmation"]],
    ]);
  });

  it("treats confirmation: undefined as missing", () => {
    expect(diagnose({ confirmation: undefined })).toEqual([
      ["intent.missing-confirmation", [...D, "confirmation"]],
    ]);
  });

  it.each([["always"], [true], [{ policy: "user" }], [""]])(
    "refuses %j",
    (confirmation) => {
      expect(diagnose({ confirmation })).toEqual([
        ["intent.unknown-confirmation", [...D, "confirmation"]],
      ]);
    },
  );

  it.each([["none"], ["user"], ["step-up"]])("accepts %s", (confirmation) => {
    expect(diagnose({ confirmation })).toEqual([]);
  });
});

describe("limits, one check per case (T10)", () => {
  const at = (window?: string) =>
    window === undefined ? [...D, "limits"] : [...D, "limits", window];

  it.each([[5], [[1]], ["10"], [null]])("refuses limits: %j", (limits) => {
    expect(diagnose({ limits })).toEqual([["intent.invalid-limit", at()]]);
  });

  it("refuses an unknown window", () => {
    expect(diagnose({ limits: { perWeek: 1 } })).toEqual([
      ["intent.invalid-limit", at("perWeek")],
    ]);
  });

  it.each([
    ["a fraction", 1.5],
    ["zero", 0],
    ["a negative number", -1],
    ["an unsafe integer", 2 ** 53],
    ["a string", "10"],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("refuses %s", (_label, perMinute) => {
    expect(diagnose({ limits: { perMinute } })).toEqual([
      ["intent.invalid-limit", at("perMinute")],
    ]);
  });

  it("refuses a minute bound above the hour bound", () => {
    expect(diagnose({ limits: { perMinute: 100, perHour: 50 } })).toEqual([
      ["intent.invalid-limit", at("perMinute")],
    ]);
  });

  it("refuses an hour bound above the day bound", () => {
    expect(diagnose({ limits: { perHour: 100, perDay: 50 } })).toEqual([
      ["intent.invalid-limit", at("perHour")],
    ]);
  });

  it("compares the minute with the day when the hour is absent", () => {
    expect(diagnose({ limits: { perMinute: 100, perDay: 50 } })).toEqual([
      ["intent.invalid-limit", at("perMinute")],
    ]);
  });

  it("reports each pair out of order", () => {
    expect(
      diagnose({ limits: { perMinute: 100, perHour: 50, perDay: 20 } }),
    ).toEqual([
      ["intent.invalid-limit", at("perMinute")],
      ["intent.invalid-limit", at("perHour")],
    ]);
  });

  it("skips an invalid window when it compares the others", () => {
    expect(
      diagnose({ limits: { perMinute: 100, perHour: 0, perDay: 50 } }),
    ).toEqual([
      ["intent.invalid-limit", at("perHour")],
      ["intent.invalid-limit", at("perMinute")],
    ]);
  });

  it.each([
    [{ perMinute: 1 }],
    [{ perMinute: 10, perHour: 10, perDay: 10 }],
    [{ perDay: Number.MAX_SAFE_INTEGER }],
    [{ perMinute: 1, perHour: 60, perDay: 1440 }],
  ])("accepts %j", (limits) => {
    expect(diagnose({ limits })).toEqual([]);
  });
});

describe("requires (T11)", () => {
  it("is required", () => {
    expect(check(rootWith(without("requires")))).toEqual([
      ["intent.missing-requires", [...D, "requires"]],
    ]);
  });

  it("may not be empty", () => {
    expect(diagnose({ requires: [] })).toEqual([
      ["intent.missing-requires", [...D, "requires"]],
    ]);
  });

  it("is checked for existence by the core, which then does not run the kind", () => {
    expect(diagnose({ requires: ["nope"], confirmation: "always" })).toEqual([
      ["permission.unknown", [...D, "requires", 0]],
    ]);
  });
});

describe("invalidates (T12)", () => {
  it("must be an array", () => {
    expect(diagnose({ invalidates: "balance.get" })).toEqual([
      ["intent.invalid-invalidates", [...D, "invalidates"]],
    ]);
  });

  it("must hold strings", () => {
    expect(diagnose({ invalidates: ["balance.get", 42] })).toEqual([
      ["intent.invalid-invalidates", [...D, "invalidates", 1]],
    ]);
  });

  it("refuses an undeclared source", () => {
    expect(diagnose({ invalidates: ["missing.source"] })).toEqual([
      ["reference.unknown", [...D, "invalidates", 0]],
    ]);
  });

  it("refuses another intent", () => {
    const root = defineContract({
      name: "trading",
      version: "0.1.0",
      permissions: { "orders.place": {} },
      declarations: [
        sourceNamed("balance.get"),
        defineIntent({ ...base, name: "orders.cancel" } as never),
        defineIntent({ ...base, invalidates: ["orders.cancel"] } as never),
      ],
    } as never);
    expect(check(root)).toEqual([
      ["reference.kind-mismatch", [...D, "invalidates", 0]],
    ]);
  });

  it("refuses the intent itself", () => {
    expect(diagnose({ invalidates: ["orders.place"] })).toEqual([
      ["reference.kind-mismatch", [...D, "invalidates", 0]],
    ]);
  });

  it("refuses a name that is not a path", () => {
    expect(diagnose({ invalidates: ["Bad Name"] })).toEqual([
      ["reference.invalid", [...D, "invalidates", 0]],
    ]);
  });

  it("refuses a source of an import", () => {
    const root = rootWith(
      { ...base, invalidates: ["auth.users.get"] },
      { imports: [{ contract: "auth", range: "^1.4.0" }] },
    );
    expect(check(root)).toEqual([
      ["intent.foreign-invalidates", [...D, "invalidates", 0]],
    ]);
  });

  it("refuses a source of an import whose name starts with its own", () => {
    const root = rootWith(
      { ...base, invalidates: ["tradingx.quotes.feed"] },
      { imports: [{ contract: "tradingx", range: "^1.0.0" }] },
    );
    expect(check(root)).toEqual([
      ["intent.foreign-invalidates", [...D, "invalidates", 0]],
    ]);
  });

  it("accepts sources of its own contract", () => {
    expect(
      diagnose({ invalidates: ["operations.list", "balance.get"] }),
    ).toEqual([]);
  });
});

describe("every problem in one pass (T13)", () => {
  const broken = {
    name: "orders.place",
    handler: "x",
    limits: { perMinute: 0 },
    invalidates: [42],
  };

  const expected = [
    ["intent.unknown-field", [...D, "handler"]],
    ["intent.missing-requires", [...D, "requires"]],
    ["intent.missing-confirmation", [...D, "confirmation"]],
    ["intent.invalid-limit", [...D, "limits", "perMinute"]],
    ["intent.invalid-invalidates", [...D, "invalidates", 0]],
  ];

  it("reports five problems of one intent in a fixed order", () => {
    expect(check(rootWith(broken))).toEqual(expected);
    expect(check(rootWith(broken))).toEqual(expected);
  });

  it("checks a second intent after a broken one", () => {
    const root = defineContract({
      name: "trading",
      version: "0.1.0",
      permissions: { "orders.place": {} },
      declarations: [
        sourceNamed("balance.get"),
        defineIntent({ ...base, name: "a", confirmation: "always" } as never),
        defineIntent({ ...base, name: "b", limits: { perDay: 0 } } as never),
      ],
    } as never);
    expect(check(root)).toEqual([
      ["intent.unknown-confirmation", ["declarations", 1, "confirmation"]],
      ["intent.invalid-limit", ["declarations", 2, "limits", "perDay"]],
    ]);
  });
});
