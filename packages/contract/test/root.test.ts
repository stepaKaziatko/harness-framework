import { describe, expect, it } from "vitest";
import { defineContract, normalize } from "../src/index.js";

/** A copy of plain objects and arrays; other values are kept by reference. */
function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshot);
  if (typeof value === "object" && value !== null) {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const copy: Record<string | symbol, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      const item = (value as Record<string | symbol, unknown>)[key];
      // Symbol keys hold descriptors, which are compared by reference.
      copy[key] = typeof key === "symbol" ? item : snapshot(item);
    }
    return copy;
  }
  return value;
}

function frozenPlainValues(value: unknown, path = "$"): string[] {
  if (typeof value !== "object" || value === null) return [];
  const proto: unknown = Object.getPrototypeOf(value);
  const plain =
    Array.isArray(value) || proto === Object.prototype || proto === null;
  if (!plain) return [];
  const own = Object.isFrozen(value) ? [] : [path];
  return own.concat(
    Object.entries(value).flatMap(([key, item]) =>
      frozenPlainValues(item, `${path}.${key}`),
    ),
  );
}

const rootInput = {
  name: "trading",
  version: "0.1.0",
  imports: [{ contract: "auth", range: "^1.4.0" }],
  permissions: {
    "quotes.read": { description: "Read market quotes" },
    "orders.place": { subjects: [{ kind: "end-user" }] },
  },
} as const;

describe("defineContract", () => {
  it("returns a deeply frozen root (T5)", () => {
    const root = defineContract(rootInput);
    expect(Object.isFrozen(root)).toBe(true);
    expect(frozenPlainValues(root)).toEqual([]);
  });

  it("does not freeze or change its input", () => {
    const input = {
      name: "plain",
      version: "1.0.0",
      permissions: { read: {} },
    };
    const root = defineContract(input);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.permissions)).toBe(false);
    expect(root).toEqual(input);
    expect(root).not.toBe(input);
  });

  it("does not throw on any input", () => {
    for (const input of [null, 42, "x", [], {}, { name: 1 }]) {
      expect(() => defineContract(input as never)).not.toThrow();
    }
    const cyclic: Record<string, unknown> = { name: "cycle", version: "1.0.0" };
    cyclic.self = cyclic;
    expect(() => defineContract(cyclic as never)).not.toThrow();
  });
});

describe("normalize", () => {
  it("does not change its input (T5)", () => {
    const input = {
      ...rootInput,
      imports: [...rootInput.imports],
      permissions: { ...rootInput.permissions },
    };
    const before = snapshot(input);
    expect(normalize(input).ok).toBe(true);
    expect(input).toEqual(before);
  });

  it("materializes the default subject of a permission (T3)", () => {
    const result = normalize(
      defineContract({
        name: "defaults",
        version: "1.0.0",
        permissions: { read: {} },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.permissions["defaults.read"]).toStrictEqual({
      subjects: [{ kind: "end-user" }],
    });
  });

  it.each([null, 42, "x", [], true, undefined, () => 1, new Date(0)])(
    "refuses %s as a root without throwing (T8)",
    (input) => {
      const result = normalize(input);
      expect(result).toEqual({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code: "root.invalid-shape",
            path: [],
            severity: "error",
          }),
        ],
      });
    },
  );

  it("refuses an empty object with the missing identity (T8)", () => {
    const result = normalize({});
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["root.invalid-shape", ["name"]],
      ["root.invalid-shape", ["version"]],
    ]);
  });

  it("refuses root fields of the wrong type (T8)", () => {
    const result = normalize({
      name: 1,
      version: null,
      imports: {},
      permissions: [],
      declarations: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["root.invalid-shape", ["name"]],
      ["root.invalid-shape", ["version"]],
      ["root.invalid-shape", ["imports"]],
      ["root.invalid-shape", ["permissions"]],
      ["root.invalid-shape", ["declarations"]],
    ]);
  });

  it("refuses an unknown root field instead of ignoring it (T8)", () => {
    const result = normalize({
      name: "typo",
      version: "1.0.0",
      permisions: {},
    });
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "root.unknown-field",
          path: ["permisions"],
        }),
      ],
    });
  });

  it("refuses unknown fields of imports, permissions and subjects", () => {
    const result = normalize({
      name: "strict",
      version: "1.0.0",
      imports: [{ contract: "auth", range: "1.0.0", version: "1" }],
      permissions: {
        read: { subject: [] },
        write: { subjects: [{ kind: "end-user", id: "x" }] },
      },
    });
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["root.invalid-shape", ["imports", 0, "version"]],
      ["root.invalid-shape", ["permissions", "read", "subject"]],
      ["root.invalid-shape", ["permissions", "write", "subjects", 0, "id"]],
    ]);
  });

  it("never throws on readers that throw", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no keys");
        },
      },
    );
    const result = normalize(hostile);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.at(-1)?.code).toBe("root.invalid-shape");
  });
});
