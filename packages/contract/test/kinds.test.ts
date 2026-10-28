import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  defineContract,
  defineDeclarationKind,
  defineExtension,
  normalize,
  type Declaration,
  type DeclarationContext,
  type JsonValue,
} from "../src/index.js";
import {
  createProbeKind,
  defineProbe,
  normalizeProbe,
} from "./support/test-kind.js";

function root(fields: Record<string, unknown>): unknown {
  return defineContract({
    name: "trading",
    version: "0.1.0",
    ...fields,
  } as never);
}

function codesAndPaths(result: ReturnType<typeof normalize>) {
  return result.diagnostics.map((item) => [item.code, item.path]);
}

function rogue(
  normalize: (declaration: Declaration, context: DeclarationContext) => unknown,
  kind = "rogue",
  diagnostics: Record<
    string,
    { severity: "error" | "warning"; summary: string }
  > = {},
) {
  return defineDeclarationKind({
    kind,
    normalize: normalize as (
      declaration: Declaration,
      context: DeclarationContext,
    ) => JsonValue,
    changes: { fields: {} },
    diagnostics,
  });
}

describe("the test kind uses the whole context (T11)", () => {
  it("resolves its own declarations with a kind filter", () => {
    const result = normalize(
      root({
        declarations: [
          defineProbe({ name: "a", refs: [{ ref: "b", kind: "probe" }, "b"] }),
          defineProbe({ name: "b" }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.declarations["trading.a"]?.spec).toMatchObject({
      refs: ["trading.b", "trading.b"],
    });
  });

  it("reports a reference of another kind and an unknown reference", () => {
    const result = normalize(
      root({
        declarations: [
          defineProbe({
            name: "a",
            refs: [{ ref: "b", kind: "source" }, "missing"],
          }),
          defineProbe({ name: "b" }),
        ],
      }),
    );
    expect(codesAndPaths(result)).toEqual([
      ["reference.kind-mismatch", ["declarations", 0, "refs", 0]],
      ["reference.unknown", ["declarations", 0, "refs", 1]],
    ]);
  });

  it("accepts a reference into an import without checking that it exists", () => {
    const result = normalize(
      root({
        imports: [{ contract: "auth", range: "^1.4.0" }],
        declarations: [
          defineProbe({
            name: "a",
            refs: [{ ref: "auth.users.get", kind: "probe" }],
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.declarations["trading.a"]?.spec).toMatchObject({
      refs: ["auth.users.get"],
    });
  });

  it("converts a schema with a default differently for input and output", () => {
    const schema = z.object({
      symbol: z.string(),
      type: z.string().default("market"),
    });
    const result = normalize(
      root({
        declarations: [
          defineProbe({ name: "a", input: schema, output: schema }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spec = result.model.declarations["trading.a"]?.spec as Record<
      string,
      Record<string, unknown>
    >;
    expect(spec.input?.required).toEqual(["symbol"]);
    expect(spec.output?.required).toEqual(["symbol", "type"]);
    expect(spec.input).not.toHaveProperty("$schema");
  });

  it("reports a schema that JSON Schema cannot represent", () => {
    for (const output of [
      z.date(),
      z.bigint(),
      z.map(z.string(), z.string()),
      z.string().transform((value) => value.length),
    ]) {
      const result = normalize(
        root({ declarations: [defineProbe({ name: "a", output })] }),
      );
      expect(codesAndPaths(result)).toEqual([
        ["schema.unrepresentable", ["declarations", 0, "output"]],
      ]);
    }
  });

  it("reports its own warning and still gives a model", () => {
    const result = normalize(
      root({ declarations: [defineProbe({ name: "a", unusual: true })] }),
    );
    expect(result).toMatchObject({
      ok: true,
      diagnostics: [
        {
          code: "probe.unusual",
          severity: "warning",
          path: ["declarations", 0, "unusual"],
        },
      ],
    });
  });

  it("gets a frozen copy of the declaration and its qualified name", () => {
    const seen: unknown[] = [];
    const kind = rogue((declaration, context) => {
      seen.push(Object.isFrozen(declaration), context.name, context.contract);
      return null;
    });
    expect(
      normalize(root({ declarations: [kind.declare({ name: "x.y" })] })).ok,
    ).toBe(true);
    expect(seen).toEqual([true, "trading.x.y", "trading"]);
  });

  it("normalizes stability values through the context", () => {
    const kind = rogue((_declaration, context) => [
      context.stability(undefined),
      context.stability("beta"),
      context.stability("stable", ["level"]),
    ]);
    const result = normalize(
      root({ declarations: [kind.declare({ name: "a" })] }),
    );
    expect(codesAndPaths(result)).toEqual([
      ["declaration.invalid-stability", ["declarations", 0, "level"]],
    ]);
  });

  it("ignores context calls made after normalize returned", () => {
    let saved: DeclarationContext | undefined;
    const kind = rogue((_declaration, context) => {
      saved = context;
      return null;
    });
    const result = normalize(
      root({ declarations: [kind.declare({ name: "a" })] }),
    );
    expect(result.ok).toBe(true);
    saved?.report("rogue.late", [], "late");
    expect(saved?.resolve("missing")).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });
});

describe("phases (T10)", () => {
  it("does not run kinds when phase 1 or 2 found an error", () => {
    const spy = vi.fn(normalizeProbe);
    const spied = createProbeKind(spy);
    const result = normalize(
      root({ version: "1.0", declarations: [spied.declare({ name: "a" })] }),
    );
    expect(codesAndPaths(result)).toEqual([
      ["contract.invalid-version", ["version"]],
    ]);
    expect(spy).not.toHaveBeenCalled();

    const second = normalize(
      root({
        declarations: [
          spied.declare({ name: "a" }),
          spied.declare({ name: "a" }),
        ],
      }),
    );
    expect(codesAndPaths(second)).toEqual([
      ["name.duplicate", ["declarations", 1, "name"]],
    ]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("checks every declaration when one of them has an error in its spec", () => {
    const spy = vi.fn(normalizeProbe);
    const spied = createProbeKind(spy);
    const result = normalize(
      root({
        declarations: [
          spied.declare({ name: "a", refs: ["missing"] }),
          spied.declare({ name: "b", output: z.date() }),
          spied.declare({ name: "c", refs: ["a"] }),
        ],
      }),
    );
    expect(spy).toHaveBeenCalledTimes(3);
    expect(codesAndPaths(result)).toEqual([
      ["reference.unknown", ["declarations", 0, "refs", 0]],
      ["schema.unrepresentable", ["declarations", 1, "output"]],
    ]);
  });

  it("gives the same diagnostics on every run", () => {
    const input = root({
      version: "x",
      permissions: { "Bad name": {}, ok: { subjects: [] } },
      declarations: [
        { name: "a" },
        defineProbe({ name: "b", requires: ["nope"] }),
      ],
    });
    expect(normalize(input).diagnostics).toEqual(normalize(input).diagnostics);
    expect(normalize(input).diagnostics.length).toBe(5);
  });
});

describe("the core keeps kinds in line (T13)", () => {
  it("refuses a function, undefined, a class instance or a cycle in the output", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [1];
    sparse[2] = 3;
    for (const output of [
      { run: () => 1 },
      undefined,
      { a: undefined },
      new Date(0),
      { n: NaN },
      sparse,
      cyclic,
      1n,
    ]) {
      const result = normalize(
        root({ declarations: [rogue(() => output).declare({ name: "a" })] }),
      );
      expect(codesAndPaths(result)).toEqual([
        ["descriptor.non-json-output", ["declarations", 0]],
      ]);
    }
  });

  it("refuses a code without the kind's prefix or missing from its catalog", () => {
    const catalog = {
      "rogue.known": { severity: "error" as const, summary: "Known." },
    };
    for (const code of [
      "probe.unusual",
      "rogue.unknown",
      "root.invalid-shape",
      "rogue",
      42,
    ]) {
      const kind = rogue(
        (_declaration, context) => {
          context.report(code as string, [], "x");
          return null;
        },
        "rogue",
        catalog,
      );
      const result = normalize(
        root({ declarations: [kind.declare({ name: "a" })] }),
      );
      expect(codesAndPaths(result)).toEqual([
        ["descriptor.undeclared-code", ["declarations", 0]],
      ]);
    }
    const ok = rogue(
      (_declaration, context) => {
        context.report("rogue.known", ["field"], "x");
        return null;
      },
      "rogue",
      catalog,
    );
    expect(
      codesAndPaths(
        normalize(root({ declarations: [ok.declare({ name: "a" })] })),
      ),
    ).toEqual([["rogue.known", ["declarations", 0, "field"]]]);
  });

  it("refuses a code of its catalog that lacks the kind's prefix", () => {
    const catalog = {
      "rogue.known": { severity: "error" as const, summary: "Known." },
      "other.code": { severity: "error" as const, summary: "Foreign." },
      "probe.unusual": { severity: "warning" as const, summary: "Foreign." },
      "root.invalid-shape": {
        severity: "warning" as const,
        summary: "A core code.",
      },
    };
    for (const code of ["other.code", "probe.unusual", "root.invalid-shape"]) {
      const kind = rogue(
        (_declaration, context) => {
          context.report(code, ["field"], "x");
          return null;
        },
        "rogue",
        catalog,
      );
      const result = normalize(
        root({ declarations: [kind.declare({ name: "a" })] }),
      );
      expect(codesAndPaths(result)).toEqual([
        ["descriptor.undeclared-code", ["declarations", 0]],
      ]);
    }
  });

  it("turns an exception into descriptor.failed and goes on", () => {
    const kind = rogue((declaration) => {
      if (declaration.name === "a") throw new Error("boom");
      return null;
    });
    const result = normalize(
      root({
        declarations: [
          kind.declare({ name: "a" }),
          kind.declare({ name: "b" }),
        ],
      }),
    );
    expect(codesAndPaths(result)).toEqual([
      ["descriptor.failed", ["declarations", 0]],
    ]);
    const thrower = rogue(() => {
      throw "not an error";
    });
    expect(
      codesAndPaths(
        normalize(root({ declarations: [thrower.declare({ name: "a" })] })),
      ),
    ).toEqual([["descriptor.failed", ["declarations", 0]]]);
  });

  it("refuses two descriptors with one id, among kinds and extensions alike", () => {
    const first = rogue(() => null, "twin");
    const second = rogue(() => null, "twin");
    expect(
      codesAndPaths(
        normalize(
          root({
            declarations: [
              first.declare({ name: "a" }),
              second.declare({ name: "b" }),
              first.declare({ name: "c" }),
              second.declare({ name: "d" }),
            ],
          }),
        ),
      ),
    ).toEqual([
      ["descriptor.conflict", ["declarations", 1]],
      ["descriptor.conflict", ["declarations", 3]],
    ]);
    const extension = defineExtension({
      id: "twin",
      names: () => [],
      normalize: () => null,
      changes: { fields: {} },
      diagnostics: {},
    });
    expect(
      codesAndPaths(
        normalize(
          root({
            declarations: [first.declare({ name: "a" })],
            extensions: [extension.declare({})],
          }),
        ),
      ),
    ).toEqual([["descriptor.conflict", ["extensions", 0]]]);
  });

  it("refuses reserved and malformed ids", () => {
    for (const id of ["permission", "root", "schema", "Source", "a_b", ""]) {
      const result = normalize(
        root({ declarations: [rogue(() => null, id).declare({ name: "a" })] }),
      );
      expect(codesAndPaths(result)).toEqual([
        ["descriptor.reserved-id", ["declarations", 0]],
      ]);
    }
  });

  it("refuses a change table outside the closed set", () => {
    const kind = defineDeclarationKind({
      kind: "rogue",
      normalize: () => null,
      changes: { fields: { a: { rule: "major" } } } as never,
      diagnostics: {},
    });
    const result = normalize(
      root({
        declarations: [
          kind.declare({ name: "a" }),
          kind.declare({ name: "b" }),
        ],
      }),
    );
    expect(codesAndPaths(result)).toEqual([
      ["descriptor.invalid-changes", ["declarations", 0]],
    ]);
  });

  it("refuses a plain object in declarations", () => {
    const result = normalize(
      root({ declarations: [{ kind: "probe", name: "a" }] }),
    );
    expect(codesAndPaths(result)).toEqual([
      ["declaration.unknown-kind", ["declarations", 0]],
    ]);
  });

  it("refuses an extension section in declarations and a declaration in extensions", () => {
    const extension = defineExtension({
      id: "layout",
      names: () => [],
      normalize: () => null,
      changes: { fields: {} },
      diagnostics: {},
    });
    expect(
      codesAndPaths(
        normalize(
          root({
            declarations: [
              { ...extension.declare({}), kind: "layout", name: "a" },
            ],
          }),
        ),
      ),
    ).toEqual([["declaration.unknown-kind", ["declarations", 0]]]);
    expect(
      codesAndPaths(
        normalize(root({ extensions: [defineProbe({ name: "a" })] })),
      ),
    ).toEqual([["root.invalid-shape", ["extensions", 0]]]);
  });

  it("keeps the descriptor when a declaration is spread into a new one", () => {
    const base = defineProbe({ name: "a" });
    const result = normalize(
      root({ declarations: [{ ...base, name: "b", stability: "public" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.declarations["trading.b"]?.stability).toBe("public");
  });

  it("does not let a descriptor of a different kind claim a declaration", () => {
    const result = normalize(
      root({
        declarations: [{ ...defineProbe({ name: "a" }), kind: "source" }],
      }),
    );
    expect(codesAndPaths(result)).toEqual([
      ["declaration.invalid-envelope", ["declarations", 0]],
    ]);
  });
});
