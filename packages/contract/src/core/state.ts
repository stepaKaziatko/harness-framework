// The working state of one `normalize` call, shared by its phases.

import { DiagnosticCollector, type DiagnosticPath } from "./diagnostics.js";
import type { ModelImport, ModelPermission } from "./model.js";
import { firstSegment, isLocalName, isPath, qualify } from "./names.js";

/** An entry of the shared namespace of declarations and extension names. */
export interface NamespaceEntry {
  readonly kind: string;
}

export class NormalizeState {
  readonly diagnostics = new DiagnosticCollector();
  /** The contract name when it is valid, otherwise `undefined`. */
  contract: string | undefined;
  version: string | undefined;
  /** Valid imports by contract name. */
  readonly imports = new Map<string, ModelImport>();
  /** Every syntactically valid imported name other than the contract's own. */
  readonly importNames = new Set<string>();
  /** Every permission key that is a valid local name. */
  readonly permissionNames = new Set<string>();
  /** Valid permissions by qualified name. */
  readonly permissions = new Map<string, ModelPermission>();
  /** The shared namespace, by qualified name (or local name if the contract name is invalid). */
  readonly namespace = new Map<string, NamespaceEntry>();

  /** The key of a local name in the namespace and in the model. */
  qualify(local: string): string {
    return this.contract === undefined ? local : qualify(this.contract, local);
  }

  /**
   * Checks a local name of a declaration, permission or extension name and
   * reports `name.invalid` or `name.import-conflict` at `path`.
   */
  checkLocalName(local: string, path: DiagnosticPath, what: string): boolean {
    const valid =
      this.contract === undefined
        ? isPath(local)
        : isLocalName(this.contract, local);
    if (!valid) {
      this.diagnostics.core(
        "name.invalid",
        path,
        `${what} name "${local}" must be 1 to 3 lowercase kebab-case segments joined by "." with a qualified name of at most 64 characters`,
      );
      return false;
    }
    const first = firstSegment(local);
    if (this.importNames.has(first)) {
      this.diagnostics.core(
        "name.import-conflict",
        path,
        `${what} name "${local}" starts with "${first}", which is the name of an import`,
      );
      return false;
    }
    return true;
  }

  /**
   * Adds a checked local name to the shared namespace, or reports
   * `name.duplicate` at `path` if it is already taken.
   */
  claimName(local: string, kind: string, path: DiagnosticPath): boolean {
    const key = this.qualify(local);
    if (this.namespace.has(key)) {
      this.diagnostics.core(
        "name.duplicate",
        path,
        `the name "${key}" is already taken`,
      );
      return false;
    }
    this.namespace.set(key, { kind });
    return true;
  }
}

/** A relative path from a kind or an extension, or `[]` if it is malformed. */
export function relativePath(path: unknown): DiagnosticPath {
  if (
    Array.isArray(path) &&
    path.every(
      (item) =>
        typeof item === "string" ||
        (typeof item === "number" && Number.isInteger(item)),
    )
  ) {
    return [...(path as (string | number)[])];
  }
  return [];
}

/** A message of a caught exception. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "an unprintable value was thrown";
  }
}
