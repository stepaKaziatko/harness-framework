// Phase 1, first part: the shape of the root, the identity and the imports.

import { hasOwn, isPlainArray, isPlainObject } from "./json.js";
import { isSegment } from "./names.js";
import { isContractVersion, isImportRange } from "./semver.js";
import type { NormalizeState } from "./state.js";

/** The keys a root may have. */
export const ROOT_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "version",
  "imports",
  "permissions",
  "declarations",
  "extensions",
]);

const IMPORT_FIELDS: ReadonlySet<string> = new Set(["contract", "range"]);

/**
 * Checks that the input is an object with known keys. Returns the root when
 * the other checks can go on, `undefined` when the input is not an object.
 */
export function checkRootShape(
  state: NormalizeState,
  input: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(input)) {
    const what =
      input === null
        ? "null"
        : Array.isArray(input)
          ? "an array"
          : `a value of type ${typeof input}`;
    state.diagnostics.core(
      "root.invalid-shape",
      [],
      `the contract root must be an object returned by defineContract, not ${what}`,
    );
    return undefined;
  }
  for (const key of Object.keys(input)) {
    if (!ROOT_FIELDS.has(key)) {
      state.diagnostics.core(
        "root.unknown-field",
        [key],
        `the contract root has no field "${key}"; known fields are ${[...ROOT_FIELDS].join(", ")}`,
      );
    }
  }
  return input as Record<string, unknown>;
}

/** Checks `name` and `version`. */
export function checkIdentity(
  state: NormalizeState,
  root: Record<string, unknown>,
): void {
  const { name, version } = root;
  if (typeof name !== "string") {
    state.diagnostics.core(
      "root.invalid-shape",
      ["name"],
      "the contract name must be a string",
    );
  } else if (!isSegment(name)) {
    state.diagnostics.core(
      "contract.invalid-name",
      ["name"],
      `the contract name "${name}" must be one lowercase kebab-case segment of 1 to 32 characters`,
    );
  } else {
    state.contract = name;
  }
  if (typeof version !== "string") {
    state.diagnostics.core(
      "root.invalid-shape",
      ["version"],
      "the contract version must be a string",
    );
  } else if (!isContractVersion(version)) {
    state.diagnostics.core(
      "contract.invalid-version",
      ["version"],
      `the contract version "${version}" must be SemVer 2.0.0 without build metadata`,
    );
  } else {
    state.version = version;
  }
}

/** Checks `imports`. */
export function checkImports(
  state: NormalizeState,
  root: Record<string, unknown>,
): void {
  if (!hasOwn(root, "imports") || root.imports === undefined) return;
  const imports = root.imports;
  if (!isPlainArray(imports)) {
    state.diagnostics.core(
      "root.invalid-shape",
      ["imports"],
      "`imports` must be an array",
    );
    return;
  }
  const seen = new Set<string>();
  imports.forEach((entry, index) => {
    const path = ["imports", index];
    if (!isPlainObject(entry)) {
      state.diagnostics.core(
        "root.invalid-shape",
        path,
        "an import must be an object { contract, range }",
      );
      return;
    }
    let valid = true;
    for (const key of Object.keys(entry)) {
      if (!IMPORT_FIELDS.has(key)) {
        state.diagnostics.core(
          "root.invalid-shape",
          [...path, key],
          `an import has no field "${key}"`,
        );
        valid = false;
      }
    }
    const { contract, range } = entry;
    if (typeof contract !== "string") {
      state.diagnostics.core(
        "root.invalid-shape",
        [...path, "contract"],
        "`contract` of an import must be a string",
      );
      valid = false;
    } else if (!isSegment(contract)) {
      state.diagnostics.core(
        "import.invalid-contract",
        [...path, "contract"],
        `the imported contract name "${contract}" must be one lowercase kebab-case segment of 1 to 32 characters`,
      );
      valid = false;
    } else if (contract === root.name) {
      state.diagnostics.core(
        "import.self",
        [...path, "contract"],
        `the contract "${contract}" imports itself`,
      );
      valid = false;
    } else if (seen.has(contract)) {
      state.diagnostics.core(
        "import.duplicate",
        [...path, "contract"],
        `the contract "${contract}" is already imported`,
      );
      valid = false;
    } else {
      seen.add(contract);
      state.importNames.add(contract);
    }
    if (typeof range !== "string") {
      state.diagnostics.core(
        "root.invalid-shape",
        [...path, "range"],
        "`range` of an import must be a string",
      );
      valid = false;
    } else if (!isImportRange(range)) {
      state.diagnostics.core(
        "import.invalid-range",
        [...path, "range"],
        `the range "${range}" must be X.Y.Z, ^X.Y.Z, ~X.Y.Z or ">=X.Y.Z <X.Y.Z", joined by " || ", without pre-releases`,
      );
      valid = false;
    }
    if (valid)
      state.imports.set(contract as string, { range: range as string });
  });
}
