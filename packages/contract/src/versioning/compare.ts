// compareModels: compares two normalized contract models and says which
// changes they differ by, how each is classified and which version bump that
// requires (ADR 0006). The tables of kinds and extensions are passed in; the
// engine knows no concrete kind.

import { isTable, type ChangeTable } from "../core/changes.js";
import type { Diagnostic, DiagnosticPath } from "../core/diagnostics.js";
import {
  NotJsonError,
  canonicalText,
  hasOwn,
  isPlainArray,
  isPlainObject,
  toCanonicalJson,
  type JsonObject,
} from "../core/json.js";
import { MODEL_FORMAT_VERSION } from "../core/model.js";
import { isSegment } from "../core/names.js";
import { isContractVersion } from "../core/semver.js";
import { describeError } from "../core/state.js";
import { requiredBumpOf, type RequiredBump } from "./bump.js";
import { compareSchemas } from "./schema.js";
import {
  comparisonDiagnosticCodes,
  type ComparisonDiagnosticCode,
} from "./codes.js";
import { walkModels, type Change, type Tables } from "./walk.js";

export type { RequiredBump } from "./bump.js";
export type { Change } from "./walk.js";

/**
 * The tables the comparison reads. A descriptor of a declaration kind and a
 * descriptor of an extension fit as they are.
 */
export interface CompareOptions {
  /** Tables of declaration kinds, by `kind`. */
  readonly kinds?: readonly {
    readonly kind: string;
    readonly changes: ChangeTable;
  }[];
  /** Tables of extension sections, by `id`. */
  readonly extensions?: readonly {
    readonly id: string;
    readonly changes: ChangeTable;
  }[];
}

/** The outcome of {@link compareModels}. */
export type ComparisonResult =
  | {
      /** True when there is no error among the diagnostics. */
      readonly ok: boolean;
      /** In a deterministic order: depth first, keys in code point order. */
      readonly changes: readonly Change[];
      readonly requiredBump: RequiredBump;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      /** A model could not be read or a table is invalid: nothing was compared. */
      readonly ok: false;
      readonly diagnostics: readonly Diagnostic[];
    };

class Diagnostics {
  readonly items: Diagnostic[] = [];

  add(code: ComparisonDiagnosticCode, path: DiagnosticPath, message: string) {
    this.items.push(
      Object.freeze({
        code,
        severity: comparisonDiagnosticCodes[code].severity,
        path: Object.freeze([...path]),
        message,
      }),
    );
  }
}

type Side = "previous" | "next";

/** The paths and messages of shape problems of a model, in a fixed order. */
function shapeProblems(model: JsonObject): [DiagnosticPath, string][] {
  const problems: [DiagnosticPath, string][] = [];
  const contract = model.contract;
  if (!isPlainObject(contract)) {
    problems.push([["contract"], "`contract` must be an object"]);
  } else {
    if (!isSegment(contract.name)) {
      problems.push([
        ["contract", "name"],
        "`contract.name` must be a valid contract name",
      ]);
    }
    if (!isContractVersion(contract.version)) {
      problems.push([
        ["contract", "version"],
        "`contract.version` must be SemVer 2.0.0 without build metadata",
      ]);
    }
  }
  for (const key of ["imports", "permissions", "declarations"]) {
    if (!isPlainObject(model[key])) {
      problems.push([[key], `\`${key}\` must be an object`]);
    }
  }
  const declarations = model.declarations;
  if (isPlainObject(declarations)) {
    for (const name of Object.keys(declarations)) {
      const declaration = declarations[name];
      if (!isPlainObject(declaration)) {
        problems.push([
          ["declarations", name],
          "a declaration must be an object",
        ]);
      } else if (typeof declaration.kind !== "string") {
        problems.push([
          ["declarations", name, "kind"],
          "the `kind` of a declaration must be a string",
        ]);
      }
    }
  }
  if (hasOwn(model, "extensions") && !isPlainObject(model.extensions)) {
    problems.push([["extensions"], "`extensions` must be an object"]);
  }
  return problems;
}

/**
 * Reads one model: plain JSON, then a known `formatVersion`, then the shape.
 * A known other format is reported without looking at the shape, since
 * another format may have another shape; a value that does not have the shape
 * of a model is not a model, whatever its `formatVersion`.
 */
function readModel(
  side: Side,
  value: unknown,
  diagnostics: Diagnostics,
): JsonObject | undefined {
  let model: unknown;
  try {
    model = toCanonicalJson(value);
  } catch (error) {
    const path = error instanceof NotJsonError ? error.path : [];
    diagnostics.add(
      "compare.invalid-model",
      [side, ...path],
      `the ${side} model is not plain JSON: ${describeError(error)}`,
    );
    return undefined;
  }
  if (!isPlainObject(model)) {
    diagnostics.add(
      "compare.invalid-model",
      [side],
      `the ${side} model must be an object`,
    );
    return undefined;
  }
  const hasFormat = hasOwn(model, "formatVersion");
  if (hasFormat && model.formatVersion !== MODEL_FORMAT_VERSION) {
    diagnostics.add(
      "compare.unsupported-format",
      [side, "formatVersion"],
      `the ${side} model has formatVersion ${JSON.stringify(model.formatVersion)}; only ${MODEL_FORMAT_VERSION} is supported`,
    );
    return undefined;
  }
  const problems = shapeProblems(model as JsonObject);
  for (const [path, message] of problems) {
    diagnostics.add(
      "compare.invalid-model",
      [side, ...path],
      `${side}: ${message}`,
    );
  }
  if (problems.length > 0) return undefined;
  if (!hasFormat) {
    diagnostics.add(
      "compare.unsupported-format",
      [side, "formatVersion"],
      `the ${side} model has no formatVersion`,
    );
    return undefined;
  }
  return model as JsonObject;
}

/** Reads `kinds` or `extensions` of the options into a map of tables by id. */
function readList(
  options: Record<string | symbol, unknown>,
  key: "kinds" | "extensions",
  idField: "kind" | "id",
  diagnostics: Diagnostics,
): Map<string, ChangeTable> {
  const tables = new Map<string, ChangeTable>();
  const texts = new Map<string, string>();
  const list = options[key];
  if (list === undefined) return tables;
  if (!isPlainArray(list)) {
    diagnostics.add(
      "compare.invalid-table",
      [key],
      `\`${key}\` must be an array`,
    );
    return tables;
  }
  list.forEach((entry: unknown, index) => {
    const path = [key, index];
    let id: unknown;
    let table: ChangeTable | undefined;
    try {
      if (typeof entry === "object" && entry !== null) {
        const record = entry as Record<string, unknown>;
        id = record[idField];
        if (isTable(record.changes)) {
          table = toCanonicalJson(record.changes) as unknown as ChangeTable;
        }
      }
    } catch {
      table = undefined;
    }
    if (typeof id !== "string" || table === undefined) {
      diagnostics.add(
        "compare.invalid-table",
        path,
        `${key}[${index}] must have a string \`${idField}\` and a change table of the closed set of rules`,
      );
      return;
    }
    const text = canonicalText(table);
    const known = texts.get(id);
    if (known === undefined) {
      texts.set(id, text);
      tables.set(id, table);
    } else if (known !== text) {
      diagnostics.add(
        "compare.table-conflict",
        path,
        `${key}[${index}] gives another table for "${id}"`,
      );
    }
  });
  return tables;
}

function readTables(
  options: unknown,
  diagnostics: Diagnostics,
): Tables | undefined {
  if (options === undefined) {
    return { kinds: new Map(), extensions: new Map() };
  }
  if (!isPlainObject(options)) {
    diagnostics.add(
      "compare.invalid-table",
      [],
      "the options must be an object { kinds?, extensions? }",
    );
    return undefined;
  }
  return {
    kinds: readList(options, "kinds", "kind", diagnostics),
    extensions: readList(options, "extensions", "id", diagnostics),
  };
}

function failure(diagnostics: Diagnostics): ComparisonResult {
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([...diagnostics.items]),
  });
}

/**
 * Compares two normalized contract models. Never throws and never changes
 * its inputs. If a model cannot be read or a table is invalid, the result has
 * only diagnostics; otherwise it lists the changes, the bump they require and
 * the check of the next version.
 */
export function compareModels(
  previous: unknown,
  next: unknown,
  options?: CompareOptions,
): ComparisonResult {
  const diagnostics = new Diagnostics();
  try {
    const before = readModel("previous", previous, diagnostics);
    const after = readModel("next", next, diagnostics);
    const tables = readTables(options, diagnostics);
    if (before === undefined || after === undefined || tables === undefined) {
      return failure(diagnostics);
    }
    if (diagnostics.items.length > 0) return failure(diagnostics);
    const changes: Change[] = walkModels(before, after, tables, compareSchemas);
    const requiredBump = requiredBumpOf(changes);
    return Object.freeze({
      ok: !diagnostics.items.some((item) => item.severity === "error"),
      changes: Object.freeze(changes),
      requiredBump,
      diagnostics: Object.freeze([...diagnostics.items]),
    });
  } catch (error) {
    // Every read above is guarded; this is a last resort for inputs such as
    // proxies that throw while being read.
    diagnostics.add(
      "compare.invalid-model",
      [],
      `the input could not be read: ${describeError(error)}`,
    );
    return failure(diagnostics);
  }
}
