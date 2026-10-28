// `normalize`: checks a contract root and builds its model. It never throws on
// the content of a contract; every problem is a diagnostic with a code.

import { checkDeclarations, checkExtensions } from "./declarations.js";
import type { Diagnostic } from "./diagnostics.js";
import { normalizeExtensions } from "./extensions.js";
import { checkIdentity, checkImports, checkRootShape } from "./identity.js";
import { normalizeDeclarations } from "./kinds.js";
import { buildModel, type ContractModel } from "./model.js";
import { checkPermissions } from "./permissions.js";
import { NormalizeState, describeError } from "./state.js";

/** The outcome of {@link normalize}. */
export type NormalizeResult =
  | {
      readonly ok: true;
      readonly model: ContractModel;
      /** Warnings only. */
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      /** At least one error. */
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Checks a contract root and builds its normalized model. The phases run in
 * a fixed order: (1) identity, imports and permissions; (2) declaration
 * envelopes and names, descriptors; (3) each declaration's kind; (4) the
 * names of extensions, then their sections. Phases 3 and 4 run only when
 * phases 1 and 2 found no errors. Diagnostics come in the order of the phases
 * and, within a phase, in the order of the input.
 */
export function normalize(root: unknown): NormalizeResult {
  const state = new NormalizeState();
  try {
    return run(state, root);
  } catch (error) {
    // The checks above guard every read; this is a last resort for inputs
    // such as proxies or getters that throw while being read.
    state.diagnostics.core(
      "root.invalid-shape",
      [],
      `the contract root could not be read: ${describeError(error)}`,
    );
    return { ok: false, diagnostics: state.diagnostics.list() };
  }
}

function run(state: NormalizeState, input: unknown): NormalizeResult {
  const root = checkRootShape(state, input);
  if (root === undefined)
    return { ok: false, diagnostics: state.diagnostics.list() };

  checkIdentity(state, root);
  checkImports(state, root);
  checkPermissions(state, root);

  checkDeclarations(state, root);
  checkExtensions(state, root);

  if (state.diagnostics.hasErrors()) {
    return { ok: false, diagnostics: state.diagnostics.list() };
  }

  normalizeDeclarations(state);
  normalizeExtensions(state);

  const diagnostics = state.diagnostics.list();
  if (state.diagnostics.hasErrors()) return { ok: false, diagnostics };

  const model = buildModel({
    contract: {
      name: state.contract as string,
      version: state.version as string,
    },
    imports: Object.fromEntries(state.imports),
    permissions: Object.fromEntries(state.permissions),
    declarations: state.modelDeclarations,
    ...(state.extensions.length === 0
      ? {}
      : { extensions: state.modelExtensions }),
  });
  return { ok: true, model, diagnostics };
}
