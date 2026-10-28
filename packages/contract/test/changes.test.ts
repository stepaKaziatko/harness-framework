import { describe, expect, it } from "vitest";
import { coreChangeTable, defineContract, normalize } from "../src/index.js";
import { isTable } from "../src/core/changes.js";
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
    const walk = (table: typeof probeChanges): void => {
      for (const rule of Object.values(table.fields)) {
        rules.add(
          rule.rule === "schema" ? `schema:${rule.direction}` : rule.rule,
        );
        if (rule.rule === "nested" && rule.table !== "kind") walk(rule.table);
      }
    };
    walk(probeChanges);
    expect([...rules].sort()).toEqual([
      "breaking",
      "compatible",
      "nested",
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
      "an entry with an unknown class",
      { entry: { added: "maybe", removed: "breaking" }, fields: {} },
    ],
    ["a table without fields", {}],
    ["a table with an extra key", { fields: {}, notes: "x" }],
    ["a function", () => ({ fields: {} })],
  ])("refuses %s", (_title, table) => {
    expect(isTable(table)).toBe(false);
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
