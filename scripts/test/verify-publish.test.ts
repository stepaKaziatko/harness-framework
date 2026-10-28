import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  STEPS,
  binNames,
  consumerTsconfig,
  deepImportSpecifier,
  evaluateImportProbe,
  evaluateTypeCheck,
  fail,
  formatSummary,
  importProbeSource,
  manifestEntryFiles,
  missingEntryFiles,
  parseArgs,
  parseProbeOutput,
  parseTarList,
  parseTscDiagnostics,
  selectPublishablePackages,
  typeCheckSource,
  type PackageResult,
} from "../lib/verify-publish.mjs";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(REPOSITORY_ROOT, "scripts/verify-publish.mjs");

describe("selectPublishablePackages", () => {
  const ls = JSON.stringify([
    { name: "root", path: "/ws", private: true },
    {
      name: "@a/one",
      version: "0.0.0",
      path: "/ws/packages/one",
      private: false,
    },
    { name: "@a/hidden", path: "/ws/packages/hidden", private: true },
    { name: "plain", path: "/ws/packages/plain" },
  ]);

  it("drops the root and private packages and sorts by name", () => {
    expect(selectPublishablePackages(ls, "/ws")).toEqual([
      { name: "@a/one", path: "/ws/packages/one" },
      { name: "plain", path: "/ws/packages/plain" },
    ]);
  });

  it("drops a non-private root too", () => {
    const list = JSON.stringify([
      { name: "root", path: "/ws", private: false },
    ]);
    expect(selectPublishablePackages(list, "/ws")).toEqual([]);
  });

  it("compares paths in normalized form", () => {
    const list = JSON.stringify([
      { name: "root", path: "/private/ws", private: false },
      { name: "x", path: "/private/ws/packages/x", private: false },
    ]);
    const normalize = (path: string) => path.replace(/^\/private/, "");
    expect(selectPublishablePackages(list, "/ws", normalize)).toEqual([
      { name: "x", path: "/private/ws/packages/x" },
    ]);
  });

  it("returns an empty list when everything is private", () => {
    const list = JSON.stringify([
      { name: "root", path: "/ws", private: true },
      { name: "a", path: "/ws/a", private: true },
    ]);
    expect(selectPublishablePackages(list, "/ws")).toEqual([]);
  });

  it("rejects output that is not a JSON array", () => {
    expect(() => selectPublishablePackages("nope", "/ws")).toThrow(
      /cannot parse/,
    );
    expect(() => selectPublishablePackages("{}", "/ws")).toThrow(
      /not a JSON array/,
    );
  });

  it("rejects a publishable package without a name", () => {
    const list = JSON.stringify([{ path: "/ws/a", private: false }]);
    expect(() => selectPublishablePackages(list, "/ws")).toThrow(/no name/);
  });
});

describe("manifestEntryFiles", () => {
  it("walks nested subpaths, conditions and fallbacks of exports", () => {
    const files = manifestEntryFiles({
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./feature": ["./dist/feature.js", { default: "./dist/feature.cjs" }],
        "./internal/*": null,
        "./utils/*": "./dist/utils/*.js",
        "./package.json": "./package.json",
      },
    });
    expect(files).toEqual([
      {
        field: 'exports["."]["types"]',
        target: "./dist/index.d.ts",
        file: "dist/index.d.ts",
        pattern: false,
      },
      {
        field: 'exports["."]["import"]',
        target: "./dist/index.js",
        file: "dist/index.js",
        pattern: false,
      },
      {
        field: 'exports["./feature"][0]',
        target: "./dist/feature.js",
        file: "dist/feature.js",
        pattern: false,
      },
      {
        field: 'exports["./feature"][1]["default"]',
        target: "./dist/feature.cjs",
        file: "dist/feature.cjs",
        pattern: false,
      },
      {
        field: 'exports["./utils/*"]',
        target: "./dist/utils/*.js",
        file: "dist/utils/*.js",
        pattern: true,
      },
      {
        field: 'exports["./package.json"]',
        target: "./package.json",
        file: "package.json",
        pattern: false,
      },
    ]);
  });

  it("reads a string exports and the legacy fields", () => {
    expect(
      manifestEntryFiles({
        exports: "./index.js",
        main: "lib/main.js",
        module: "./esm/index.js",
        types: "./types/index.d.ts",
        typings: "typings.d.ts",
      }).map((item) => [item.field, item.file]),
    ).toEqual([
      ["exports", "index.js"],
      ["main", "lib/main.js"],
      ["module", "esm/index.js"],
      ["types", "types/index.d.ts"],
      ["typings", "typings.d.ts"],
    ]);
  });

  it("reads bin as a string and as an object", () => {
    expect(manifestEntryFiles({ bin: "./bin/cli.js" })).toEqual([
      {
        field: "bin",
        target: "./bin/cli.js",
        file: "bin/cli.js",
        pattern: false,
      },
    ]);
    expect(
      manifestEntryFiles({
        bin: { one: "./bin/one.js", two: "bin/two.js" },
      }).map((item) => [item.field, item.file]),
    ).toEqual([
      ['bin["one"]', "bin/one.js"],
      ['bin["two"]', "bin/two.js"],
    ]);
  });

  it("returns nothing for a manifest without entry points", () => {
    expect(manifestEntryFiles({ name: "x" })).toEqual([]);
  });
});

describe("binNames", () => {
  it("uses the unscoped package name for a string bin", () => {
    expect(binNames({ name: "@scope/tool", bin: "./cli.js" })).toEqual([
      "tool",
    ]);
    expect(binNames({ name: "tool", bin: "./cli.js" })).toEqual(["tool"]);
  });

  it("uses the keys of an object bin", () => {
    expect(
      binNames({ name: "@scope/tool", bin: { a: "./a.js", b: "./b.js" } }),
    ).toEqual(["a", "b"]);
  });

  it("is empty without bin", () => {
    expect(binNames({ name: "x" })).toEqual([]);
  });
});

describe("parseTarList and missingEntryFiles", () => {
  const tarFiles = parseTarList(
    [
      "package/package.json",
      "package/dist/",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/dist/utils/a.js",
      "",
    ].join("\n"),
  );

  it("strips the top-level directory and drops directories", () => {
    expect([...tarFiles].sort()).toEqual([
      "dist/index.d.ts",
      "dist/index.js",
      "dist/utils/a.js",
      "package.json",
    ]);
  });

  it("finds entry files that the tarball lacks", () => {
    const entries = manifestEntryFiles({
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./utils/*": "./dist/utils/*.js",
        "./gone/*": "./dist/gone/*.js",
        "./package.json": "./package.json",
      },
      bin: { tool: "./dist/bin.js" },
    });
    expect(
      missingEntryFiles(entries, tarFiles).map((item) => item.field),
    ).toEqual(['exports["./gone/*"]', 'bin["tool"]']);
  });

  it("reports every file as missing from a tarball without dist", () => {
    const entries = manifestEntryFiles({
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      },
    });
    expect(
      missingEntryFiles(entries, parseTarList("package/package.json\n")).map(
        (item) => item.file,
      ),
    ).toEqual(["dist/index.d.ts", "dist/index.js"]);
  });
});

describe("import probe", () => {
  it("generates a script that reports on every specifier", () => {
    const source = importProbeSource(["@a/one", "@a/one/src/index"]);
    expect(source).toContain('["@a/one","@a/one/src/index"]');
    expect(source).toContain("VERIFY_PUBLISH_PROBE ");
  });

  it("reads the last marked line and ignores the rest of stdout", () => {
    const stdout =
      'noise\nVERIFY_PUBLISH_PROBE [{"specifier":"a","ok":true}]\n';
    expect(parseProbeOutput(stdout)).toEqual([{ specifier: "a", ok: true }]);
    expect(parseProbeOutput("noise only")).toBeNull();
    expect(parseProbeOutput("VERIFY_PUBLISH_PROBE {broken")).toBeNull();
  });

  it("accepts an importable entry and a refused deep import", () => {
    expect(
      evaluateImportProbe("@a/one", [
        { specifier: "@a/one", ok: true },
        {
          specifier: "@a/one/src/index",
          ok: false,
          code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
          message: "x",
        },
      ]),
    ).toEqual({ importFailure: null, deepImportFailure: null });
  });

  it("fails an entry that does not import", () => {
    const verdict = evaluateImportProbe("@a/one", [
      {
        specifier: "@a/one",
        ok: false,
        code: "ERR_MODULE_NOT_FOUND",
        message: "missing dist",
      },
      {
        specifier: "@a/one/src/index",
        ok: false,
        code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
      },
    ]);
    expect(verdict.importFailure).toMatch(/ERR_MODULE_NOT_FOUND: missing dist/);
  });

  it("fails a deep import that succeeds or fails for another reason", () => {
    expect(
      evaluateImportProbe("@a/one", [
        { specifier: "@a/one", ok: true },
        { specifier: "@a/one/src/index", ok: true },
      ]).deepImportFailure,
    ).toMatch(/succeeded; the package exposes files/);
    expect(
      evaluateImportProbe("@a/one", [
        { specifier: "@a/one", ok: true },
        {
          specifier: "@a/one/src/index",
          ok: false,
          code: "ERR_MODULE_NOT_FOUND",
        },
      ]).deepImportFailure,
    ).toMatch(/ERR_MODULE_NOT_FOUND instead of ERR_PACKAGE_PATH_NOT_EXPORTED/);
  });

  it("uses one deep subpath for every package", () => {
    expect(deepImportSpecifier("@a/one")).toBe("@a/one/src/index");
    expect(deepImportSpecifier("plain")).toBe("plain/src/index");
  });
});

describe("type check", () => {
  it("emits a consumer project on nodenext resolution", () => {
    expect(consumerTsconfig(["check-0.ts"])).toEqual({
      compilerOptions: {
        target: "ES2022",
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
      },
      files: ["check-0.ts"],
    });
  });

  it("uses a namespace import, not a side-effect import", () => {
    expect(typeCheckSource("@a/one")).toBe(
      'import * as checked from "@a/one";\nexport { checked };\n',
    );
  });

  it("parses located and global diagnostics", () => {
    const output = [
      "deep-0.ts(1,26): error TS2307: Cannot find module '@a/one/src/index' or its corresponding type declarations.",
      "node_modules/@a/two/dist/index.d.ts(1,30): error TS2304: Cannot find name 'Missing'.",
      "  continuation of a message",
      "error TS5058: The specified path does not exist.",
    ].join("\n");
    expect(parseTscDiagnostics(output).map((d) => [d.file, d.code])).toEqual([
      ["deep-0.ts", "TS2307"],
      ["node_modules/@a/two/dist/index.d.ts", "TS2304"],
      ["", "TS5058"],
    ]);
  });

  it("attributes diagnostics to packages and requires TS2307 on deep imports", () => {
    const diagnostics = parseTscDiagnostics(
      [
        "deep-0.ts(1,26): error TS2307: Cannot find module '@a/one/src/index'.",
        "node_modules/@a/two/dist/index.d.ts(1,30): error TS2304: Cannot find name 'Missing'.",
        "deep-1.ts(1,26): error TS2307: Cannot find module '@a/two/src/index'.",
        "check-2.ts(1,26): error TS7016: Could not find a declaration file for module '@a/three'.",
        "deep-2.ts(1,26): error TS2307: Cannot find module '@a/three/src/index'.",
        "error TS5058: The specified path does not exist.",
      ].join("\n"),
    );
    const { perPackage, unattributed } = evaluateTypeCheck(diagnostics, [
      "@a/one",
      "@a/two",
      "@a/three",
      "@a/four",
    ]);
    expect(perPackage[0]).toEqual({
      typesFailure: null,
      deepImportFailure: null,
    });
    expect(perPackage[1]?.typesFailure).toMatch(/TS2304/);
    expect(perPackage[2]?.typesFailure).toMatch(/TS7016/);
    expect(perPackage[3]?.deepImportFailure).toMatch(
      /tsc resolved "@a\/four\/src\/index" instead of refusing it with TS2307/,
    );
    expect(unattributed.map((d) => d.code)).toEqual(["TS5058"]);
  });

  it("fails a deep import that reports a different error than TS2307", () => {
    const diagnostics = parseTscDiagnostics(
      [
        "deep-0.ts(1,26): error TS2307: Cannot find module '@a/one/src/index'.",
        "deep-0.ts(2,1): error TS1128: Declaration or statement expected.",
      ].join("\n"),
    );
    expect(
      evaluateTypeCheck(diagnostics, ["@a/one"]).perPackage[0]
        ?.deepImportFailure,
    ).toMatch(/TS1128/);
  });
});

describe("results", () => {
  it("keeps the first failed step of a package", () => {
    const result: PackageResult = { name: "x", failure: null };
    fail(result, "contents", "first");
    fail(result, "types", "second");
    expect(result.failure).toEqual({ step: "contents", reason: "first" });
  });

  it("lists every failed package in the summary", () => {
    const lines = formatSummary(
      [
        { name: "a", failure: null },
        { name: "b", failure: { step: "contents", reason: "missing" } },
        { name: "c", failure: { step: "deep-import", reason: "exposed" } },
      ],
      1234,
    );
    expect(lines[0]).toMatch(/^ok {3}a: /);
    expect(lines[1]).toBe("FAIL b [contents] missing");
    expect(lines[2]).toBe("FAIL c [deep-import] exposed");
    expect(lines[3]).toBe("2 of 3 packages failed in 1.2s: b, c");
  });

  it("reports full success", () => {
    expect(formatSummary([{ name: "a", failure: null }], 0).at(-1)).toBe(
      "1 of 1 packages passed in 0.0s",
    );
  });

  it("names the steps in the order they run", () => {
    expect(STEPS).toEqual([
      "pack",
      "contents",
      "install",
      "import",
      "types",
      "deep-import",
    ]);
  });
});

describe("parseArgs", () => {
  it("defaults to a full run on this repository", () => {
    expect(parseArgs([])).toEqual({
      help: false,
      keep: false,
      skipBuild: false,
      workspace: undefined,
    });
  });

  it("reads the flags and --workspace in both forms", () => {
    expect(parseArgs(["--keep", "--skip-build", "--workspace", "/ws"])).toEqual(
      {
        help: false,
        keep: true,
        skipBuild: true,
        workspace: "/ws",
      },
    );
    expect(parseArgs(["--workspace=/ws"]).workspace).toBe("/ws");
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("rejects unknown arguments and --workspace without a value", () => {
    expect(() => parseArgs(["--force"])).toThrow(/unknown argument: --force/);
    expect(() => parseArgs(["--workspace"])).toThrow(/requires a directory/);
    expect(() => parseArgs(["--workspace", "--keep"])).toThrow(
      /requires a directory/,
    );
    expect(() => parseArgs(["--workspace="])).toThrow(/requires a directory/);
  });
});

// End-to-end runs of the script against fixture workspaces in a temporary
// directory. The fixture packages have no dependencies, so npm installs the
// tarballs without the registry.

type FixturePackage = {
  dir: string;
  manifest: Record<string, unknown>;
  files: Record<string, string>;
};

const INDEX_JS = "export const value = 1;\n";
const INDEX_DTS = "export declare const value: number;\n";
const ENTRY_EXPORTS = {
  ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  "./package.json": "./package.json",
};

function writeWorkspace(root: string, packages: FixturePackage[]): void {
  const { packageManager } = JSON.parse(
    readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
  ) as { packageManager: string };
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture-root", private: true, packageManager }),
  );
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n",
  );
  for (const pkg of packages) {
    const dir = join(root, "packages", pkg.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ version: "0.0.0", type: "module", ...pkg.manifest }),
    );
    for (const [file, content] of Object.entries(pkg.files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
  }
}

function runScript(workspace: string, tempRoot: string) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--skip-build", "--workspace", workspace],
    {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot },
    },
  );
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
    leftovers: readdirSync(tempRoot).filter((entry) =>
      entry.startsWith("verify-publish-"),
    ),
  };
}

describe("verify-publish on fixture workspaces", () => {
  let base: string;

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "verify-publish-test-")));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("reports every broken package and passes the sound one", () => {
    const workspace = join(base, "mixed");
    const tempRoot = join(base, "mixed-tmp");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(tempRoot, { recursive: true });
    writeWorkspace(workspace, [
      {
        dir: "good",
        manifest: {
          name: "@fixture/good",
          exports: ENTRY_EXPORTS,
          files: ["dist"],
          bin: { "fixture-good": "./dist/bin.js" },
        },
        files: {
          "dist/index.js": INDEX_JS,
          "dist/index.d.ts": INDEX_DTS,
          "dist/bin.js": "#!/usr/bin/env node\n",
          "src/index.ts": "export const value = 1;\n",
        },
      },
      {
        dir: "no-dist",
        manifest: {
          name: "@fixture/no-dist",
          exports: ENTRY_EXPORTS,
          files: ["src"],
        },
        files: {
          "dist/index.js": INDEX_JS,
          "dist/index.d.ts": INDEX_DTS,
          "src/index.ts": "export const value = 1;\n",
        },
      },
      {
        dir: "missing-files",
        manifest: {
          name: "@fixture/missing-files",
          exports: {
            ".": { types: "./dist/index.d.ts", import: "./dist/missing.js" },
          },
          types: "./dist/absent.d.ts",
          bin: "./dist/no-bin.js",
          files: ["dist"],
        },
        files: { "dist/index.js": INDEX_JS, "dist/index.d.ts": INDEX_DTS },
      },
      {
        dir: "wide-exports",
        manifest: {
          name: "@fixture/wide-exports",
          exports: { ...ENTRY_EXPORTS, "./*": "./*.js" },
          files: ["dist", "src"],
        },
        files: {
          "dist/index.js": INDEX_JS,
          "dist/index.d.ts": INDEX_DTS,
          "src/index.js": INDEX_JS,
          "src/index.d.ts": INDEX_DTS,
        },
      },
      {
        dir: "bad-types",
        manifest: {
          name: "@fixture/bad-types",
          exports: ENTRY_EXPORTS,
          files: ["dist"],
        },
        files: {
          "dist/index.js": INDEX_JS,
          "dist/index.d.ts": "export declare const value: MissingType;\n",
        },
      },
      {
        dir: "private",
        manifest: {
          name: "@fixture/private",
          private: true,
          exports: ENTRY_EXPORTS,
        },
        files: {},
      },
    ]);

    const { status, output, leftovers } = runScript(workspace, tempRoot);

    expect(status).toBe(1);
    expect(output).toMatch(/ok {3}@fixture\/good: /);
    expect(output).toMatch(
      /FAIL @fixture\/no-dist \[contents\] exports\["\."\]\["types"\] -> \.\/dist\/index\.d\.ts is not in the tarball/,
    );
    expect(output).toMatch(
      /FAIL @fixture\/missing-files \[contents\] .*exports\["\."\]\["import"\] -> \.\/dist\/missing\.js is not in the tarball.*types -> \.\/dist\/absent\.d\.ts.*bin -> \.\/dist\/no-bin\.js/,
    );
    expect(output).toMatch(
      /FAIL @fixture\/wide-exports \[deep-import\] import\("@fixture\/wide-exports\/src\/index"\) succeeded/,
    );
    expect(output).toMatch(
      /FAIL @fixture\/bad-types \[types\] .*TS2304: Cannot find name 'MissingType'/,
    );
    expect(output).not.toMatch(/@fixture\/private/);
    expect(output).toMatch(
      /4 of 5 packages failed in [\d.]+s: @fixture\/bad-types, @fixture\/missing-files, @fixture\/no-dist, @fixture\/wide-exports/,
    );
    expect(leftovers).toEqual([]);
  }, 120_000);

  it("refuses a workspace without publishable packages", () => {
    const workspace = join(base, "empty");
    const tempRoot = join(base, "empty-tmp");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(tempRoot, { recursive: true });
    writeWorkspace(workspace, [
      {
        dir: "only-private",
        manifest: { name: "@fixture/only-private", private: true },
        files: {},
      },
    ]);

    const { status, output, leftovers } = runScript(workspace, tempRoot);

    expect(status).toBe(1);
    expect(output).toMatch(/no publishable packages found/);
    expect(leftovers).toEqual([]);
  }, 60_000);
});
