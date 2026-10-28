import { z } from "zod";
import { describe, expect, it } from "vitest";
import { defineContract, normalize, type ContractModel } from "../src/index.js";
import { compareModels } from "../src/versioning/compare.js";
import { changesOf, edited } from "./support/compare.js";
import { defineProbe, probe, type ProbeInput } from "./support/test-kind.js";

type Direction = "input" | "output";
type Schema = Record<string, unknown> | boolean;
type Expected = [code: string, path: (string | number)[], cls: string][];

const SPEC = ["declarations", "t.a", "spec"];

/** The model of a contract with one probe declaration `a`. */
function modelOf(fields: Omit<ProbeInput, "name">): ContractModel {
  const result = normalize(
    defineContract({
      name: "t",
      version: "1.0.0",
      declarations: [defineProbe({ name: "a", ...fields })],
    }),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.model;
}

/** The changes between two zod schemas of one direction, through normalize. */
function zodChanges(direction: Direction, before: z.ZodType, after: z.ZodType) {
  return changesOf(
    compareModels(
      modelOf({ [direction]: before }),
      modelOf({ [direction]: after }),
      { kinds: [probe] },
    ),
  );
}

/** The comparison of two hand-written schemas of one direction. */
function schemaResult(direction: Direction, before: Schema, after: Schema) {
  const at = (schema: Schema) =>
    edited((m) => {
      m.declarations["trading.orders.history"].spec[direction] = schema;
    });
  return compareModels(at(before), at(after), { kinds: [probe] });
}

/** The changes between two hand-written schemas of one direction. */
function schemaChanges(direction: Direction, before: Schema, after: Schema) {
  return changesOf(schemaResult(direction, before, after));
}

/** The bump required by two hand-written schemas of one direction. */
function schemaBump(direction: Direction, before: Schema, after: Schema) {
  const result = schemaResult(direction, before, after);
  return "requiredBump" in result ? result.requiredBump : undefined;
}

function expectSchema(
  direction: Direction,
  before: Schema,
  after: Schema,
  expected: Expected,
) {
  const base = ["declarations", "trading.orders.history", "spec", direction];
  expect(schemaChanges(direction, before, after)).toEqual(
    expected.map(([code, path, cls]) => ({
      code,
      path: [...base, ...path],
      class: cls,
    })),
  );
}

describe("the schema cases of the epic, through zod (C12)", () => {
  it("a new required input property is breaking", () => {
    expect(
      zodChanges(
        "input",
        z.object({ symbol: z.string() }),
        z.object({ symbol: z.string(), limit: z.number() }),
      ),
    ).toEqual([
      {
        code: "schema.required-added",
        path: [...SPEC, "input", "properties", "limit"],
        class: "breaking",
      },
    ]);
  });

  it("a new optional input property is compatible", () => {
    expect(
      zodChanges(
        "input",
        z.object({ symbol: z.string() }),
        z.object({ symbol: z.string(), limit: z.number().optional() }),
      ),
    ).toEqual([
      {
        code: "schema.property-added",
        path: [...SPEC, "input", "properties", "limit"],
        class: "compatible",
      },
    ]);
  });

  it("a removed required output property is one breaking change", () => {
    expect(
      zodChanges(
        "output",
        z.object({ orderId: z.string(), status: z.string() }),
        z.object({ orderId: z.string() }),
      ),
    ).toEqual([
      {
        code: "schema.property-removed",
        path: [...SPEC, "output", "properties", "status"],
        class: "breaking",
      },
    ]);
  });

  it("a changed type of an output property is breaking", () => {
    expect(
      zodChanges(
        "output",
        z.object({ price: z.string() }),
        z.object({ price: z.number() }),
      ),
    ).toEqual([
      {
        code: "schema.type-changed",
        path: [...SPEC, "output", "properties", "price", "type"],
        class: "breaking",
      },
    ]);
  });

  it("a new optional output property is compatible although the object is closed", () => {
    const before = modelOf({ output: z.object({ orderId: z.string() }) });
    const after = modelOf({
      output: z.object({ orderId: z.string(), note: z.string().optional() }),
    });
    const outputs = [before, after].map(
      (m) =>
        (m.declarations["t.a"]!.spec as { output: Record<string, unknown> })
          .output,
    );
    expect(outputs.map((output) => output.additionalProperties)).toEqual([
      false,
      false,
    ]);
    expect(changesOf(compareModels(before, after, { kinds: [probe] }))).toEqual(
      [
        {
          code: "schema.property-added",
          path: [...SPEC, "output", "properties", "note"],
          class: "compatible",
        },
      ],
    );
  });

  it.each(["output", "input"] as const)(
    "a changed pattern in %s is unrecognized and breaking",
    (direction) => {
      expect(
        zodChanges(
          direction,
          z.object({ code: z.string().regex(/^a/) }),
          z.object({ code: z.string().regex(/^b/) }),
        ),
      ).toEqual([
        {
          code: "schema.unrecognized",
          path: [...SPEC, direction, "properties", "code", "pattern"],
          class: "breaking",
        },
      ]);
    },
  );
});

describe("the matrix of codes by direction (C13)", () => {
  const object = { type: "object", properties: { x: {} } };
  const cells: [string, Schema, Schema, string, string | undefined, string][] =
    [
      // [title, before, after, code, class in input, class in output]
      [
        "property added",
        { type: "object" },
        object,
        "schema.property-added",
        "compatible",
        "compatible",
      ],
      [
        "required added",
        object,
        { ...object, required: ["x"] },
        "schema.required-added",
        "breaking",
        "compatible",
      ],
      [
        "required removed",
        { ...object, required: ["x"] },
        object,
        "schema.required-removed",
        "compatible",
        "breaking",
      ],
      [
        "narrowed",
        { type: "string" },
        { type: "string", minLength: 1 },
        "schema.narrowed",
        "breaking",
        "compatible",
      ],
      [
        "widened",
        { type: "string", minLength: 1 },
        { type: "string" },
        "schema.widened",
        "compatible",
        "breaking",
      ],
      [
        "type changed",
        { type: "string" },
        { type: "number" },
        "schema.type-changed",
        "breaking",
        "breaking",
      ],
      [
        "annotation changed",
        { type: "string", title: "A" },
        { type: "string", title: "B" },
        "schema.annotation-changed",
        "compatible",
        "compatible",
      ],
      [
        "unrecognized",
        { type: "string" },
        { type: "string", allOf: [{ minLength: 1 }] },
        "schema.unrecognized",
        "breaking",
        "breaking",
      ],
    ];
  const path = (code: string, title: string): (string | number)[] => {
    if (
      code.startsWith("schema.property") ||
      code.startsWith("schema.required")
    )
      return ["properties", "x"];
    if (code === "schema.type-changed") return ["type"];
    if (code === "schema.annotation-changed") return ["title"];
    if (code === "schema.unrecognized") return ["allOf"];
    return title === "narrowed" || title === "widened" ? ["minLength"] : [];
  };

  for (const direction of ["input", "output"] as const) {
    it.each(cells)(
      `%s in ${direction}`,
      (title, before, after, code, input, output) => {
        expectSchema(direction, before, after, [
          [code, path(code, title), (direction === "input" ? input : output)!],
        ]);
      },
    );
  }

  it.each([
    ["no additionalProperties", {}],
    ["additionalProperties: true", { additionalProperties: true }],
    ["additionalProperties: {}", { additionalProperties: {} }],
  ])(
    "a property removed from an open input object (%s) is compatible",
    (_title, open) => {
      expectSchema(
        "input",
        { ...object, ...open },
        { type: "object", ...open },
        [["schema.property-removed", ["properties", "x"], "compatible"]],
      );
    },
  );

  it("a property removed from a closed input object is breaking", () => {
    const closed = { additionalProperties: false };
    expectSchema(
      "input",
      { ...object, ...closed },
      { type: "object", ...closed },
      [["schema.property-removed", ["properties", "x"], "breaking"]],
    );
  });

  it("a property removed from an output object is breaking", () => {
    expectSchema("output", object, { type: "object" }, [
      ["schema.property-removed", ["properties", "x"], "breaking"],
    ]);
  });

  it("a changed default is breaking in input and an annotation in output", () => {
    const before = { type: "string", default: "a" };
    const after = { type: "string", default: "b" };
    expectSchema("input", before, after, [
      ["schema.default-changed", ["default"], "breaking"],
    ]);
    expectSchema("output", before, after, [
      ["schema.annotation-changed", ["default"], "compatible"],
    ]);
  });
});

describe("narrowing and widening (C14)", () => {
  describe("type as a set", () => {
    it.each<[string, Schema, Schema, Expected]>([
      [
        '"string" equals ["string"]',
        { type: "string" },
        { type: ["string"] },
        [],
      ],
      [
        "a type removed",
        { type: ["string", "null"] },
        { type: "string" },
        [["schema.narrowed", ["type"], "breaking"]],
      ],
      [
        "a type added",
        { type: "string" },
        { type: ["string", "null"] },
        [["schema.widened", ["type"], "compatible"]],
      ],
      [
        "types that do not overlap, without looking inside",
        { type: "string", minLength: 1 },
        { type: "number", minimum: 0 },
        [["schema.type-changed", ["type"], "breaking"]],
      ],
      [
        "a type removed and another added",
        { type: ["string", "null"] },
        { type: ["string", "number"] },
        [
          ["schema.narrowed", ["type"], "breaking"],
          ["schema.widened", ["type"], "compatible"],
        ],
      ],
      [
        "a type appeared",
        {},
        { type: "string" },
        [["schema.narrowed", ["type"], "breaking"]],
      ],
      [
        "a type disappeared",
        { type: "string" },
        {},
        [["schema.widened", ["type"], "compatible"]],
      ],
      [
        "a malformed type",
        { type: "string" },
        { type: 1 },
        [["schema.unrecognized", ["type"], "breaking"]],
      ],
    ])("%s", (_title, before, after, expected) => {
      expectSchema("input", before, after, expected);
    });

    it("a type removed in output is compatible", () => {
      expectSchema("output", { type: ["string", "null"] }, { type: "string" }, [
        ["schema.narrowed", ["type"], "compatible"],
      ]);
    });
  });

  describe("enum and const", () => {
    it.each<[string, Schema, Schema, string]>([
      [
        "an enum value removed",
        { enum: ["a", "b"] },
        { enum: ["a"] },
        "schema.narrowed",
      ],
      ["an enum appeared", {}, { enum: ["a"] }, "schema.narrowed"],
      [
        "an enum value added",
        { enum: ["a"] },
        { enum: ["a", "b"] },
        "schema.widened",
      ],
      ["an enum disappeared", { enum: ["a"] }, {}, "schema.widened"],
      ["a const appeared", {}, { const: "a" }, "schema.narrowed"],
      ["a const disappeared", { const: "a" }, {}, "schema.widened"],
      [
        "a const changed",
        { const: "a" },
        { const: "b" },
        "schema.unrecognized",
      ],
    ])("%s", (_title, before, after, code) => {
      const key = JSON.stringify([before, after]).includes('"enum"')
        ? "enum"
        : "const";
      const cls = code === "schema.widened" ? "compatible" : "breaking";
      expectSchema("input", before, after, [[code, [key], cls]]);
    });

    it("an enum in another order is the same set", () => {
      expectSchema("input", { enum: ["a", "b"] }, { enum: ["b", "a"] }, []);
    });

    it("an enum value removed and another added gives both", () => {
      expectSchema("input", { enum: ["a", "b"] }, { enum: ["a", "c"] }, [
        ["schema.narrowed", ["enum"], "breaking"],
        ["schema.widened", ["enum"], "compatible"],
      ]);
    });

    it("an enum value removed in output is compatible", () => {
      expectSchema("output", { enum: ["a", "b"] }, { enum: ["a"] }, [
        ["schema.narrowed", ["enum"], "compatible"],
      ]);
    });
  });

  describe("bounds", () => {
    const lower = [
      "minimum",
      "exclusiveMinimum",
      "minLength",
      "minItems",
      "minProperties",
    ];
    const upper = [
      "maximum",
      "exclusiveMaximum",
      "maxLength",
      "maxItems",
      "maxProperties",
    ];
    const cases = [...lower, ...upper].flatMap((keyword) => {
      const isLower = lower.includes(keyword);
      return [
        ["appeared", {}, { [keyword]: 1 }, "schema.narrowed"],
        ["disappeared", { [keyword]: 1 }, {}, "schema.widened"],
        [
          "grew",
          { [keyword]: 1 },
          { [keyword]: 2 },
          isLower ? "schema.narrowed" : "schema.widened",
        ],
        [
          "shrank",
          { [keyword]: 2 },
          { [keyword]: 1 },
          isLower ? "schema.widened" : "schema.narrowed",
        ],
      ].map(
        ([title, before, after, code]) =>
          [`${keyword} ${title as string}`, keyword, before, after, code] as [
            string,
            string,
            Schema,
            Schema,
            string,
          ],
      );
    });

    it.each(cases)("%s", (_title, keyword, before, after, code) => {
      const cls = code === "schema.narrowed" ? "breaking" : "compatible";
      expectSchema("input", before, after, [[code, [keyword], cls]]);
    });

    it("a lower bound that grew in output is compatible", () => {
      expectSchema("output", { minimum: 1 }, { minimum: 2 }, [
        ["schema.narrowed", ["minimum"], "compatible"],
      ]);
    });

    it("a bound that is not a number is unrecognized", () => {
      expectSchema("input", { minimum: 1 }, { minimum: "2" }, [
        ["schema.unrecognized", ["minimum"], "breaking"],
      ]);
    });
  });

  describe("uniqueItems, pattern, format and multipleOf", () => {
    it("uniqueItems appeared narrows, disappeared widens", () => {
      expectSchema(
        "input",
        { type: "array" },
        { type: "array", uniqueItems: true },
        [["schema.narrowed", ["uniqueItems"], "breaking"]],
      );
      expectSchema("input", { uniqueItems: true }, { uniqueItems: false }, [
        ["schema.widened", ["uniqueItems"], "compatible"],
      ]);
      expectSchema("input", { uniqueItems: false }, {}, []);
    });

    it.each(["pattern", "format", "multipleOf"])(
      "%s appeared narrows, disappeared widens, changed is unrecognized",
      (keyword) => {
        const [one, two] = keyword === "multipleOf" ? [2, 3] : ["a", "b"];
        expectSchema("input", {}, { [keyword]: one }, [
          ["schema.narrowed", [keyword], "breaking"],
        ]);
        expectSchema("input", { [keyword]: one }, {}, [
          ["schema.widened", [keyword], "compatible"],
        ]);
        expectSchema("input", { [keyword]: one }, { [keyword]: two }, [
          ["schema.unrecognized", [keyword], "breaking"],
        ]);
      },
    );

    it("a pattern that appeared in output is compatible", () => {
      expectSchema("output", {}, { pattern: "a" }, [
        ["schema.narrowed", ["pattern"], "compatible"],
      ]);
    });
  });

  describe("additionalProperties and boolean subschemas", () => {
    const open: Schema[] = [
      { type: "object" },
      { type: "object", additionalProperties: true },
      { type: "object", additionalProperties: {} },
    ];

    it.each(
      open.flatMap((a, i) =>
        open.filter((_b, j) => j !== i).map((b) => [a, b]),
      ),
    )("%j equals %j", (before, after) => {
      expectSchema("input", before as Schema, after as Schema, []);
    });

    it("open to closed narrows, closed to open widens", () => {
      const closed = { type: "object", additionalProperties: false };
      expectSchema("input", { type: "object" }, closed, [
        ["schema.narrowed", ["additionalProperties"], "breaking"],
      ]);
      expectSchema("input", closed, { type: "object" }, [
        ["schema.widened", ["additionalProperties"], "compatible"],
      ]);
      expectSchema("output", { type: "object" }, closed, [
        ["schema.narrowed", ["additionalProperties"], "compatible"],
      ]);
    });

    it("a schema compared with a schema is compared inside", () => {
      expectSchema(
        "input",
        { additionalProperties: { type: "string" } },
        { additionalProperties: { type: "string", minLength: 1 } },
        [
          [
            "schema.narrowed",
            ["additionalProperties", "minLength"],
            "breaking",
          ],
        ],
      );
    });

    it.each<[string, Schema, Schema]>([
      [
        "false to a schema",
        { additionalProperties: false },
        { additionalProperties: { type: "string" } },
      ],
      [
        "true to a schema",
        { additionalProperties: true },
        { additionalProperties: { type: "string" } },
      ],
      [
        "a schema to false",
        { additionalProperties: { type: "string" } },
        { additionalProperties: false },
      ],
    ])("%s is unrecognized", (_title, before, after) => {
      expectSchema("input", before, after, [
        ["schema.unrecognized", ["additionalProperties"], "breaking"],
      ]);
    });

    it("items true to false narrows, back widens", () => {
      expectSchema("input", { items: true }, { items: false }, [
        ["schema.narrowed", ["items"], "breaking"],
      ]);
      expectSchema("input", { items: false }, { items: true }, [
        ["schema.widened", ["items"], "compatible"],
      ]);
    });
  });

  describe("recursion", () => {
    it.each<[string, Schema, Schema, (string | number)[]]>([
      [
        "properties",
        { properties: { a: { type: "string" } } },
        { properties: { a: { type: "string", minLength: 1 } } },
        ["properties", "a", "minLength"],
      ],
      [
        "items",
        { items: { type: "string" } },
        { items: { type: "string", minLength: 1 } },
        ["items", "minLength"],
      ],
      [
        "prefixItems",
        { prefixItems: [{ type: "number" }, { type: "string" }] },
        { prefixItems: [{ type: "number" }, { type: "string", minLength: 1 }] },
        ["prefixItems", 1, "minLength"],
      ],
      [
        "propertyNames",
        { propertyNames: { type: "string" } },
        { propertyNames: { type: "string", minLength: 1 } },
        ["propertyNames", "minLength"],
      ],
      [
        "nested properties",
        { properties: { a: { properties: { b: { maximum: 2 } } } } },
        { properties: { a: { properties: { b: { maximum: 1 } } } } },
        ["properties", "a", "properties", "b", "maximum"],
      ],
    ])("goes into %s", (_title, before, after, path) => {
      expectSchema("input", before, after, [
        ["schema.narrowed", path, "breaking"],
      ]);
    });

    it("prefixItems of another length is unrecognized", () => {
      expectSchema(
        "input",
        { prefixItems: [{ type: "number" }] },
        { prefixItems: [{ type: "number" }, { type: "string" }] },
        [["schema.unrecognized", ["prefixItems"], "breaking"]],
      );
    });

    it("items that appear are unrecognized", () => {
      expectSchema("input", { type: "array" }, { type: "array", items: {} }, [
        ["schema.unrecognized", ["items"], "breaking"],
      ]);
    });

    it("a property that became required and narrowed gives both, in order", () => {
      expectSchema(
        "input",
        { properties: { a: { type: "string" } } },
        {
          properties: { a: { type: "string", minLength: 1 } },
          required: ["a"],
        },
        [
          ["schema.required-added", ["properties", "a"], "breaking"],
          ["schema.narrowed", ["properties", "a", "minLength"], "breaking"],
        ],
      );
    });
  });

  describe("malformed properties and required", () => {
    it("properties that are not an object are unrecognized", () => {
      expectSchema("input", { properties: {} }, { properties: [] }, [
        ["schema.unrecognized", ["properties"], "breaking"],
      ]);
    });

    it("required that is not a list of names is unrecognized", () => {
      expectSchema("input", { required: ["a"] }, { required: "a" }, [
        ["schema.unrecognized", ["required"], "breaking"],
      ]);
    });

    it("a name required without a property schema is still compared", () => {
      expectSchema("input", {}, { required: ["a"] }, [
        ["schema.required-added", ["properties", "a"], "breaking"],
      ]);
    });
  });

  describe("anyOf and oneOf as sets of branches", () => {
    const a = { type: "string" };
    const b = { type: "number" };
    const c = { type: "boolean" };

    it.each(["anyOf", "oneOf"])(
      "%s: a branch removed, added, changed",
      (keyword) => {
        expectSchema("input", { [keyword]: [a, b] }, { [keyword]: [a] }, [
          ["schema.narrowed", [keyword, 1], "breaking"],
        ]);
        expectSchema("input", { [keyword]: [a] }, { [keyword]: [a, b] }, [
          ["schema.widened", [keyword, 1], "compatible"],
        ]);
        expectSchema("input", { [keyword]: [b, a] }, { [keyword]: [c, a] }, [
          ["schema.narrowed", [keyword, 0], "breaking"],
          ["schema.widened", [keyword, 0], "compatible"],
        ]);
        expectSchema("input", {}, { [keyword]: [a] }, [
          ["schema.unrecognized", [keyword], "breaking"],
        ]);
      },
    );

    it("a branch removed in output is compatible", () => {
      expectSchema("output", { anyOf: [a, b] }, { anyOf: [b] }, [
        ["schema.narrowed", ["anyOf", 0], "compatible"],
      ]);
    });

    it("branches in another order are the same set", () => {
      expectSchema("input", { anyOf: [a, b] }, { anyOf: [b, a] }, []);
    });
  });

  describe("keywords the rules do not recognize", () => {
    const keywords: [string, unknown, unknown][] = [
      ["allOf", [{ minLength: 1 }], [{ minLength: 2 }]],
      ["not", { type: "null" }, { type: "string" }],
      ["$ref", "#/$defs/a", "#/$defs/b"],
      ["$defs", { a: { type: "string" } }, { a: { type: "number" } }],
      ["if", { minLength: 1 }, { minLength: 2 }],
      ["then", { minLength: 1 }, { minLength: 2 }],
      ["else", { minLength: 1 }, { minLength: 2 }],
      ["patternProperties", { "^a": {} }, { "^b": {} }],
      ["dependentRequired", { a: ["b"] }, { a: ["c"] }],
    ];
    const cases = keywords.flatMap(([keyword, one, two]) =>
      (["input", "output"] as const).flatMap((direction) =>
        (
          [
            ["appeared", {}, { [keyword]: one }],
            ["disappeared", { [keyword]: one }, {}],
            ["changed", { [keyword]: one }, { [keyword]: two }],
          ] as [string, Schema, Schema][]
        ).map(
          ([title, before, after]) =>
            [
              `${keyword} ${title} in ${direction}`,
              keyword,
              direction,
              before,
              after,
            ] as const,
        ),
      ),
    );

    it.each(cases)(
      "%s is breaking",
      (_title, keyword, direction, before, after) => {
        expectSchema(direction, before, after, [
          ["schema.unrecognized", [keyword], "breaking"],
        ]);
      },
    );
  });

  describe("annotations", () => {
    const cases = (
      ["title", "description", "examples", "deprecated", "$comment"] as const
    ).flatMap((keyword) =>
      (["input", "output"] as const).map(
        (direction) => [keyword, direction] as const,
      ),
    );

    it.each(cases)("%s in %s is compatible", (keyword, direction) => {
      const [one, two] =
        keyword === "examples"
          ? [["a"], ["b"]]
          : keyword === "deprecated"
            ? [false, true]
            : ["a", "b"];
      expectSchema(direction, { [keyword]: one }, { [keyword]: two }, [
        ["schema.annotation-changed", [keyword], "compatible"],
      ]);
    });
  });
});

describe("properties, required and additionalProperties together", () => {
  describe("a property removed from properties and added to required", () => {
    const before = {
      type: "object",
      properties: { a: { type: "string" } },
      required: [],
    };
    const after = { type: "object", properties: {}, required: ["a"] };

    it("is a compatible removal and a breaking requirement in input", () => {
      expectSchema("input", before, after, [
        ["schema.property-removed", ["properties", "a"], "compatible"],
        ["schema.required-added", ["properties", "a"], "breaking"],
      ]);
      expect(schemaBump("input", before, after)).toBe("major");
    });

    it("is a breaking removal and a compatible requirement in output", () => {
      expectSchema("output", before, after, [
        ["schema.property-removed", ["properties", "a"], "breaking"],
        ["schema.required-added", ["properties", "a"], "compatible"],
      ]);
      expect(schemaBump("output", before, after)).toBe("major");
    });

    it("gives no requirement when the property was already required", () => {
      expectSchema(
        "input",
        { type: "object", properties: { a: {} }, required: ["a"] },
        { type: "object", required: ["a"] },
        [["schema.property-removed", ["properties", "a"], "compatible"]],
      );
    });
  });

  describe("a name required without a declaration, declared as optional", () => {
    const before = { type: "object", properties: {}, required: ["a"] };
    const after = {
      type: "object",
      properties: { a: { type: "number" } },
      required: [],
    };

    it("is breaking in output: the guaranteed field may be absent", () => {
      expectSchema("output", before, after, [
        ["schema.property-added", ["properties", "a"], "compatible"],
        ["schema.required-removed", ["properties", "a"], "breaking"],
      ]);
      expect(schemaBump("output", before, after)).toBe("major");
    });

    it("is compatible in input: the value is no longer demanded", () => {
      expectSchema("input", before, after, [
        ["schema.property-added", ["properties", "a"], "compatible"],
        ["schema.required-removed", ["properties", "a"], "compatible"],
      ]);
      expect(schemaBump("input", before, after)).toBe("minor");
    });
  });

  describe("a new property under a previous additionalProperties schema", () => {
    it("is compared with that schema in input", () => {
      const before = {
        type: "object",
        additionalProperties: { type: "number" },
      };
      const after = { ...before, properties: { b: { type: "string" } } };
      expectSchema("input", before, after, [
        ["schema.property-added", ["properties", "b"], "compatible"],
        ["schema.type-changed", ["properties", "b", "type"], "breaking"],
      ]);
      expect(schemaBump("input", before, after)).toBe("major");
    });

    it("is compared with that schema in output", () => {
      const before = {
        type: "object",
        additionalProperties: { type: "string", minLength: 1 },
      };
      const after = { ...before, properties: { b: { type: "string" } } };
      expectSchema("output", before, after, [
        ["schema.property-added", ["properties", "b"], "compatible"],
        ["schema.widened", ["properties", "b", "minLength"], "breaking"],
      ]);
      expect(schemaBump("output", before, after)).toBe("major");
    });

    it("is compared with that schema when it is required, in output", () => {
      const before = {
        type: "object",
        additionalProperties: { type: "string", minLength: 1 },
      };
      const after = {
        ...before,
        properties: { b: { type: "string" } },
        required: ["b"],
      };
      expectSchema("output", before, after, [
        ["schema.required-added", ["properties", "b"], "compatible"],
        ["schema.widened", ["properties", "b", "minLength"], "breaking"],
      ]);
      expect(schemaBump("output", before, after)).toBe("major");
    });

    it("is compared with that schema when it is required, in input", () => {
      const before = {
        type: "object",
        additionalProperties: { type: "string" },
      };
      const after = {
        ...before,
        properties: { b: { type: "string", minLength: 1 } },
        required: ["b"],
      };
      expectSchema("input", before, after, [
        ["schema.required-added", ["properties", "b"], "breaking"],
        ["schema.narrowed", ["properties", "b", "minLength"], "breaking"],
      ]);
    });

    it("is compatible when its schema equals the previous one", () => {
      const before = {
        type: "object",
        additionalProperties: { type: "number" },
      };
      const after = { ...before, properties: { b: { type: "number" } } };
      expectSchema("input", before, after, [
        ["schema.property-added", ["properties", "b"], "compatible"],
      ]);
      expect(schemaBump("input", before, after)).toBe("minor");
    });

    it("is compared with the previous schema, not the next one", () => {
      expectSchema(
        "input",
        { type: "object", additionalProperties: { type: "number" } },
        {
          type: "object",
          additionalProperties: { type: "string" },
          properties: { b: { type: "string" } },
        },
        [
          ["schema.type-changed", ["additionalProperties", "type"], "breaking"],
          ["schema.property-added", ["properties", "b"], "compatible"],
          ["schema.type-changed", ["properties", "b", "type"], "breaking"],
        ],
      );
      expectSchema(
        "input",
        { type: "object", additionalProperties: false },
        {
          type: "object",
          additionalProperties: { type: "number" },
          properties: { b: { type: "string" } },
        },
        [
          ["schema.unrecognized", ["additionalProperties"], "breaking"],
          ["schema.property-added", ["properties", "b"], "compatible"],
        ],
      );
    });

    it("whose schema is true is unrecognized, a false breaking", () => {
      const before = {
        type: "object",
        additionalProperties: { type: "number" },
      };
      expectSchema("input", before, { ...before, properties: { b: true } }, [
        ["schema.property-added", ["properties", "b"], "compatible"],
        ["schema.unrecognized", ["properties", "b"], "breaking"],
      ]);
    });

    it.each<[string, Record<string, unknown>]>([
      ["absent", {}],
      ["true", { additionalProperties: true }],
      ["{}", { additionalProperties: {} }],
      ["false", { additionalProperties: false }],
    ])(
      "is only added when the previous additionalProperties is %s",
      (_title, additional) => {
        for (const direction of ["input", "output"] as const) {
          for (const required of [false, true]) {
            const before = { type: "object", ...additional };
            const after = {
              ...before,
              properties: { b: { type: "string" } },
              ...(required ? { required: ["b"] } : {}),
            };
            const code = required
              ? "schema.required-added"
              : "schema.property-added";
            const cls =
              required && direction === "input" ? "breaking" : "compatible";
            expectSchema(direction, before, after, [
              [code, ["properties", "b"], cls],
            ]);
          }
        }
      },
    );
  });

  describe("the assumptions about removed and added properties", () => {
    const object = { type: "object", properties: { x: {} } };

    it("a removal goes by the next additionalProperties: open to false", () => {
      expectSchema(
        "input",
        object,
        { type: "object", additionalProperties: false },
        [
          ["schema.narrowed", ["additionalProperties"], "breaking"],
          ["schema.property-removed", ["properties", "x"], "breaking"],
        ],
      );
    });

    it("a removal goes by the next additionalProperties: false to open", () => {
      expectSchema(
        "input",
        { ...object, additionalProperties: false },
        { type: "object" },
        [
          ["schema.widened", ["additionalProperties"], "compatible"],
          ["schema.property-removed", ["properties", "x"], "compatible"],
        ],
      );
    });

    it("a removal goes by the next additionalProperties: open to a schema", () => {
      expectSchema(
        "input",
        object,
        { type: "object", additionalProperties: { type: "string" } },
        [
          ["schema.unrecognized", ["additionalProperties"], "breaking"],
          ["schema.property-removed", ["properties", "x"], "breaking"],
        ],
      );
    });

    it("a constrained optional property added to an open input object is compatible", () => {
      const before = { type: "object" };
      const after = {
        type: "object",
        properties: { b: { type: "string", minLength: 3 } },
      };
      expectSchema("input", before, after, [
        ["schema.property-added", ["properties", "b"], "compatible"],
      ]);
      expect(schemaBump("input", before, after)).toBe("minor");
    });
  });
});
