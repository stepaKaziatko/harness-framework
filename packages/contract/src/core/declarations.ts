// Phase 2: declaration envelopes, the shared namespace, `requires`, and the
// descriptors of declarations and extension sections.

import { isTable } from "./changes.js";
import {
  findDescriptor,
  type FoundDescriptor,
  type Stability,
} from "./descriptor.js";
import { RESERVED_CODE_AREAS, type DiagnosticPath } from "./diagnostics.js";
import {
  compareCodePoints,
  hasOwn,
  isPlainArray,
  isPlainObject,
} from "./json.js";
import { firstSegment, isPath, isSegment } from "./names.js";
import type { NormalizeState } from "./state.js";

/** The values of `stability`. */
export const STABILITIES: ReadonlySet<unknown> = new Set([
  "internal",
  "beta",
  "public",
]);

const RESERVED: ReadonlySet<unknown> = new Set(RESERVED_CODE_AREAS);

/** Checks `declarations` and records the ones that can go to phase 3. */
export function checkDeclarations(
  state: NormalizeState,
  root: Record<string, unknown>,
): void {
  if (!hasOwn(root, "declarations") || root.declarations === undefined) return;
  const declarations = root.declarations;
  if (!isPlainArray(declarations)) {
    state.diagnostics.core(
      "root.invalid-shape",
      ["declarations"],
      "`declarations` must be an array",
    );
    return;
  }
  declarations.forEach((value, index) => checkDeclaration(state, value, index));
}

function checkDeclaration(
  state: NormalizeState,
  value: unknown,
  index: number,
): void {
  const path = ["declarations", index];
  if (!isPlainObject(value)) {
    state.diagnostics.core(
      "declaration.invalid-envelope",
      path,
      "a declaration must be an object created by a declaration kind",
    );
    return;
  }
  const problems: string[] = [];
  const { kind, name, requires, description } = value;
  if (typeof kind !== "string") problems.push("`kind` must be a string");
  if (typeof name !== "string") problems.push("`name` must be a string");
  if (
    requires !== undefined &&
    !(
      isPlainArray(requires) &&
      requires.every((item) => typeof item === "string")
    )
  ) {
    problems.push("`requires` must be an array of strings");
  }
  if (description !== undefined && typeof description !== "string") {
    problems.push("`description` must be a string");
  }
  if (problems.length > 0) {
    state.diagnostics.core(
      "declaration.invalid-envelope",
      path,
      `the declaration envelope is invalid: ${problems.join("; ")}`,
    );
    return;
  }
  const found = findDescriptor(value);
  let descriptorValid = false;
  if (found === undefined || found.type !== "kind") {
    state.diagnostics.core(
      "declaration.unknown-kind",
      path,
      `the declaration "${String(name)}" does not carry a declaration kind descriptor; create it with a kind's define function`,
    );
  } else if (found.id !== kind) {
    state.diagnostics.core(
      "declaration.invalid-envelope",
      path,
      `the declaration has kind "${String(kind)}", but its descriptor is of kind "${String(found.id)}"`,
    );
    return;
  } else {
    descriptorValid = checkDescriptor(state, found, path);
  }

  let stability: Stability = "internal";
  if (value.stability !== undefined) {
    if (STABILITIES.has(value.stability)) {
      stability = value.stability as Stability;
    } else {
      state.diagnostics.core(
        "declaration.invalid-stability",
        [...path, "stability"],
        "`stability` must be one of internal, beta or public",
      );
    }
  }

  const local = name as string;
  const nameValid =
    state.checkLocalName(local, [...path, "name"], "the declaration") &&
    state.claimName(local, kind as string, [...path, "name"]);

  const required = new Set<string>();
  ((requires ?? []) as readonly string[]).forEach((reference, position) => {
    const where = [...path, "requires", position];
    if (isPath(reference) && state.importNames.has(firstSegment(reference))) {
      state.diagnostics.core(
        "permission.unknown",
        where,
        `"${reference}" is a permission of an import; \`requires\` names only permissions of this contract`,
      );
    } else if (!state.permissionNames.has(reference)) {
      state.diagnostics.core(
        "permission.unknown",
        where,
        `the permission "${reference}" is not declared in \`permissions\``,
      );
    } else {
      required.add(state.qualify(reference));
    }
  });

  if (found?.type === "kind" && descriptorValid && nameValid) {
    state.declarations.push({
      index,
      value,
      descriptor: found.descriptor,
      name: state.qualify(local),
      stability,
      requires: [...required].sort(compareCodePoints),
      ...(description === undefined
        ? {}
        : { description: description as string }),
    });
  }
}

/** Checks `extensions` and records the sections that can go to phase 4. */
export function checkExtensions(
  state: NormalizeState,
  root: Record<string, unknown>,
): void {
  if (!hasOwn(root, "extensions") || root.extensions === undefined) return;
  const extensions = root.extensions;
  if (!isPlainArray(extensions)) {
    state.diagnostics.core(
      "root.invalid-shape",
      ["extensions"],
      "`extensions` must be an array",
    );
    return;
  }
  const given = new Set<object>();
  extensions.forEach((value, index) => {
    const path = ["extensions", index];
    const found = findDescriptor(value);
    if (found === undefined || found.type !== "extension") {
      state.diagnostics.core(
        "root.invalid-shape",
        path,
        "an entry of `extensions` must be a section created by an extension",
      );
      return;
    }
    if (given.has(found.descriptor)) {
      state.diagnostics.core(
        "descriptor.conflict",
        path,
        `the extension "${String(found.id)}" is given more than once`,
      );
      return;
    }
    given.add(found.descriptor);
    if (checkDescriptor(state, found, path)) {
      state.extensions.push({
        index,
        value: value as Record<string | symbol, unknown>,
        descriptor: found.descriptor,
        id: found.id as string,
      });
    }
  });
}

/**
 * Checks a descriptor where a value uses it: its id, its change table, and
 * that no other descriptor took the same id. Problems of the descriptor
 * itself are reported once, at the first value that uses it; a conflict is
 * reported at every value whose descriptor lost the id.
 */
function checkDescriptor(
  state: NormalizeState,
  found: FoundDescriptor,
  path: DiagnosticPath,
): boolean {
  const { descriptor, id } = found;
  const what = found.type === "kind" ? "declaration kind" : "extension";
  const checked = state.checkedDescriptors.get(descriptor);
  if (checked === false) return false;
  if (checked === undefined) {
    if (!isSegment(id) || RESERVED.has(id)) {
      state.diagnostics.core(
        "descriptor.reserved-id",
        path,
        `the ${what} id "${String(id)}" must be a lowercase kebab-case segment and not one of ${RESERVED_CODE_AREAS.join(", ")}`,
      );
      state.checkedDescriptors.set(descriptor, false);
      return false;
    }
  }
  const owner = state.descriptorsById.get(id as string);
  if (owner !== undefined && owner !== descriptor) {
    state.diagnostics.core(
      "descriptor.conflict",
      path,
      `the id "${String(id)}" is already taken by another declaration kind or extension`,
    );
    return false;
  }
  if (checked === true) return true;
  if (!isTable(descriptor.changes)) {
    state.diagnostics.core(
      "descriptor.invalid-changes",
      path,
      `the change table of the ${what} "${String(id)}" uses a rule outside breaking, compatible, schema, set, ordered and nested`,
    );
    state.checkedDescriptors.set(descriptor, false);
    return false;
  }
  state.descriptorsById.set(id as string, descriptor);
  state.checkedDescriptors.set(descriptor, true);
  return true;
}
