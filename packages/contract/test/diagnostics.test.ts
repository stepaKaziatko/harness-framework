import { describe, expect, it } from "vitest";
import {
  defineContract,
  diagnosticCodes,
  normalize,
  type CoreDiagnosticCode,
  type DiagnosticPath,
} from "../src/index.js";

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
];

/** A minimal valid root with the given fields replaced. */
function root(fields: Record<string, unknown> = {}): unknown {
  return defineContract({
    name: "trading",
    version: "0.1.0",
    ...fields,
  } as never);
}

interface Case {
  readonly title: string;
  readonly input: () => unknown;
  readonly path: DiagnosticPath;
}

/**
 * One or more minimal inputs per core code. Each gives exactly one diagnostic:
 * that code, at that path.
 */
const cases: Partial<Record<CoreDiagnosticCode, readonly Case[]>> = {
  "root.invalid-shape": [
    { title: "null input", input: () => null, path: [] },
    {
      title: "imports not an array",
      input: () => root({ imports: "auth" }),
      path: ["imports"],
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
    {
      title: "permission name",
      input: () => root({ permissions: { "Orders.place": {} } }),
      path: ["permissions", "Orders.place"],
    },
  ],
  "name.import-conflict": [
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
      title: "not an object",
      input: () => root({ declarations: ["quotes.feed"] }),
      path: ["declarations", 0],
    },
  ],
  "declaration.unknown-kind": [
    {
      title: "plain object with an envelope",
      input: () => root({ declarations: [{ kind: "probe", name: "a" }] }),
      path: ["declarations", 0],
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

  it("has 28 codes", () => {
    expect(codes).toHaveLength(28);
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
        declarations: [{ kind: "x", name: "Bad" }],
      }),
    );
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["contract.invalid-version", ["version"]],
      ["import.invalid-range", ["imports", 0, "range"]],
      ["permission.empty-subjects", ["permissions", "read", "subjects"]],
      ["declaration.unknown-kind", ["declarations", 0]],
      ["name.invalid", ["declarations", 0, "name"]],
    ]);
  });
});
