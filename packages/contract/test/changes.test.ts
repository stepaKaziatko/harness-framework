import { describe, expect, it } from "vitest";
import {
  coreChangeTable,
  defineContract,
  defineDeclarationKind,
  normalize,
  type ChangeRule,
  type ChangeTable,
  type NumberRule,
  type OptionalRule,
} from "../src/index.js";
import { isTable } from "../src/core/changes.js";
import { compareModels } from "../src/versioning/compare.js";
import { model } from "./support/compare.js";
import { probeChanges, defineProbe } from "./support/test-kind.js";

describe("coreChangeTable (T15)", () => {
  it("holds exactly the rows of the core", () => {
    expect(coreChangeTable).toStrictEqual({
      fields: {
        contract: {
          rule: "nested",
          table: {
            fields: {
              name: { rule: "breaking" },
              version: { rule: "compatible" },
            },
          },
        },
        imports: {
          rule: "nested",
          table: {
            entry: { added: "compatible", removed: "compatible" },
            fields: { range: { rule: "breaking" } },
          },
        },
        permissions: {
          rule: "nested",
          table: {
            entry: { added: "compatible", removed: "breaking" },
            fields: {
              subjects: {
                rule: "set",
                added: "compatible",
                removed: "breaking",
              },
              description: { rule: "compatible" },
            },
          },
        },
        declarations: {
          rule: "nested",
          table: {
            entry: { added: "compatible", removed: "breaking" },
            fields: {
              kind: { rule: "breaking" },
              stability: {
                rule: "ordered",
                order: ["internal", "beta", "public"],
                raised: "compatible",
                lowered: "breaking",
              },
              requires: {
                rule: "set",
                added: "breaking",
                removed: "compatible",
              },
              description: { rule: "compatible" },
              spec: { rule: "nested", table: "kind" },
            },
          },
        },
        extensions: { rule: "nested", table: "extension" },
      },
    });
    expect(Object.keys(coreChangeTable.fields)).not.toContain("formatVersion");
  });

  it("is frozen and serializable", () => {
    expect(Object.isFrozen(coreChangeTable)).toBe(true);
    expect(Object.isFrozen(coreChangeTable.fields.declarations)).toBe(true);
    expect(JSON.parse(JSON.stringify(coreChangeTable))).toStrictEqual(
      coreChangeTable,
    );
  });

  it("lets the test kind use every rule of the closed set and accepts it", () => {
    const rules = new Set<string>();
    const visit = (rule: ChangeRule): void => {
      rules.add(
        rule.rule === "schema" ? `schema:${rule.direction}` : rule.rule,
      );
      if (rule.rule === "nested" && typeof rule.table === "object") {
        walk(rule.table);
      }
      if (rule.rule === "optional") visit(rule.value);
    };
    const walk = (table: ChangeTable): void => {
      for (const rule of Object.values(table.fields)) visit(rule);
    };
    walk(probeChanges);
    expect([...rules].sort()).toEqual([
      "breaking",
      "compatible",
      "nested",
      "number",
      "optional",
      "ordered",
      "schema:input",
      "schema:output",
      "set",
    ]);
    expect(isTable(probeChanges)).toBe(true);
    const result = normalize(
      defineContract({
        name: "t",
        version: "1.0.0",
        declarations: [defineProbe({ name: "a" })],
      }),
    );
    expect(result).toMatchObject({ ok: true, diagnostics: [] });
  });
});

describe("the closed set of rules", () => {
  it.each([
    ["a field without a rule object", { fields: { a: "breaking" } }],
    ["an unknown rule", { fields: { a: { rule: "sometimes" } } }],
    [
      "an extra key on a rule",
      { fields: { a: { rule: "breaking", why: "x" } } },
    ],
    [
      "a schema rule without a direction",
      { fields: { a: { rule: "schema" } } },
    ],
    [
      "a set rule with an unknown class",
      { fields: { a: { rule: "set", added: "minor", removed: "breaking" } } },
    ],
    [
      "an ordered rule with repeated values",
      {
        fields: {
          a: {
            rule: "ordered",
            order: ["x", "x"],
            raised: "compatible",
            lowered: "breaking",
          },
        },
      },
    ],
    [
      "an ordered rule without values",
      {
        fields: {
          a: {
            rule: "ordered",
            order: [],
            raised: "compatible",
            lowered: "breaking",
          },
        },
      },
    ],
    [
      "a nested rule with an invalid table",
      {
        fields: {
          a: { rule: "nested", table: { fields: { b: { rule: "x" } } } },
        },
      },
    ],
    [
      "the core-only kind table",
      { fields: { a: { rule: "nested", table: "kind" } } },
    ],
    [
      "the core-only extension table",
      { fields: { a: { rule: "nested", table: "extension" } } },
    ],
    [
      "an entry with an unknown class",
      { entry: { added: "maybe", removed: "breaking" }, fields: {} },
    ],
    ["a table without fields", {}],
    ["a table with an extra key", { fields: {}, notes: "x" }],
    ["a function", () => ({ fields: {} })],
  ])("refuses %s", (_title, table) => {
    expect(isTable(table)).toBe(false);
  });

  it("refuses the core-only extension label in a kind's table", () => {
    const rogue = defineDeclarationKind({
      kind: "rogue",
      normalize: () => ({}),
      changes: {
        fields: { a: { rule: "nested", table: "extension" } },
      },
      diagnostics: {},
    });
    const result = normalize(
      defineContract({
        name: "t",
        version: "1.0.0",
        declarations: [rogue.declare({ name: "a" })],
      }),
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "descriptor.invalid-changes",
          severity: "error",
          path: ["declarations", 0],
          message: expect.any(String),
        },
      ],
    });
  });

  it("accepts a dictionary table with entry classes", () => {
    expect(
      isTable({
        entry: { added: "compatible", removed: "breaking" },
        fields: { a: { rule: "schema", direction: "output" } },
      }),
    ).toBe(true);
  });
});

describe("the rules number and optional", () => {
  const number: NumberRule = {
    rule: "number",
    increased: "breaking",
    decreased: "compatible",
  };
  const optional = (value: unknown): unknown => ({
    rule: "optional",
    added: "compatible",
    removed: "breaking",
    value,
  });
  const table = (rule: unknown): unknown => ({ fields: { a: rule } });

  it("are exported as types from the entry point", () => {
    const rule: OptionalRule = {
      rule: "optional",
      added: "compatible",
      removed: "breaking",
      value: number,
    };
    expect(isTable(table(rule))).toBe(true);
  });

  it.each<[string, unknown]>([
    ["a number", number],
    [
      "an ordered value",
      {
        rule: "ordered",
        order: ["low", "high"],
        raised: "compatible",
        lowered: "breaking",
      },
    ],
    ["a schema", { rule: "schema", direction: "input" }],
    [
      "an object of a nested table",
      { rule: "nested", table: { fields: { b: number } } },
    ],
  ])("optional accepts %s as its value", (_title, value) => {
    expect(isTable(table(optional(value)))).toBe(true);
  });

  it.each<[string, unknown]>([
    ["breaking", { rule: "breaking" }],
    ["compatible", { rule: "compatible" }],
    ["a set", { rule: "set", added: "compatible", removed: "breaking" }],
    [
      "a dictionary",
      {
        rule: "nested",
        table: {
          entry: { added: "compatible", removed: "breaking" },
          fields: {},
        },
      },
    ],
    ["the core-only kind table", { rule: "nested", table: "kind" }],
    ["the core-only extension table", { rule: "nested", table: "extension" }],
    ["another optional", optional(number)],
    ["an invalid number", { rule: "number", increased: "breaking" }],
    ["a value that is not a rule", "number"],
  ])("optional refuses %s as its value", (_title, value) => {
    expect(isTable(table(optional(value)))).toBe(false);
  });

  it.each<[string, unknown]>([
    [
      "optional without added",
      { rule: "optional", removed: "breaking", value: number },
    ],
    [
      "optional without removed",
      { rule: "optional", added: "compatible", value: number },
    ],
    [
      "optional without value",
      { rule: "optional", added: "compatible", removed: "breaking" },
    ],
    [
      "optional with an extra key",
      {
        rule: "optional",
        added: "compatible",
        removed: "breaking",
        value: number,
        default: 1,
      },
    ],
    [
      "optional with an unknown class",
      {
        rule: "optional",
        added: "minor",
        removed: "breaking",
        value: number,
      },
    ],
    [
      "optional with an unknown removed class",
      {
        rule: "optional",
        added: "compatible",
        removed: "Breaking",
        value: number,
      },
    ],
    ["number without increased", { rule: "number", decreased: "breaking" }],
    ["number without decreased", { rule: "number", increased: "breaking" }],
    [
      "number with an extra key",
      { rule: "number", increased: "breaking", decreased: "compatible", by: 1 },
    ],
    [
      "number with an unknown class",
      { rule: "number", increased: "breaking", decreased: "minor" },
    ],
    [
      "number with an unknown increased class",
      { rule: "number", increased: "Breaking", decreased: "compatible" },
    ],
  ])("refuses %s", (_title, rule) => {
    expect(isTable(table(rule))).toBe(false);
  });

  describe("a table with optional around a set is refused", () => {
    const rogue = table(
      optional({ rule: "set", added: "compatible", removed: "breaking" }),
    ) as ChangeTable;

    it("by compareModels", () => {
      expect(
        compareModels(model(), model(), {
          kinds: [{ kind: "probe", changes: rogue }],
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

    it("by normalize", () => {
      const kind = defineDeclarationKind({
        kind: "rogue",
        normalize: () => ({}),
        changes: rogue,
        diagnostics: {},
      });
      expect(
        normalize(
          defineContract({
            name: "t",
            version: "1.0.0",
            declarations: [kind.declare({ name: "a" })],
          }),
        ),
      ).toEqual({
        ok: false,
        diagnostics: [
          {
            code: "descriptor.invalid-changes",
            severity: "error",
            path: ["declarations", 0],
            message: expect.any(String),
          },
        ],
      });
    });
  });
});
