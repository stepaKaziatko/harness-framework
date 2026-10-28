// The normalized model: serializable, deterministic, without code.

import type { ModelDeclaration } from "./descriptor.js";
import type { JsonValue } from "./json.js";
import type { Subject } from "./root.js";

/**
 * The version of the model format. It grows when a change cannot be ignored
 * by an older reader; an additive optional field does not raise it.
 */
export const MODEL_FORMAT_VERSION = 1;

/** A normalized import. */
export interface ModelImport {
  readonly range: string;
}

/** A normalized permission. */
export interface ModelPermission {
  readonly description?: string;
  /** Sorted, without repeats, never empty. */
  readonly subjects: readonly Subject[];
}

/** The normalized model of a contract. */
export interface ContractModel {
  readonly formatVersion: typeof MODEL_FORMAT_VERSION;
  readonly contract: { readonly name: string; readonly version: string };
  /** Imports by contract name. */
  readonly imports: Readonly<Record<string, ModelImport>>;
  /** Permissions by qualified name. */
  readonly permissions: Readonly<Record<string, ModelPermission>>;
  /** Declarations by qualified name. */
  readonly declarations: Readonly<Record<string, ModelDeclaration>>;
  /** Extension sections by extension id; absent when there are none. */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** The parts of a model before keys are sorted. */
export interface ModelParts {
  readonly contract: { readonly name: string; readonly version: string };
  readonly imports: Readonly<Record<string, ModelImport>>;
  readonly permissions: Readonly<Record<string, ModelPermission>>;
  readonly declarations: Readonly<Record<string, ModelDeclaration>>;
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** Builds the model from its parts. */
export function buildModel(parts: ModelParts): ContractModel {
  const model: Record<string, unknown> = {
    formatVersion: MODEL_FORMAT_VERSION,
    contract: parts.contract,
    imports: parts.imports,
    permissions: parts.permissions,
    declarations: parts.declarations,
  };
  if (parts.extensions !== undefined) model.extensions = parts.extensions;
  return model as unknown as ContractModel;
}
