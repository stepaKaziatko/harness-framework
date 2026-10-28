import { describe, expect, it } from "vitest";
import { defineContract, normalize } from "../src/index.js";
import { isLocalName, isPath, isSegment } from "../src/core/names.js";
import { isContractVersion, isImportRange } from "../src/core/semver.js";
import { defineProbe } from "./support/test-kind.js";

describe("name segments", () => {
  it.each(["a", "quotes", "quotes-feed", "v2", "a1-b2", "x".repeat(32)])(
    "accepts %s",
    (segment) => expect(isSegment(segment)).toBe(true),
  );

  it.each([
    "",
    "Quotes",
    "quotes_feed",
    "a-1",
    "-a",
    "a-",
    "a--b",
    "1a",
    "a.b",
    "x".repeat(33),
    "é",
  ])("refuses %j", (segment) => expect(isSegment(segment)).toBe(false));
});

describe("local names", () => {
  it.each(["a", "quotes-feed", "a.b.c", `${"x".repeat(32)}.b`])(
    "accepts %s",
    (name) => expect(isLocalName("trading", name)).toBe(true),
  );

  it.each([
    "a..b",
    "a.b.c.d",
    ".a",
    "a.",
    "Quotes",
    `${"a".repeat(28)}.${"b".repeat(28)}`,
  ])("refuses %j", (name) => expect(isLocalName("trading", name)).toBe(false));

  it("limits the qualified name to 64 characters", () => {
    const local55 = `${"a".repeat(27)}.${"b".repeat(27)}`; // 55 + "trading." (8) = 63
    expect(isLocalName("trading", local55)).toBe(true);
    expect(isLocalName("trading", `${local55}c`)).toBe(true); // 64
    expect(isLocalName("trading", `${local55}cc`)).toBe(false); // 65
    expect(isPath("a.b.c.d", 4)).toBe(true);
  });
});

describe("contract versions", () => {
  it.each([
    "0.1.0",
    "1.0.0",
    "1.0.0-rc.1",
    "1.0.0-alpha",
    "1.0.0-0.3.7",
    "10.20.30",
  ])("accepts %s", (version) => expect(isContractVersion(version)).toBe(true));

  it.each([
    "1.0",
    "01.0.0",
    "1.0.0+build",
    "1.0.0-rc.1+b",
    "v1.0.0",
    "1.0.0-01",
    "1.0.0-",
    " 1.0.0",
    "99999999999999999.0.0",
  ])("refuses %j", (version) => expect(isContractVersion(version)).toBe(false));
});

describe("import ranges", () => {
  it.each([
    "1.2.3",
    "^1.2.3",
    "~1.2.3",
    ">=1.2.3 <2.0.0",
    "^1.0.0 || ^2.0.0",
    "1.0.0 || >=2.0.0 <3.0.0",
  ])("accepts %s", (range) => expect(isImportRange(range)).toBe(true));

  it.each([
    "^1.x",
    ">=1.0.0",
    "^1.0.0-rc.1",
    "1.0.0 ||",
    "^01.0.0",
    "*",
    "1.2",
    ">1.0.0",
    "<=2.0.0",
    ">=1.0.0  <2.0.0",
    "^1.0.0||^2.0.0",
    "1.0.0 - 2.0.0",
    "",
  ])("refuses %j", (range) => expect(isImportRange(range)).toBe(false));
});

describe("valid forms pass normalize without diagnostics (T7)", () => {
  it.each(["0.1.0", "1.0.0-rc.1"])("version %s", (version) => {
    expect(
      normalize(defineContract({ name: "trading", version })),
    ).toMatchObject({ ok: true, diagnostics: [] });
  });

  it.each(["1.2.3", "^1.2.3", "~1.2.3", ">=1.2.3 <2.0.0", "^1.0.0 || ^2.0.0"])(
    "range %s",
    (range) => {
      const root = defineContract({
        name: "trading",
        version: "1.0.0",
        imports: [{ contract: "auth", range }],
      });
      expect(normalize(root)).toMatchObject({ ok: true, diagnostics: [] });
    },
  );

  it.each(["a", "quotes-feed", "a.b.c", "x".repeat(32)])("name %s", (name) => {
    const root = defineContract({
      name: "trading",
      version: "1.0.0",
      permissions: { [name]: {} },
      declarations: [defineProbe({ name })],
    });
    expect(normalize(root)).toMatchObject({ ok: true, diagnostics: [] });
  });

  it("keeps declarations and permissions in separate namespaces", () => {
    const root = defineContract({
      name: "trading",
      version: "1.0.0",
      permissions: { "orders.place": {} },
      declarations: [
        defineProbe({ name: "orders.place", requires: ["orders.place"] }),
      ],
    });
    expect(normalize(root)).toMatchObject({ ok: true, diagnostics: [] });
  });
});
