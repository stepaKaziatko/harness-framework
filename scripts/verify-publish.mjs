#!/usr/bin/env node
// Checks that every publishable workspace package works when installed from
// its tarball, the way a consumer gets it from the registry: build, `pnpm
// pack`, one `npm install` of all tarballs into a temporary project outside
// the repository, then a bare `node` import from `dist`, a `tsc` check on
// `nodenext` resolution and a deep import that `exports` must refuse.
//
// The tests of the monorepo resolve packages to their sources and cannot see
// a broken `files` list or `exports` map; this script can.
//
// Usage: node scripts/verify-publish.mjs [--keep] [--skip-build] [--workspace <dir>]

import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  binNames,
  consumerManifest,
  consumerTsconfig,
  deepImportSpecifier,
  describeMissingEntries,
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
  typeCheckFileNames,
  typeCheckSource,
} from "./lib/verify-publish.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXIT_FAILED = 1;
const EXIT_INTERRUPTED = 130;
const OUTPUT_TAIL_LINES = 20;

const USAGE = `Usage: node scripts/verify-publish.mjs [--keep] [--skip-build] [--workspace <dir>]

Builds the workspace, packs every package that is not private, installs all
tarballs with one npm install into a temporary project outside the repository
and checks each package from there: bare node import, tsc on nodenext
resolution, and a deep import that "exports" must refuse.

  --keep              keep the temporary project and print its path
  --skip-build        do not run pnpm build first
  --workspace <dir>   workspace root to check (default: this repository)`;

class Interrupted extends Error {}

/** @param {string} message */
function log(message) {
  process.stderr.write(`verify-publish: ${message}\n`);
}

/**
 * @param {string} text
 * @returns {string}
 */
function tail(text) {
  return text.trimEnd().split(/\r?\n/).slice(-OUTPUT_TAIL_LINES).join("\n");
}

/**
 * Runs a command synchronously. A child killed by Ctrl-C aborts the run, so
 * the temporary directory is still removed.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, inherit?: boolean }} options
 * @returns {{ ok: boolean, stdout: string, stderr: string, detail: string }}
 */
function run(command, args, { cwd, inherit = false }) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.signal === "SIGINT" || result.signal === "SIGTERM") {
    throw new Interrupted(`${command} was interrupted`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const ok = !result.error && result.status === 0;
  const detail = result.error
    ? `${command} could not start: ${result.error.message}`
    : `${command} ${args.join(" ")} exited with ${result.status ?? result.signal}${
        inherit ? "" : `:\n${tail(`${stdout}\n${stderr}`)}`
      }`;
  return { ok, stdout, stderr, detail };
}

/**
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readManifest(path) {
  return JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
}

/**
 * @param {string} path
 * @param {unknown} value
 */
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The whole check. Returns the exit code; throws only on interruption.
 *
 * @param {string} workspace
 * @param {string} temp
 * @param {boolean} skipBuild
 * @returns {number}
 */
function verify(workspace, temp, skipBuild) {
  const started = Date.now();

  if (skipBuild) {
    log("skipping the build (--skip-build)");
  } else {
    log("building the workspace (pnpm build)");
    const build = run("pnpm", ["build"], { cwd: workspace, inherit: true });
    if (!build.ok) {
      log(`the build failed: ${build.detail}`);
      return EXIT_FAILED;
    }
  }

  const listing = run("pnpm", ["-r", "ls", "--json", "--depth", "-1"], {
    cwd: workspace,
  });
  if (!listing.ok) {
    log(`cannot list the workspace packages: ${listing.detail}`);
    return EXIT_FAILED;
  }
  const packages = selectPublishablePackages(
    listing.stdout,
    workspace,
    (path) => realpathSync(path),
  );
  if (packages.length === 0) {
    log(
      `no publishable packages found in ${workspace}: every workspace package is the root or private; nothing was verified`,
    );
    return EXIT_FAILED;
  }
  log(
    `checking ${packages.length} packages: ${packages.map((p) => p.name).join(", ")}`,
  );

  /** @type {import("./lib/verify-publish.mjs").PackageResult[]} */
  const results = packages.map(({ name }) => ({ name, failure: null }));
  const manifests = packages.map(({ path }) => readManifest(path));
  /** @type {Array<string | null>} */
  const tarballs = packages.map(() => null);

  // pack + contents
  packages.forEach((pkg, index) => {
    const result = results[index];
    const manifest = manifests[index];
    if (!result || !manifest) {
      return;
    }
    const destination = join(temp, "tarballs", String(index));
    mkdirSync(destination, { recursive: true });
    const pack = run("pnpm", ["pack", "--pack-destination", destination], {
      cwd: pkg.path,
    });
    const tarball = readdirSync(destination).find((file) =>
      file.endsWith(".tgz"),
    );
    if (!pack.ok || !tarball) {
      fail(
        result,
        "pack",
        pack.ok ? "pnpm pack produced no tarball" : pack.detail,
      );
      return;
    }
    const tarballPath = join(destination, tarball);
    tarballs[index] = tarballPath;
    const list = run("tar", ["-tzf", tarballPath], { cwd: temp });
    if (!list.ok) {
      fail(result, "contents", `cannot list the tarball: ${list.detail}`);
      return;
    }
    const missing = missingEntryFiles(
      manifestEntryFiles(manifest),
      parseTarList(list.stdout),
    );
    if (missing.length > 0) {
      fail(result, "contents", describeMissingEntries(missing));
    }
  });

  // install: all tarballs at once, so packages that depend on each other
  // resolve to the local tarballs instead of the registry
  const consumer = join(temp, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeJson(join(consumer, "package.json"), consumerManifest());
  const packed = tarballs.filter((tarball) => tarball !== null);
  if (packed.length > 0) {
    log(`installing ${packed.length} tarballs with npm into ${consumer}`);
    const install = run(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--loglevel=error",
        ...packed,
      ],
      { cwd: consumer },
    );
    if (!install.ok) {
      results.forEach((result) =>
        fail(
          result,
          "install",
          `npm install of the tarballs failed: ${install.detail}`,
        ),
      );
    }
  }
  results.forEach((result, index) => {
    const manifest = manifests[index];
    if (result.failure || !manifest) {
      return;
    }
    if (
      !exists(
        join(
          consumer,
          "node_modules",
          ...result.name.split("/"),
          "package.json",
        ),
      )
    ) {
      fail(
        result,
        "install",
        "the package is not in node_modules after npm install",
      );
      return;
    }
    const unlinked = binNames(manifest).filter(
      (bin) => !exists(join(consumer, "node_modules", ".bin", bin)),
    );
    if (unlinked.length > 0) {
      fail(
        result,
        "install",
        `bin ${unlinked.join(", ")} is not linked in node_modules/.bin after npm install`,
      );
    }
  });

  // import: bare node from the consumer project, entry point and deep import
  /** @type {Array<string | null>} */
  const nodeDeepImportFailures = results.map(() => null);
  results.forEach((result, index) => {
    if (result.failure) {
      return;
    }
    const probe = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        importProbeSource([result.name, deepImportSpecifier(result.name)]),
      ],
      { cwd: consumer },
    );
    const outcomes = parseProbeOutput(probe.stdout);
    if (!outcomes) {
      fail(
        result,
        "import",
        `node did not finish the import probe: ${probe.detail}`,
      );
      return;
    }
    const verdict = evaluateImportProbe(result.name, outcomes);
    if (verdict.importFailure) {
      fail(result, "import", verdict.importFailure);
    }
    nodeDeepImportFailures[index] = verdict.deepImportFailure;
  });

  // types + deep-import: one tsc run over a file pair per package
  const checked = results.filter((result) => !result.failure);
  if (checked.length > 0) {
    /** @type {string[]} */
    const files = [];
    checked.forEach((result, index) => {
      const names = typeCheckFileNames(index);
      writeFileSync(join(consumer, names.check), typeCheckSource(result.name));
      writeFileSync(
        join(consumer, names.deep),
        typeCheckSource(deepImportSpecifier(result.name)),
      );
      files.push(names.check, names.deep);
    });
    writeJson(join(consumer, "tsconfig.json"), consumerTsconfig(files));
    const tscPath = createRequire(import.meta.url).resolve(
      "typescript/bin/tsc",
    );
    log(`type-checking ${checked.length} packages with ${tscPath}`);
    const tsc = run(
      process.execPath,
      [tscPath, "-p", "tsconfig.json", "--pretty", "false"],
      {
        cwd: consumer,
      },
    );
    const diagnostics = parseTscDiagnostics(`${tsc.stdout}\n${tsc.stderr}`);
    const evaluation = evaluateTypeCheck(
      diagnostics,
      checked.map((result) => result.name),
    );
    if (
      evaluation.unattributed.length > 0 ||
      (!tsc.ok && diagnostics.length === 0)
    ) {
      const reason =
        evaluation.unattributed.length > 0
          ? evaluation.unattributed
              .map((diagnostic) => diagnostic.text)
              .join("; ")
          : tsc.detail;
      checked.forEach((result) =>
        fail(result, "types", `tsc failed: ${reason}`),
      );
    }
    checked.forEach((result, index) => {
      const verdict = evaluation.perPackage[index];
      if (verdict?.typesFailure) {
        fail(result, "types", verdict.typesFailure);
      }
      const nodeFailure = nodeDeepImportFailures[results.indexOf(result)];
      if (nodeFailure) {
        fail(result, "deep-import", nodeFailure);
      }
      if (verdict?.deepImportFailure) {
        fail(result, "deep-import", verdict.deepImportFailure);
      }
    });
  }

  for (const line of formatSummary(results, Date.now() - started)) {
    process.stdout.write(`verify-publish: ${line}\n`);
  }
  return results.some((result) => result.failure) ? EXIT_FAILED : 0;
}

function main() {
  /** @type {import("./lib/verify-publish.mjs").CliOptions} */
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    process.stderr.write(`${USAGE}\n`);
    process.exit(EXIT_FAILED);
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const workspace = resolve(options.workspace ?? REPOSITORY_ROOT);
  const temp = mkdtempSync(join(realpathSync(tmpdir()), "verify-publish-"));
  const cleanup = () => {
    if (options.keep) {
      log(`kept the temporary project: ${temp}`);
    } else {
      rmSync(temp, { recursive: true, force: true });
    }
  };
  const onSignal = () => {
    cleanup();
    process.exit(EXIT_INTERRUPTED);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  /** @type {number} */
  let exitCode;
  try {
    exitCode = verify(workspace, temp, options.skipBuild);
  } catch (error) {
    if (error instanceof Interrupted) {
      log(error.message);
      exitCode = EXIT_INTERRUPTED;
    } else {
      log(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      exitCode = EXIT_FAILED;
    }
  } finally {
    cleanup();
  }
  process.exit(exitCode);
}

main();
