// Phase 3: each declaration's kind turns it into the JSON `spec` of the model.

import { createContext } from "./context.js";
import { DESCRIPTOR, type DeclarationContext } from "./descriptor.js";
import { NotJsonError, freezeCopy, toCanonicalJson } from "./json.js";
import { describeError, type NormalizeState } from "./state.js";

/** Runs the kind of every declaration that passed phase 2, in input order. */
export function normalizeDeclarations(state: NormalizeState): void {
  for (const entry of state.declarations) {
    const base = ["declarations", entry.index];
    const { descriptor } = entry;
    const handle = createContext<{ name: string }>(
      state,
      {
        type: "declaration kind",
        id: descriptor.kind,
        diagnostics: descriptor.diagnostics,
        base,
      },
      { name: entry.name },
    );
    let output: unknown;
    try {
      output = descriptor.normalize(
        freezeCopy(entry.value, [DESCRIPTOR]) as never,
        handle.context as DeclarationContext,
      );
    } catch (error) {
      state.diagnostics.core(
        "descriptor.failed",
        base,
        `the declaration kind "${descriptor.kind}" threw while normalizing "${entry.name}": ${describeError(error)}`,
      );
      continue;
    } finally {
      handle.close();
    }
    try {
      const spec = toCanonicalJson(output);
      state.modelDeclarations[entry.name] = {
        kind: descriptor.kind,
        stability: entry.stability,
        requires: entry.requires,
        ...(entry.description === undefined
          ? {}
          : { description: entry.description }),
        spec,
      };
    } catch (error) {
      state.diagnostics.core(
        "descriptor.non-json-output",
        base,
        `the declaration kind "${descriptor.kind}" returned a value that is not plain JSON for "${entry.name}"${jsonProblem(error)}`,
      );
    }
  }
}

/** Describes where an output stopped being JSON. */
export function jsonProblem(error: unknown): string {
  if (error instanceof NotJsonError) {
    const where =
      error.path.length === 0
        ? "at the top"
        : `at ${JSON.stringify(error.path)}`;
    return `: ${error.message} ${where}`;
  }
  return `: ${describeError(error)}`;
}
