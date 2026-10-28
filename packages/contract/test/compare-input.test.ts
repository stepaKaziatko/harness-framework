import { describe, expect, it } from "vitest";
import {
  compareModels as compareFromEntry,
  defineDeclarationKind,
  type ChangeTable,
  type ComparisonResult,
} from "../src/index.js";
import {
  compareModels,
  type CompareOptions,
} from "../src/versioning/compare.js";
import { isTable } from "../src/core/changes.js";
import { edited, model, type Model } from "./support/compare.js";
import { probe } from "./support/test-kind.js";
import { layout } from "./support/test-extension.js";

describe("comparing a model with itself (C1)", () => {
  it("finds no changes in a deep copy", () => {
    expect(compareModels(model(), model())).toEqual({
      ok: true,
      changes: [],
      requiredBump: "none",
      diagnostics: [],
    });
  });

  it("finds no changes when only the version differs", () => {
    const next = edited((m) => {
      m.contract.version = "0.2.0";
    });
    expect(
      compareModels(model(), next, { kinds: [probe], extensions: [layout] }),
    ).toEqual({ ok: true, changes: [], requiredBump: "none", diagnostics: [] });
  });
});

const cycle = (): Model => {
  const m = model();
  m.declarations["trading.orders.history"].spec.self = m;
  return m;
};

const throwingGetter = (): Model => {
  const m = model();
  Object.defineProperty(m.contract, "name", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  return m;
};

/** Values that are not readable models, with the code they are refused with. */
const unreadable: [string, () => unknown, string][] = [
  ["null", () => null, "compare.invalid-model"],
  ["a number", () => 42, "compare.invalid-model"],
  ["a string", () => "x", "compare.invalid-model"],
  ["an array", () => [], "compare.invalid-model"],
  ["an empty object", () => ({}), "compare.invalid-model"],
  [
    "a function value",
    () =>
      edited((m) => {
        m.declarations["trading.orders.history"].spec.run = () => 1;
      }),
    "compare.invalid-model",
  ],
  ["a cycle", cycle, "compare.invalid-model"],
  [
    "a bigint",
    () =>
      edited((m) => {
        m.declarations["trading.orders.history"].spec.big = 1n;
      }),
    "compare.invalid-model",
  ],
  ["a getter that throws", throwingGetter, "compare.invalid-model"],
  [
    "no formatVersion",
    () =>
      edited((m) => {
        delete m.formatVersion;
      }),
    "compare.unsupported-format",
  ],
  [
    'formatVersion "1"',
    () =>
      edited((m) => {
        m.formatVersion = "1";
      }),
    "compare.unsupported-format",
  ],
  [
    "formatVersion 2",
    () =>
      edited((m) => {
        m.formatVersion = 2;
      }),
    "compare.unsupported-format",
  ],
  [
    'contract.version "1.0"',
    () =>
      edited((m) => {
        m.contract.version = "1.0";
      }),
    "compare.invalid-model",
  ],
  [
    "declarations as an array",
    () =>
      edited((m) => {
        m.declarations = [];
      }),
    "compare.invalid-model",
  ],
  [
    "a declaration without a string kind",
    () =>
      edited((m) => {
        m.declarations["trading.orders.history"].kind = 1;
      }),
    "compare.invalid-model",
  ],
  [
    "extensions as an array",
    () =>
      edited((m) => {
        m.extensions = [];
      }),
    "compare.invalid-model",
  ],
];

describe("models that cannot be read (C2)", () => {
  describe.each(["previous", "next"] as const)("as %s", (side) => {
    it.each(unreadable)("refuses %s", (_title, value, code) => {
      const pair =
        side === "previous" ? [value(), model()] : [model(), value()];
      let result: ReturnType<typeof compareModels> | undefined;
      expect(() => {
        result = compareModels(pair[0], pair[1]);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      expect(result?.diagnostics[0]).toMatchObject({ code, severity: "error" });
      expect(result?.diagnostics[0]?.path[0]).toBe(side);
      expect("changes" in result!).toBe(false);
      expect("requiredBump" in result!).toBe(false);
    });
  });

  it("points at the field that breaks the shape", () => {
    const next = edited((m) => {
      m.contract.version = "1.0";
      m.declarations["trading.orders.history"].kind = 1;
    });
    expect(compareModels(model(), next)).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compare.invalid-model",
          severity: "error",
          path: ["next", "contract", "version"],
          message: expect.any(String),
        },
        {
          code: "compare.invalid-model",
          severity: "error",
          path: ["next", "declarations", "trading.orders.history", "kind"],
          message: expect.any(String),
        },
      ],
    });
  });

  it("reports a format it does not know without looking at the shape", () => {
    expect(compareModels({ formatVersion: 2 }, model())).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compare.unsupported-format",
          severity: "error",
          path: ["previous", "formatVersion"],
          message: expect.any(String),
        },
      ],
    });
  });

  it("reports both models", () => {
    const result = compareModels(null, 42);
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["compare.invalid-model", ["previous"]],
      ["compare.invalid-model", ["next"]],
    ]);
  });

  it("gives the path of a value that is not JSON", () => {
    const next = edited((m) => {
      m.declarations["trading.orders.history"].spec.run = () => 1;
    });
    expect(compareModels(model(), next).diagnostics[0]?.path).toEqual([
      "next",
      "declarations",
      "trading.orders.history",
      "spec",
      "run",
    ]);
  });
});

/** Shapes that R3 refuses, with the path of the field that breaks them. */
const misshapen: [string, (m: Model) => void, (string | number)[]][] = [
  [
    "a contract name that is not a segment",
    (m) => {
      m.contract.name = "Trading Desk";
    },
    ["contract", "name"],
  ],
  [
    "imports as an array",
    (m) => {
      m.imports = [];
    },
    ["imports"],
  ],
  [
    "permissions as an array",
    (m) => {
      m.permissions = [];
    },
    ["permissions"],
  ],
  [
    "a declaration that is not an object",
    (m) => {
      m.declarations["trading.orders.history"] = 1;
    },
    ["declarations", "trading.orders.history"],
  ],
];

describe("the shape of a model (R3)", () => {
  describe.each(["previous", "next"] as const)("as %s", (side) => {
    it.each(misshapen)("refuses %s", (_title, edit, path) => {
      const broken = edited(edit);
      const result =
        side === "previous"
          ? compareModels(broken, model(), { kinds: [probe] })
          : compareModels(model(), broken, { kinds: [probe] });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toEqual({
        code: "compare.invalid-model",
        severity: "error",
        path: [side, ...path],
        message: expect.any(String),
      });
      expect("changes" in result).toBe(false);
      expect("requiredBump" in result).toBe(false);
    });
  });
});

const rogueTable = {
  fields: { a: { rule: "sometimes" } },
} as unknown as ChangeTable;
const kindLabelTable = {
  fields: { a: { rule: "nested", table: "kind" } },
} as unknown as ChangeTable;
const extensionLabelTable = {
  fields: { a: { rule: "nested", table: "extension" } },
} as unknown as ChangeTable;

describe("the tables of the options (C3)", () => {
  const failing: [string, unknown, string, (string | number)[]][] = [
    [
      "a table outside the closed set",
      { kinds: [{ kind: "probe", changes: rogueTable }] },
      "compare.invalid-table",
      ["kinds", 0],
    ],
    [
      'a table with table: "kind"',
      { kinds: [{ kind: "probe", changes: kindLabelTable }] },
      "compare.invalid-table",
      ["kinds", 0],
    ],
    [
      'a table with table: "extension"',
      { kinds: [{ kind: "probe", changes: extensionLabelTable }] },
      "compare.invalid-table",
      ["kinds", 0],
    ],
    [
      "an invalid table of the second extension",
      { extensions: [layout, { id: "other", changes: rogueTable }] },
      "compare.invalid-table",
      ["extensions", 1],
    ],
    [
      "a kind without a string id",
      { kinds: [{ changes: { fields: {} } }] },
      "compare.invalid-table",
      ["kinds", 0],
    ],
    [
      "kinds that are not an array",
      { kinds: probe },
      "compare.invalid-table",
      ["kinds"],
    ],
    ["options that are not an object", 42, "compare.invalid-table", []],
    [
      "two probe kinds with different tables",
      {
        kinds: [
          probe,
          defineDeclarationKind({
            kind: "probe",
            normalize: () => ({}),
            changes: { fields: {} },
            diagnostics: {},
          }),
        ],
      },
      "compare.table-conflict",
      ["kinds", 1],
    ],
    [
      "two layout extensions with different tables",
      { extensions: [layout, { id: "layout", changes: { fields: {} } }] },
      "compare.table-conflict",
      ["extensions", 1],
    ],
  ];

  it.each(failing)("refuses %s", (_title, options, code, path) => {
    const result = compareModels(model(), model(), options as CompareOptions);
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        { code, severity: "error", path, message: expect.any(String) },
      ],
    });
    expect("changes" in result).toBe(false);
    expect("requiredBump" in result).toBe(false);
  });

  it("accepts one descriptor given twice", () => {
    expect(
      compareModels(model(), model(), {
        kinds: [probe, probe],
        extensions: [layout, layout],
      }),
    ).toEqual({ ok: true, changes: [], requiredBump: "none", diagnostics: [] });
  });

  it("accepts two equal tables under one id", () => {
    expect(
      compareModels(model(), model(), {
        kinds: [
          probe,
          {
            kind: "probe",
            changes: JSON.parse(JSON.stringify(probe.changes)) as ChangeTable,
          },
        ],
      }),
    ).toMatchObject({ ok: true, diagnostics: [] });
  });
});

/** A copy of a value with the keys of every object in reverse order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .reverse()
      .map((key) => [key, reversed((value as Record<string, unknown>)[key])]),
  );
}

describe("tables are compared by content, not by key order (R3)", () => {
  it("accepts two equal tables written in a different key order", () => {
    const other = reversed(probe.changes) as ChangeTable;
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(probe.changes));
    expect(
      compareModels(model(), model(), {
        kinds: [probe, { kind: "probe", changes: other }],
      }),
    ).toEqual({ ok: true, changes: [], requiredBump: "none", diagnostics: [] });
  });

  it("refuses a table that passes the rules but is not plain JSON", () => {
    // `every` skips holes, so the rules accept this order; the copy of the
    // table into plain JSON refuses it.
    // eslint-disable-next-line no-sparse-arrays
    const order = ["low", , "high"];
    const table = {
      fields: {
        level: {
          rule: "ordered",
          order,
          raised: "compatible",
          lowered: "breaking",
        },
      },
    } as unknown as ChangeTable;
    expect(isTable(table)).toBe(true);
    expect(
      compareModels(model(), model(), {
        kinds: [{ kind: "probe", changes: table }],
      }),
    ).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compare.invalid-table",
          severity: "error",
          path: ["kinds", 0],
          message: expect.any(String),
        },
      ],
    });
  });
});

describe("the entry point (P3)", () => {
  it("takes kind and extension descriptors as they are", () => {
    const result: ComparisonResult = compareFromEntry(model(), model(), {
      kinds: [probe],
      extensions: [layout],
    });
    expect(result).toEqual({
      ok: true,
      changes: [],
      requiredBump: "none",
      diagnostics: [],
    });
    expect(compareFromEntry).toBe(compareModels);
  });
});
