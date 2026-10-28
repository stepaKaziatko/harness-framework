import { describe, expect, it } from "vitest";
import {
  defineContract,
  defineExtension,
  normalize,
  type ContractModel,
} from "../src/index.js";
import {
  coreRoot,
  coreRootInput,
  coreRootWithLayout,
} from "./fixtures/core-root.js";
import { defineLayout } from "./support/test-extension.js";

function modelOf(root: unknown): ContractModel {
  const result = normalize(root);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.model;
}

function root(extensions: unknown[]): unknown {
  return defineContract({ ...coreRootInput, extensions } as never);
}

describe("the test extension (T12)", () => {
  it("gives its section under extensions.<id> from normalized declarations", () => {
    const model = modelOf(coreRootWithLayout);
    expect(model.extensions).toStrictEqual({
      layout: {
        panels: {
          "trading.orders.panel": {
            source: "trading.orders.place",
            sourceStability: "beta",
            stability: "internal",
          },
          "trading.quotes.panel": {
            source: "trading.quotes.feed",
            sourceStability: "public",
            stability: "public",
          },
        },
      },
    });
  });

  it("changes nothing in the model but the extensions key", () => {
    const withLayout = { ...modelOf(coreRootWithLayout) } as Record<
      string,
      unknown
    >;
    delete withLayout.extensions;
    expect(JSON.stringify(withLayout)).toBe(JSON.stringify(modelOf(coreRoot)));
  });

  it("puts its names into the namespace shared with declarations", () => {
    const result = normalize(
      root([
        defineLayout({
          panels: [{ name: "quotes.feed", source: "orders.place" }],
        }),
      ]),
    );
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["name.duplicate", ["extensions", 0, "panels", 0, "name"]],
    ]);
  });

  it("checks its names against the grammar and the imports", () => {
    const result = normalize(
      root([
        defineLayout({
          panels: [
            { name: "Panel", source: "quotes.feed" },
            { name: "auth.panel", source: "quotes.feed" },
          ],
        }),
      ]),
    );
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["name.invalid", ["extensions", 0, "panels", 0, "name"]],
      ["name.import-conflict", ["extensions", 0, "panels", 1, "name"]],
    ]);
  });

  it("resolves references with a kind filter and reports its own warning", () => {
    const result = normalize(root([defineLayout({ panels: [] })]));
    expect(result).toMatchObject({
      ok: true,
      diagnostics: [
        {
          code: "layout.empty",
          severity: "warning",
          path: ["extensions", 0, "panels"],
        },
      ],
    });
    const mismatch = normalize(
      root([
        defineLayout({
          panels: [
            { name: "a", source: "b" },
            { name: "b", source: "a" },
          ],
        }),
      ]),
    );
    expect(mismatch.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["reference.kind-mismatch", ["extensions", 0, "panels", 0, "source"]],
      ["reference.kind-mismatch", ["extensions", 0, "panels", 1, "source"]],
    ]);
  });

  it("refuses the same extension twice", () => {
    const section = defineLayout({ panels: [] });
    const result = normalize(root([section, defineLayout({ panels: [] })]));
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["descriptor.conflict", ["extensions", 1]],
    ]);
  });

  it("refuses a code of its catalog that lacks the extension's prefix", () => {
    for (const code of ["other.code", "root.invalid-shape"]) {
      const section = defineExtension({
        id: "rogue",
        names: () => [],
        normalize: (_section, context) => {
          context.report(code, [], "x");
          return null;
        },
        changes: { fields: {} },
        diagnostics: {
          "rogue.known": { severity: "error", summary: "Known." },
          "other.code": { severity: "error", summary: "Foreign." },
          "root.invalid-shape": {
            severity: "warning",
            summary: "A core code.",
          },
        },
      }).declare({});
      const result = normalize(root([section]));
      expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
        ["descriptor.undeclared-code", ["extensions", 0]],
      ]);
    }
  });

  it("holds extensions to the same discipline as kinds", () => {
    const make = (names: () => unknown, normalizeSection: () => unknown) =>
      defineExtension({
        id: "rogue",
        names: names as never,
        normalize: normalizeSection as never,
        changes: { fields: {} },
        diagnostics: {},
      }).declare({});
    const cases: [unknown, string][] = [
      [
        make(
          () => {
            throw new Error("x");
          },
          () => null,
        ),
        "descriptor.failed",
      ],
      [
        make(
          () => "names",
          () => null,
        ),
        "descriptor.failed",
      ],
      [
        make(
          () => [{}],
          () => null,
        ),
        "descriptor.failed",
      ],
      [
        make(
          () => [
            { name: "a", kind: "panel" },
            { name: 1, kind: "panel" },
          ],
          () => null,
        ),
        "descriptor.failed",
      ],
      [
        make(
          () => [],
          () => {
            throw new Error("x");
          },
        ),
        "descriptor.failed",
      ],
      [
        make(
          () => [],
          () => ({ f: () => 1 }),
        ),
        "descriptor.non-json-output",
      ],
    ];
    for (const [section, code] of cases) {
      const result = normalize(root([section]));
      expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
        [code, ["extensions", 0]],
      ]);
    }
  });
});
