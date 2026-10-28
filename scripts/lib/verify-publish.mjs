// Pure helpers of scripts/verify-publish.mjs: no process spawning, no file
// system, no network. Everything here is covered by
// scripts/test/verify-publish.test.ts.
//
// Nothing in this file (or in the script) names a package or a scope: the
// packages are discovered from the workspace and every check is derived from
// their own package.json.

/**
 * Steps a package goes through, in order. A package stops at its first failed
 * step; the failure is reported with the step name.
 */
export const STEPS = /** @type {const} */ ([
  "pack",
  "contents",
  "install",
  "import",
  "types",
  "deep-import",
]);

/** @typedef {typeof STEPS[number]} Step */

/**
 * Subpath every package is probed with. It must stay unreachable: a package
 * exposes only what its `exports` declare.
 */
export const DEEP_IMPORT_SUBPATH = "src/index";

/** Error code node raises for a subpath that `exports` does not declare. */
export const NODE_NOT_EXPORTED_CODE = "ERR_PACKAGE_PATH_NOT_EXPORTED";

/** TypeScript diagnostic for a module it cannot resolve. */
export const TS_CANNOT_FIND_MODULE = "TS2307";

/** Marker of the line on which the import probe prints its result. */
export const PROBE_MARKER = "VERIFY_PUBLISH_PROBE ";

/**
 * @typedef {object} WorkspacePackage
 * @property {string} name
 * @property {string} path absolute directory of the package
 */

/**
 * Picks the packages that would be published from the output of
 * `pnpm -r ls --json --depth -1`: everything except the workspace root and
 * packages marked `private: true`.
 *
 * @param {string} lsOutput raw JSON printed by pnpm
 * @param {string} rootPath absolute path of the workspace root
 * @param {(path: string) => string} [normalizePath] maps a path to a
 *   comparable form (the script passes `realpathSync`)
 * @returns {WorkspacePackage[]}
 */
export function selectPublishablePackages(
  lsOutput,
  rootPath,
  normalizePath = (path) => path,
) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(lsOutput);
  } catch (error) {
    throw new Error(
      `cannot parse the workspace package list: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("the workspace package list is not a JSON array");
  }
  const root = normalizePath(rootPath);
  /** @type {WorkspacePackage[]} */
  const packages = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const {
      name,
      path,
      private: isPrivate,
    } = /** @type {Record<string, unknown>} */ (entry);
    if (typeof path !== "string" || normalizePath(path) === root) {
      continue;
    }
    if (isPrivate === true) {
      continue;
    }
    if (typeof name !== "string" || name === "") {
      throw new Error(`the workspace package at ${path} has no name`);
    }
    packages.push({ name, path });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @typedef {object} EntryFile
 * @property {string} field where the reference sits in package.json, for example `exports["."].import`
 * @property {string} target the referenced path as written
 * @property {string} file the path relative to the package root, without a leading `./`
 * @property {boolean} pattern whether `file` contains a `*` subpath pattern
 */

/**
 * @param {string} target
 * @returns {string}
 */
function normalizeTarget(target) {
  let file = target.replace(/\\/g, "/");
  while (file.startsWith("./")) {
    file = file.slice(2);
  }
  return file.replace(/^\/+/, "");
}

/**
 * @param {string} field
 * @param {string} target
 * @returns {EntryFile}
 */
function entry(field, target) {
  const file = normalizeTarget(target);
  return { field, target, file, pattern: file.includes("*") };
}

/**
 * Collects every string target of an `exports` value: plain strings, arrays
 * of fallbacks and nested subpath or condition objects. `null` targets
 * exclude a subpath and are skipped.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {EntryFile[]} into
 */
function collectExportTargets(value, field, into) {
  if (typeof value === "string") {
    into.push(entry(field, value));
  } else if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectExportTargets(item, `${field}[${index}]`, into),
    );
  } else if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      collectExportTargets(nested, `${field}[${JSON.stringify(key)}]`, into);
    }
  }
}

/**
 * Lists the files a package's manifest points at: `exports` (every subpath
 * and condition), `main`, `module`, `types`, `typings` and `bin`. Each of them
 * must be inside the tarball, otherwise a consumer gets a broken install.
 *
 * @param {Record<string, unknown>} manifest parsed package.json
 * @returns {EntryFile[]}
 */
export function manifestEntryFiles(manifest) {
  /** @type {EntryFile[]} */
  const files = [];
  if (manifest.exports !== undefined) {
    collectExportTargets(manifest.exports, "exports", files);
  }
  for (const field of ["main", "module", "types", "typings"]) {
    const value = manifest[field];
    if (typeof value === "string" && value !== "") {
      files.push(entry(field, value));
    }
  }
  const { bin } = manifest;
  if (typeof bin === "string" && bin !== "") {
    files.push(entry("bin", bin));
  } else if (typeof bin === "object" && bin !== null) {
    for (const [name, target] of Object.entries(bin)) {
      if (typeof target === "string" && target !== "") {
        files.push(entry(`bin[${JSON.stringify(name)}]`, target));
      }
    }
  }
  return files;
}

/**
 * Command names a package links into `node_modules/.bin` when installed.
 *
 * @param {Record<string, unknown>} manifest parsed package.json
 * @returns {string[]}
 */
export function binNames(manifest) {
  const { bin, name } = manifest;
  if (typeof bin === "string" && bin !== "" && typeof name === "string") {
    const slash = name.lastIndexOf("/");
    return [slash === -1 ? name : name.slice(slash + 1)];
  }
  if (typeof bin === "object" && bin !== null) {
    return Object.keys(bin);
  }
  return [];
}

/**
 * Turns `tar -tzf` output into the set of file paths relative to the package
 * root (the tarball's top-level directory, `package/` for npm and pnpm, is
 * stripped). Directory entries are dropped.
 *
 * @param {string} output
 * @returns {Set<string>}
 */
export function parseTarList(output) {
  /** @type {Set<string>} */
  const files = new Set();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (line === "" || line.endsWith("/")) {
      continue;
    }
    const slash = line.indexOf("/");
    if (slash === -1) {
      continue;
    }
    files.add(line.slice(slash + 1));
  }
  return files;
}

/**
 * @param {string} pattern a target with `*` placeholders
 * @returns {RegExp}
 */
function patternToRegExp(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+");
  return new RegExp(`^${escaped}$`);
}

/**
 * Entry files that the tarball does not contain. A `*` pattern is satisfied
 * by at least one matching file.
 *
 * @param {EntryFile[]} entries
 * @param {Set<string>} tarFiles
 * @returns {EntryFile[]}
 */
export function missingEntryFiles(entries, tarFiles) {
  return entries.filter((item) => {
    if (!item.pattern) {
      return !tarFiles.has(item.file);
    }
    const regexp = patternToRegExp(item.file);
    for (const file of tarFiles) {
      if (regexp.test(file)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * @param {EntryFile[]} missing
 * @returns {string}
 */
export function describeMissingEntries(missing) {
  return missing
    .map(
      (item) =>
        `${item.field} -> ${item.target} is not in the tarball (check "files" and the build output)`,
    )
    .join("; ");
}

/**
 * @param {string} name
 * @returns {string}
 */
export function deepImportSpecifier(name) {
  return `${name}/${DEEP_IMPORT_SUBPATH}`;
}

/** @returns {Record<string, unknown>} package.json of the consumer project */
export function consumerManifest() {
  return {
    name: "verify-publish-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
  };
}

/**
 * @param {number} index position of the package in the checked list
 * @returns {{ check: string, deep: string }}
 */
export function typeCheckFileNames(index) {
  return { check: `check-${index}.ts`, deep: `deep-${index}.ts` };
}

/**
 * tsconfig.json of the consumer project: what a strict ESM consumer on
 * `nodenext` resolution sees. No `paths`, no custom conditions, no global
 * types; declarations of the installed packages are checked too.
 *
 * @param {string[]} files
 * @returns {Record<string, unknown>}
 */
export function consumerTsconfig(files) {
  return {
    compilerOptions: {
      target: "ES2022",
      module: "nodenext",
      moduleResolution: "nodenext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    },
    files,
  };
}

/**
 * A namespace import, so the package's declarations are actually resolved and
 * checked (a bare side-effect import is not).
 *
 * @param {string} specifier
 * @returns {string}
 */
export function typeCheckSource(specifier) {
  return `import * as checked from ${JSON.stringify(specifier)};\nexport { checked };\n`;
}

/**
 * Source run by `node --input-type=module -e` inside the consumer project.
 * It imports each specifier and prints one marked JSON line with the
 * outcomes.
 *
 * @param {string[]} specifiers
 * @returns {string}
 */
export function importProbeSource(specifiers) {
  return [
    `const specifiers = ${JSON.stringify(specifiers)};`,
    "const results = [];",
    "for (const specifier of specifiers) {",
    "  try {",
    "    await import(specifier);",
    "    results.push({ specifier, ok: true });",
    "  } catch (error) {",
    "    results.push({ specifier, ok: false, code: error?.code ?? null, message: String(error?.message ?? error) });",
    "  }",
    "}",
    `process.stdout.write("\\n" + ${JSON.stringify(PROBE_MARKER)} + JSON.stringify(results) + "\\n");`,
  ].join("\n");
}

/**
 * @typedef {object} ProbeResult
 * @property {string} specifier
 * @property {boolean} ok
 * @property {string | null} [code]
 * @property {string} [message]
 */

/**
 * Reads the probe's marked line from its stdout.
 *
 * @param {string} stdout
 * @returns {ProbeResult[] | null} null when the probe did not report
 */
export function parseProbeOutput(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(PROBE_MARKER));
  const last = lines.at(-1);
  if (last === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(last.slice(PROBE_MARKER.length));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Judges the probe of one package: the entry point must import, the deep
 * subpath must be refused by `exports`.
 *
 * @param {string} name
 * @param {ProbeResult[]} results
 * @returns {{ importFailure: string | null, deepImportFailure: string | null }}
 */
export function evaluateImportProbe(name, results) {
  const main = results.find((result) => result.specifier === name);
  const deepSpecifier = deepImportSpecifier(name);
  const deep = results.find((result) => result.specifier === deepSpecifier);
  let importFailure = null;
  if (!main) {
    importFailure = `node did not report on import("${name}")`;
  } else if (!main.ok) {
    importFailure =
      `import("${name}") failed with ${main.code ?? "an error"}: ${main.message ?? ""}`.trim();
  }
  let deepImportFailure = null;
  if (!deep) {
    deepImportFailure = `node did not report on import("${deepSpecifier}")`;
  } else if (deep.ok) {
    deepImportFailure = `import("${deepSpecifier}") succeeded; the package exposes files that its "exports" do not declare`;
  } else if (deep.code !== NODE_NOT_EXPORTED_CODE) {
    deepImportFailure =
      `import("${deepSpecifier}") failed with ${deep.code ?? "an error"} instead of ${NODE_NOT_EXPORTED_CODE}; the subpath is not blocked by "exports": ${deep.message ?? ""}`.trim();
  }
  return { importFailure, deepImportFailure };
}

/**
 * @typedef {object} TscDiagnostic
 * @property {string} file path as tsc printed it (relative to the project)
 * @property {string} code for example `TS2307`
 * @property {string} text the whole first line of the diagnostic
 */

/**
 * Parses `tsc --pretty false` output. Continuation lines of multi-line
 * messages are ignored; global diagnostics (no file) get an empty `file`.
 *
 * @param {string} output
 * @returns {TscDiagnostic[]}
 */
export function parseTscDiagnostics(output) {
  /** @type {TscDiagnostic[]} */
  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    const located = /^(.+?)\(\d+,\d+\): error (TS\d+): /.exec(line);
    if (located) {
      const [, file = "", code = ""] = located;
      diagnostics.push({ file: file.replace(/\\/g, "/"), code, text: line });
      continue;
    }
    const global = /^error (TS\d+): /.exec(line);
    if (global) {
      diagnostics.push({ file: "", code: global[1] ?? "", text: line });
    }
  }
  return diagnostics;
}

/**
 * Splits the diagnostics of the consumer project between the checked
 * packages and judges each of them: its namespace import and its declarations
 * must be error-free, its deep import must fail with exactly TS2307.
 *
 * @param {TscDiagnostic[]} diagnostics
 * @param {string[]} names checked packages; index i owns `check-i.ts` and `deep-i.ts`
 * @returns {{ perPackage: Array<{ typesFailure: string | null, deepImportFailure: string | null }>, unattributed: TscDiagnostic[] }}
 */
export function evaluateTypeCheck(diagnostics, names) {
  const perPackage = names.map(() => ({
    /** @type {TscDiagnostic[]} */ types: [],
    /** @type {TscDiagnostic[]} */ deep: [],
  }));
  /** @type {TscDiagnostic[]} */
  const unattributed = [];
  for (const diagnostic of diagnostics) {
    const owner = names.findIndex((name, index) => {
      const files = typeCheckFileNames(index);
      return (
        diagnostic.file === files.check ||
        diagnostic.file === files.deep ||
        diagnostic.file.startsWith(`node_modules/${name}/`)
      );
    });
    const bucket = perPackage[owner];
    if (!bucket) {
      unattributed.push(diagnostic);
    } else if (diagnostic.file === typeCheckFileNames(owner).deep) {
      bucket.deep.push(diagnostic);
    } else {
      bucket.types.push(diagnostic);
    }
  }
  return {
    perPackage: perPackage.map((bucket, index) => {
      const name = names[index] ?? "";
      const typesFailure =
        bucket.types.length > 0
          ? bucket.types.map((diagnostic) => diagnostic.text).join("; ")
          : null;
      const notFound = bucket.deep.filter(
        (diagnostic) => diagnostic.code === TS_CANNOT_FIND_MODULE,
      );
      const other = bucket.deep.filter(
        (diagnostic) => diagnostic.code !== TS_CANNOT_FIND_MODULE,
      );
      let deepImportFailure = null;
      if (notFound.length === 0) {
        deepImportFailure = `tsc resolved "${deepImportSpecifier(name)}" instead of refusing it with ${TS_CANNOT_FIND_MODULE}; the package exposes types that its "exports" do not declare`;
      } else if (other.length > 0) {
        deepImportFailure = other
          .map((diagnostic) => diagnostic.text)
          .join("; ");
      }
      return { typesFailure, deepImportFailure };
    }),
    unattributed,
  };
}

/**
 * @typedef {object} PackageResult
 * @property {string} name
 * @property {{ step: Step, reason: string } | null} failure
 */

/**
 * Records a failure unless the package already failed at an earlier step.
 *
 * @param {PackageResult} result
 * @param {Step} step
 * @param {string} reason
 */
export function fail(result, step, reason) {
  if (!result.failure) {
    result.failure = { step, reason };
  }
}

/**
 * Lines of the final report: one per package, then the verdict.
 *
 * @param {PackageResult[]} results
 * @param {number} elapsedMs
 * @returns {string[]}
 */
export function formatSummary(results, elapsedMs) {
  const lines = results.map((result) =>
    result.failure
      ? `FAIL ${result.name} [${result.failure.step}] ${result.failure.reason}`
      : `ok   ${result.name}: packed, installed from the tarball, imported from dist, types pass, deep import refused`,
  );
  const failed = results.filter((result) => result.failure);
  const seconds = (elapsedMs / 1000).toFixed(1);
  lines.push(
    failed.length === 0
      ? `${results.length} of ${results.length} packages passed in ${seconds}s`
      : `${failed.length} of ${results.length} packages failed in ${seconds}s: ${failed.map((result) => result.name).join(", ")}`,
  );
  return lines;
}

/**
 * @typedef {object} CliOptions
 * @property {boolean} help
 * @property {boolean} keep keep the temporary directory and print its path
 * @property {boolean} skipBuild do not run `pnpm build` first
 * @property {string | undefined} workspace workspace root; defaults to the repository root
 */

/**
 * @param {string[]} argv arguments after the script path
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  /** @type {CliOptions} */
  const options = {
    help: false,
    keep: false,
    skipBuild: false,
    workspace: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--keep") {
      options.keep = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--workspace") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--workspace requires a directory");
      }
      options.workspace = value;
      i += 1;
    } else if (arg?.startsWith("--workspace=")) {
      options.workspace = arg.slice("--workspace=".length);
      if (!options.workspace) {
        throw new Error("--workspace requires a directory");
      }
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}
