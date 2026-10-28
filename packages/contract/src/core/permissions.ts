// Phase 1, second part: permissions and their subjects.

import {
  canonicalText,
  compareCodePoints,
  hasOwn,
  isPlainArray,
  isPlainObject,
} from "./json.js";
import type { ModelPermission } from "./model.js";
import type { Subject } from "./root.js";
import type { NormalizeState } from "./state.js";

const PERMISSION_FIELDS: ReadonlySet<string> = new Set([
  "subjects",
  "description",
]);

/** Subject kinds the core knows, with the fields each one may have. */
const SUBJECT_FIELDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["end-user", new Set(["kind"])],
]);

/** The subjects a permission gets when it does not list any. */
const DEFAULT_SUBJECTS: readonly Subject[] = [{ kind: "end-user" }];

/** Checks `permissions`. */
export function checkPermissions(
  state: NormalizeState,
  root: Record<string, unknown>,
): void {
  if (!hasOwn(root, "permissions") || root.permissions === undefined) return;
  const permissions = root.permissions;
  if (!isPlainObject(permissions)) {
    state.diagnostics.core(
      "root.invalid-shape",
      ["permissions"],
      "`permissions` must be an object of permissions by local name",
    );
    return;
  }
  for (const key of Object.keys(permissions)) {
    const path = ["permissions", key];
    let valid = state.checkLocalName(key, path, "the permission");
    if (valid) state.permissionNames.add(key);
    const value = permissions[key];
    if (!isPlainObject(value)) {
      state.diagnostics.core(
        "root.invalid-shape",
        path,
        "a permission must be an object { subjects?, description? }",
      );
      continue;
    }
    for (const field of Object.keys(value)) {
      if (!PERMISSION_FIELDS.has(field)) {
        state.diagnostics.core(
          "root.invalid-shape",
          [...path, field],
          `a permission has no field "${field}"`,
        );
        valid = false;
      }
    }
    const description = value.description;
    if (description !== undefined && typeof description !== "string") {
      state.diagnostics.core(
        "root.invalid-shape",
        [...path, "description"],
        "`description` of a permission must be a string",
      );
      valid = false;
    }
    const subjects = checkSubjects(state, value.subjects, [
      ...path,
      "subjects",
    ]);
    if (subjects === undefined) valid = false;
    if (valid && subjects !== undefined) {
      const permission: ModelPermission =
        typeof description === "string"
          ? { description, subjects }
          : { subjects };
      state.permissions.set(state.qualify(key), permission);
    }
  }
}

function checkSubjects(
  state: NormalizeState,
  subjects: unknown,
  path: (string | number)[],
): readonly Subject[] | undefined {
  if (subjects === undefined) return DEFAULT_SUBJECTS;
  if (!isPlainArray(subjects)) {
    state.diagnostics.core(
      "root.invalid-shape",
      path,
      "`subjects` must be an array of subjects",
    );
    return undefined;
  }
  if (subjects.length === 0) {
    state.diagnostics.core(
      "permission.empty-subjects",
      path,
      "`subjects` is empty, so the permission could not be granted to anyone; omit it to grant it to the end user",
    );
    return undefined;
  }
  let valid = true;
  subjects.forEach((subject, index) => {
    const subjectPath = [...path, index];
    if (!isPlainObject(subject)) {
      state.diagnostics.core(
        "root.invalid-shape",
        subjectPath,
        "a subject must be an object { kind }",
      );
      valid = false;
      return;
    }
    const kind = subject.kind;
    if (typeof kind !== "string") {
      state.diagnostics.core(
        "root.invalid-shape",
        [...subjectPath, "kind"],
        "`kind` of a subject must be a string",
      );
      valid = false;
      return;
    }
    const fields = SUBJECT_FIELDS.get(kind);
    if (fields === undefined) {
      state.diagnostics.core(
        "permission.unknown-subject",
        [...subjectPath, "kind"],
        `the subject kind "${kind}" is unknown; known kinds are ${[...SUBJECT_FIELDS.keys()].join(", ")}`,
      );
      valid = false;
      return;
    }
    for (const field of Object.keys(subject)) {
      if (!fields.has(field)) {
        state.diagnostics.core(
          "root.invalid-shape",
          [...subjectPath, field],
          `a subject of kind "${kind}" has no field "${field}"`,
        );
        valid = false;
      }
    }
  });
  if (!valid) return undefined;
  return uniqueSorted(subjects as readonly Subject[]);
}

/** Sorts subjects by their canonical JSON text and drops repeats. */
function uniqueSorted(subjects: readonly Subject[]): readonly Subject[] {
  const byText = new Map<string, Subject>();
  for (const subject of subjects) byText.set(canonicalText(subject), subject);
  return [...byText.keys()]
    .sort(compareCodePoints)
    .map((text) => byText.get(text)!);
}
