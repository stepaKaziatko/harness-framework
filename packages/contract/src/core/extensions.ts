// Phase 4: extensions put their names into the namespace, then turn their
// sections into JSON under `extensions.<id>` of the model.

import { createContext } from "./context.js";
import {
  DESCRIPTOR,
  type ExtensionContext,
  type ExtensionName,
} from "./descriptor.js";
import {
  freezeCopy,
  isPlainArray,
  isPlainObject,
  toCanonicalJson,
} from "./json.js";
import { jsonProblem } from "./kinds.js";
import {
  describeError,
  relativePath,
  type ExtensionEntry,
  type NormalizeState,
} from "./state.js";

/** Runs `names` of every extension, then `normalize` of every extension. */
export function normalizeExtensions(state: NormalizeState): void {
  const declarations = freezeCopy({ ...state.modelDeclarations });
  const withNames: ExtensionEntry[] = [];
  for (const entry of state.extensions) {
    if (registerNames(state, entry, declarations)) withNames.push(entry);
  }
  for (const entry of withNames) normalizeSection(state, entry, declarations);
}

function contextFor(
  state: NormalizeState,
  entry: ExtensionEntry,
  declarations: ExtensionContext["declarations"],
) {
  return createContext<{ declarations: ExtensionContext["declarations"] }>(
    state,
    {
      type: "extension",
      id: entry.id,
      diagnostics: entry.descriptor.diagnostics,
      base: ["extensions", entry.index],
    },
    { declarations },
  );
}

function registerNames(
  state: NormalizeState,
  entry: ExtensionEntry,
  declarations: ExtensionContext["declarations"],
): boolean {
  const base = ["extensions", entry.index];
  const handle = contextFor(state, entry, declarations);
  let names: unknown;
  try {
    names = entry.descriptor.names(
      freezeCopy(entry.value, [DESCRIPTOR]),
      handle.context,
    );
  } catch (error) {
    state.diagnostics.core(
      "descriptor.failed",
      base,
      `the extension "${entry.id}" threw while listing its names: ${describeError(error)}`,
    );
    return false;
  } finally {
    handle.close();
  }
  if (!isPlainArray(names) || !names.every(isExtensionName)) {
    state.diagnostics.core(
      "descriptor.failed",
      base,
      `the extension "${entry.id}" listed names that are not an array of { name, kind, path? }`,
    );
    return false;
  }
  for (const name of names as readonly ExtensionName[]) {
    const path = [...base, ...relativePath(name.path)];
    if (state.checkLocalName(name.name, path, `the ${name.kind}`)) {
      state.claimName(name.name, name.kind, path);
    }
  }
  return true;
}

function isExtensionName(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.name === "string" &&
    typeof value.kind === "string" &&
    (value.path === undefined || isPlainArray(value.path))
  );
}

function normalizeSection(
  state: NormalizeState,
  entry: ExtensionEntry,
  declarations: ExtensionContext["declarations"],
): void {
  const base = ["extensions", entry.index];
  const handle = contextFor(state, entry, declarations);
  let output: unknown;
  try {
    output = entry.descriptor.normalize(
      freezeCopy(entry.value, [DESCRIPTOR]),
      handle.context,
    );
  } catch (error) {
    state.diagnostics.core(
      "descriptor.failed",
      base,
      `the extension "${entry.id}" threw while normalizing its section: ${describeError(error)}`,
    );
    return;
  } finally {
    handle.close();
  }
  try {
    state.modelExtensions[entry.id] = toCanonicalJson(output);
  } catch (error) {
    state.diagnostics.core(
      "descriptor.non-json-output",
      base,
      `the extension "${entry.id}" returned a section that is not plain JSON${jsonProblem(error)}`,
    );
  }
}
