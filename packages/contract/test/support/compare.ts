// Helpers of the version comparison tests: fresh copies of the reference
// model and a short form of a comparison result.

import { readFileSync } from "node:fs";
import type { ComparisonResult } from "../../src/versioning/compare.js";

// The model is edited freely by the tests, so it is typed loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Model = any;

const text = readFileSync(
  new URL("../fixtures/core-model.json", import.meta.url),
  "utf8",
);

/** A fresh deep copy of the reference model (`trading@0.1.0`). */
export function model(): Model {
  return JSON.parse(text) as Model;
}

/** A fresh copy of the reference model changed by `edit`. */
export function edited(edit: (model: Model) => void): Model {
  const copy = model();
  edit(copy);
  return copy;
}

/** The changes of a result without messages, for a full `toEqual`. */
export function changesOf(
  result: ComparisonResult,
): { code: string; path: readonly (string | number)[]; class: string }[] {
  if (!("changes" in result)) {
    throw new Error(
      `the comparison failed: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result.changes.map((change) => ({
    code: change.code,
    path: change.path,
    class: change.class,
  }));
}
