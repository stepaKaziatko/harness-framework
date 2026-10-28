// Phase 2: declaration envelopes, the shared namespace and `requires`.
// No declaration kind exists yet, so every declaration is of an unknown kind.

import { hasOwn, isPlainArray, isPlainObject } from "./json.js";
import { firstSegment, isPath } from "./names.js";
import type { NormalizeState } from "./state.js";

/** The values of `stability`. */
export const STABILITIES: ReadonlySet<unknown> = new Set([
  "internal",
  "beta",
  "public",
]);

/** Checks `declarations`. */
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
  state.diagnostics.core(
    "declaration.unknown-kind",
    path,
    `the declaration "${String(name)}" does not carry a declaration kind descriptor; create it with a kind's define function`,
  );

  if (value.stability !== undefined && !STABILITIES.has(value.stability)) {
    state.diagnostics.core(
      "declaration.invalid-stability",
      [...path, "stability"],
      "`stability` must be one of internal, beta or public",
    );
  }

  const local = name as string;
  if (state.checkLocalName(local, [...path, "name"], "the declaration")) {
    state.claimName(local, kind as string, [...path, "name"]);
  }

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
    }
  });
}
