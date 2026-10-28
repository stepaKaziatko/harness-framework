import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const eslint = new ESLint({ cwd: repositoryRoot });

async function restrictedImports(
  filePath: string,
  specifier: string,
): Promise<number> {
  const [result] = await eslint.lintText(
    `import { probe } from "${specifier}";\nexport { probe };\n`,
    { filePath },
  );
  return (result?.messages ?? []).filter(
    (message) => message.ruleId === "no-restricted-imports",
  ).length;
}

const CORE = "packages/contract/src/core/probe.ts";

describe("direction of dependencies in @paddockjs/contract", () => {
  it.each([
    "../presentation/x.js",
    "../kinds/source/index.js",
    "../versioning/x.js",
    "../index.js",
    "zod",
    "zod/v4",
    "semver",
    "node:fs",
    "@paddockjs/react",
  ])("refuses %s in the core", async (specifier) => {
    expect(await restrictedImports(CORE, specifier)).toBe(1);
  });

  it.each(["./other.js", "zod/v4/core"])(
    "allows %s in the core",
    async (specifier) => {
      expect(await restrictedImports(CORE, specifier)).toBe(0);
    },
  );

  it("refuses the presentation layer in the root entry point", async () => {
    const index = "packages/contract/src/index.ts";
    expect(await restrictedImports(index, "./presentation.js")).toBe(1);
    expect(await restrictedImports(index, "./presentation/widget.js")).toBe(1);
    expect(await restrictedImports(index, "./core/normalize.js")).toBe(0);
  });

  it("lets a kind import only the core", async () => {
    const kind = "packages/contract/src/kinds/source/index.ts";
    expect(await restrictedImports(kind, "../../core/normalize.js")).toBe(0);
    expect(await restrictedImports(kind, "./schema.js")).toBe(0);
    expect(await restrictedImports(kind, "../intent/index.js")).toBe(1);
    expect(await restrictedImports(kind, "../../presentation/x.js")).toBe(1);
    expect(await restrictedImports(kind, "../../versioning/x.js")).toBe(1);
    expect(await restrictedImports(kind, "react")).toBe(1);
  });

  it("lets versioning import only the core", async () => {
    const versioning = "packages/contract/src/versioning/compare.ts";
    expect(await restrictedImports(versioning, "../core/model.js")).toBe(0);
    expect(await restrictedImports(versioning, "../kinds/source/x.js")).toBe(1);
    expect(await restrictedImports(versioning, "../presentation/x.js")).toBe(1);
  });
});
