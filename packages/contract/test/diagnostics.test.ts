import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  defineContract,
  defineDeclarationKind,
  defineExtension,
  diagnosticCodes,
  normalize,
  type ChangeTable,
  type CoreDiagnosticCode,
  type Declaration,
  type DeclarationContext,
  type DiagnosticCatalog,
  type DiagnosticPath,
  type JsonValue,
} from "../src/index.js";
import { RESERVED_CODE_AREAS } from "../src/core/diagnostics.js";
import {
  createProbeKind,
  defineProbe,
  type ProbeInput,
} from "./support/test-kind.js";

const RESERVED_AREAS = [
  "root",
  "contract",
  "name",
  "import",
  "reference",
  "permission",
  "declaration",
  "descriptor",
  "schema",
  "compare",
];

/** A minimal valid root with the given fields replaced. */
function root(fields: Record<string, unknown> = {}): unknown {
  return defineContract({
    name: "trading",
    version: "0.1.0",
    ...fields,
  } as never);
}

/** A kind whose `normalize` does what the test needs. */
function kind(
  normalize: (declaration: Declaration, context: DeclarationContext) => unknown,
  options: { kind?: string; changes?: unknown; diagnostics?: unknown } = {},
) {
  return defineDeclarationKind({
    kind: options.kind ?? "rogue",
    normalize: normalize as (
      declaration: Declaration,
      context: DeclarationContext,
    ) => JsonValue,
    changes: (options.changes ?? { fields: {} }) as ChangeTable,
    diagnostics: (options.diagnostics ?? {}) as DiagnosticCatalog,
  });
}

interface Case {
  readonly title: string;
  readonly input: () => unknown;
  readonly path: DiagnosticPath;
}

const longName = `${"a".repeat(30)}.${"b".repeat(30)}`; // "trading." + 61 = 69 > 64

/**
 * One or more minimal inputs per core code. Each gives exactly one diagnostic:
 * that code, at that path. The type makes the table cover the whole catalog.
 */
const cases: Record<CoreDiagnosticCode, readonly Case[]> = {
  "root.invalid-shape": [
    { title: "null input", input: () => null, path: [] },
    {
      title: "imports not an array",
      input: () => root({ imports: "auth" }),
      path: ["imports"],
    },
    {
      title: "extension entry without a descriptor",
      input: () => root({ extensions: [{ id: "layout" }] }),
      path: ["extensions", 0],
    },
  ],
  "root.unknown-field": [
    {
      title: "typo in permissions",
      input: () => root({ permisions: {} }),
      path: ["permisions"],
    },
  ],
  "contract.invalid-name": [
    {
      title: "uppercase",
      input: () => root({ name: "Trading" }),
      path: ["name"],
    },
    {
      title: "two segments",
      input: () => root({ name: "acme.trading" }),
      path: ["name"],
    },
  ],
  "contract.invalid-version": [
    { title: "1.0", input: () => root({ version: "1.0" }), path: ["version"] },
    {
      title: "01.0.0",
      input: () => root({ version: "01.0.0" }),
      path: ["version"],
    },
    {
      title: "1.0.0+build",
      input: () => root({ version: "1.0.0+build" }),
      path: ["version"],
    },
  ],
  "import.invalid-contract": [
    {
      title: "uppercase import",
      input: () => root({ imports: [{ contract: "Auth", range: "^1.0.0" }] }),
      path: ["imports", 0, "contract"],
    },
  ],
  "import.invalid-range": [
    "^1.x",
    ">=1.0.0",
    "^1.0.0-rc.1",
    "1.0.0 ||",
    "^01.0.0",
    "*",
  ].map((range) => ({
    title: `range ${range}`,
    input: () => root({ imports: [{ contract: "auth", range }] }),
    path: ["imports", 0, "range"],
  })),
  "import.empty-range": [
    { range: ">=2.0.0 <1.0.0", index: 0 },
    { range: ">=1.0.0 <1.0.0", index: 0 },
    { range: "^1.0.0 || >=3.0.0 <2.0.0", index: 1 },
  ].map(({ range, index }) => ({
    title: `range ${range}`,
    input: () =>
      root({
        imports: [
          ...(index === 1 ? [{ contract: "billing", range: "^1.0.0" }] : []),
          { contract: "auth", range },
        ],
      }),
    path: ["imports", index, "range"],
  })),
  "import.self": [
    {
      title: "self import",
      input: () => root({ imports: [{ contract: "trading", range: "1.0.0" }] }),
      path: ["imports", 0, "contract"],
    },
  ],
  "import.duplicate": [
    {
      title: "auth twice",
      input: () =>
        root({
          imports: [
            { contract: "auth", range: "^1.0.0" },
            { contract: "auth", range: "^2.0.0" },
          ],
        }),
      path: ["imports", 1, "contract"],
    },
  ],
  "name.invalid": [
    ...["Quotes", "quotes_feed", "a-1", "a..b", "a.b.c.d", "", longName].map(
      (name) => ({
        title: `declaration name ${JSON.stringify(name)}`,
        input: () => root({ declarations: [defineProbe({ name })] }),
        path: ["declarations", 0, "name"],
      }),
    ),
    {
      title: "permission name",
      input: () => root({ permissions: { "Orders.place": {} } }),
      path: ["permissions", "Orders.place"],
    },
  ],
  "name.duplicate": [
    {
      title: "two declarations with one name",
      input: () =>
        root({
          declarations: [
            defineProbe({ name: "quotes.feed" }),
            defineProbe({ name: "quotes.feed" }),
          ],
        }),
      path: ["declarations", 1, "name"],
    },
  ],
  "name.import-conflict": [
    {
      title: "declaration under an import name",
      input: () =>
        root({
          imports: [{ contract: "auth", range: "^1.0.0" }],
          declarations: [defineProbe({ name: "auth.users" })],
        }),
      path: ["declarations", 0, "name"],
    },
    {
      title: "permission under an import name",
      input: () =>
        root({
          imports: [{ contract: "auth", range: "^1.0.0" }],
          permissions: { "auth.read": {} },
        }),
      path: ["permissions", "auth.read"],
    },
  ],
  "reference.invalid": [
    {
      title: "not a path",
      input: () =>
        root({
          declarations: [defineProbe({ name: "a", refs: ["Not A Path"] })],
        }),
      path: ["declarations", 0, "refs", 0],
    },
    {
      title: "an import without a path",
      input: () =>
        root({
          imports: [{ contract: "auth", range: "^1.0.0" }],
          declarations: [defineProbe({ name: "a", refs: ["auth"] })],
        }),
      path: ["declarations", 0, "refs", 0],
    },
  ],
  "reference.unknown": [
    {
      title: "missing local name",
      input: () =>
        root({ declarations: [defineProbe({ name: "a", refs: ["missing"] })] }),
      path: ["declarations", 0, "refs", 0],
    },
    {
      title: "qualified own name is not a reference",
      input: () =>
        root({
          declarations: [defineProbe({ name: "a", refs: ["trading.a"] })],
        }),
      path: ["declarations", 0, "refs", 0],
    },
  ],
  "reference.kind-mismatch": [
    {
      title: "probe referenced as another kind",
      input: () =>
        root({
          declarations: [
            defineProbe({ name: "a", refs: [{ ref: "b", kind: "source" }] }),
            defineProbe({ name: "b" }),
          ],
        }),
      path: ["declarations", 0, "refs", 0],
    },
  ],
  "permission.unknown": [
    {
      title: "undeclared permission",
      input: () =>
        root({
          declarations: [
            defineProbe({ name: "a", requires: ["orders.place"] }),
          ],
        }),
      path: ["declarations", 0, "requires", 0],
    },
    {
      title: "permission of an import",
      input: () =>
        root({
          imports: [{ contract: "auth", range: "^1.0.0" }],
          permissions: { read: {} },
          declarations: [
            defineProbe({ name: "a", requires: ["read", "auth.read"] }),
          ],
        }),
      path: ["declarations", 0, "requires", 1],
    },
  ],
  "permission.unknown-subject": [
    {
      title: "service subject",
      input: () =>
        root({
          permissions: { "orders.place": { subjects: [{ kind: "service" }] } },
        }),
      path: ["permissions", "orders.place", "subjects", 0, "kind"],
    },
  ],
  "permission.empty-subjects": [
    {
      title: "no subjects",
      input: () => root({ permissions: { "orders.place": { subjects: [] } } }),
      path: ["permissions", "orders.place", "subjects"],
    },
  ],
  "declaration.invalid-envelope": [
    {
      title: "plain object without kind",
      input: () => root({ declarations: [{ name: "a" }] }),
      path: ["declarations", 0],
    },
    {
      title: "name is not a string",
      input: () =>
        root({
          declarations: [defineProbe({ name: 42 } as unknown as ProbeInput)],
        }),
      path: ["declarations", 0],
    },
    {
      title: "requires is not an array of strings",
      input: () =>
        root({
          declarations: [
            defineProbe({
              name: "a",
              requires: "read",
            } as unknown as ProbeInput),
          ],
        }),
      path: ["declarations", 0],
    },
    {
      title: "description is not a string",
      input: () =>
        root({
          declarations: [
            defineProbe({ name: "a", description: 1 } as unknown as ProbeInput),
          ],
        }),
      path: ["declarations", 0],
    },
    {
      title: "not an object",
      input: () => root({ declarations: ["quotes.feed"] }),
      path: ["declarations", 0],
    },
  ],
  "declaration.invalid-stability": [
    {
      title: "stable",
      input: () =>
        root({
          declarations: [
            defineProbe({
              name: "a",
              stability: "stable",
            } as unknown as ProbeInput),
          ],
        }),
      path: ["declarations", 0, "stability"],
    },
  ],
  "declaration.unknown-kind": [
    {
      title: "plain object with an envelope",
      input: () => root({ declarations: [{ kind: "probe", name: "a" }] }),
      path: ["declarations", 0],
    },
  ],
  "descriptor.conflict": [
    {
      title: "two kinds named probe",
      input: () =>
        root({
          declarations: [
            defineProbe({ name: "a" }),
            createProbeKind().declare({ name: "b" }),
          ],
        }),
      path: ["declarations", 1],
    },
    {
      title: "a kind and an extension with one id",
      input: () =>
        root({
          declarations: [defineProbe({ name: "a" })],
          extensions: [
            defineExtension({
              id: "probe",
              names: () => [],
              normalize: () => ({}),
              changes: { fields: {} },
              diagnostics: {},
            }).declare({}),
          ],
        }),
      path: ["extensions", 0],
    },
  ],
  "descriptor.reserved-id": [
    {
      title: "kind named permission",
      input: () =>
        root({
          declarations: [
            kind(() => ({}), { kind: "permission" }).declare({ name: "a" }),
          ],
        }),
      path: ["declarations", 0],
    },
    {
      title: "kind named compare",
      input: () =>
        root({
          declarations: [
            kind(() => ({}), { kind: "compare" }).declare({ name: "a" }),
          ],
        }),
      path: ["declarations", 0],
    },
    {
      title: "extension named compare",
      input: () =>
        root({
          extensions: [
            defineExtension({
              id: "compare",
              names: () => [],
              normalize: () => ({}),
              changes: { fields: {} },
              diagnostics: {},
            }).declare({}),
          ],
        }),
      path: ["extensions", 0],
    },
    {
      title: "kind that is not a segment",
      input: () =>
        root({
          declarations: [
            kind(() => ({}), { kind: "Source" }).declare({ name: "a" }),
          ],
        }),
      path: ["declarations", 0],
    },
  ],
  "descriptor.invalid-changes": [
    {
      title: "rule outside the set",
      input: () =>
        root({
          declarations: [
            kind(() => ({}), {
              changes: { fields: { a: { rule: "sometimes" } } },
            }).declare({ name: "a" }),
          ],
        }),
      path: ["declarations", 0],
    },
  ],
  "descriptor.undeclared-code": [
    {
      title: "code of another area",
      input: () =>
        root({
          declarations: [
            kind((_declaration, context) => {
              context.report("probe.unusual", [], "not mine");
              return {};
            }).declare({ name: "a" }),
          ],
        }),
      path: ["declarations", 0],
    },
  ],
  "descriptor.non-json-output": [
    {
      title: "function in the output",
      input: () =>
        root({
          declarations: [kind(() => ({ run: () => 1 })).declare({ name: "a" })],
        }),
      path: ["declarations", 0],
    },
  ],
  "descriptor.failed": [
    {
      title: "normalize throws",
      input: () =>
        root({
          declarations: [
            kind(() => {
              throw new Error("boom");
            }).declare({ name: "a" }),
          ],
        }),
      path: ["declarations", 0],
    },
  ],
  "schema.invalid": [
    {
      title: "not a zod schema",
      input: () =>
        root({
          declarations: [
            defineProbe({
              name: "a",
              input: { type: "string" } as unknown as z.ZodString,
            }),
          ],
        }),
      path: ["declarations", 0, "input"],
    },
  ],
  "schema.unrepresentable": [
    {
      title: "z.date()",
      input: () =>
        root({ declarations: [defineProbe({ name: "a", output: z.date() })] }),
      path: ["declarations", 0, "output"],
    },
  ],
};

describe("core diagnostics (T6)", () => {
  for (const [code, list] of Object.entries(cases) as [
    CoreDiagnosticCode,
    readonly Case[],
  ][]) {
    describe(code, () => {
      it.each(list.map((item) => [item.title, item] as const))(
        "%s",
        (_title, item) => {
          let result: ReturnType<typeof normalize> | undefined;
          expect(() => {
            result = normalize(item.input());
          }).not.toThrow();
          expect(result?.ok).toBe(false);
          expect(result?.diagnostics).toEqual([
            {
              code,
              severity: diagnosticCodes[code].severity,
              path: item.path,
              message: expect.any(String),
            },
          ]);
        },
      );
    });
  }
});

describe("the catalog of core codes (T9)", () => {
  const codes = Object.keys(diagnosticCodes);

  it("has 29 codes, each covered by a case above", () => {
    expect(codes).toHaveLength(29);
    expect(new Set(Object.keys(cases))).toEqual(new Set(codes));
  });

  it.each(codes)("%s follows the grammar of codes", (code) => {
    expect(code).toMatch(
      /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*\.[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/,
    );
    expect(RESERVED_AREAS).toContain(code.split(".")[0]);
    const info = diagnosticCodes[code as CoreDiagnosticCode];
    expect(info.severity).toBe("error");
    expect(info.summary.length).toBeGreaterThan(0);
  });

  it("reserves the areas of the core and of version comparison", () => {
    expect([...RESERVED_CODE_AREAS]).toEqual(RESERVED_AREAS);
    expect(Object.isFrozen(RESERVED_CODE_AREAS)).toBe(true);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(diagnosticCodes)).toBe(true);
    expect(Object.isFrozen(diagnosticCodes["root.invalid-shape"])).toBe(true);
  });
});

describe("collecting diagnostics", () => {
  it("collects every problem of phases 1 and 2 in input order", () => {
    const result = normalize(
      root({
        version: "1.0",
        imports: [{ contract: "auth", range: "^1.x" }],
        permissions: { read: { subjects: [] } },
        declarations: [
          defineProbe({ name: "Bad" }),
          defineProbe({ name: "ok", requires: ["write"] }),
        ],
      }),
    );
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["contract.invalid-version", ["version"]],
      ["import.invalid-range", ["imports", 0, "range"]],
      ["permission.empty-subjects", ["permissions", "read", "subjects"]],
      ["name.invalid", ["declarations", 0, "name"]],
      ["permission.unknown", ["declarations", 1, "requires", 0]],
    ]);
  });
});
