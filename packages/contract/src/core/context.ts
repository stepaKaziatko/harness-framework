// The context the core gives to kinds and extensions: resolve, schema,
// report and stability, bound to the value being normalized.

import type {
  NormalizeContext,
  ResolveOptions,
  Stability,
} from "./descriptor.js";
import { type DiagnosticCatalog, type DiagnosticPath } from "./diagnostics.js";
import { STABILITIES } from "./declarations.js";
import { hasOwn, isPlainObject, type JsonObject } from "./json.js";
import { zodToJsonSchema } from "./json-schema.js";
import {
  MAX_LOCAL_SEGMENTS,
  MAX_QUALIFIED_LENGTH,
  firstSegment,
  isDiagnosticCode,
  isPath,
} from "./names.js";
import { relativePath, type NormalizeState } from "./state.js";

/** Who the context belongs to. */
export interface ContextOwner {
  /** `kind` or `extension`, for messages. */
  readonly type: "declaration kind" | "extension";
  /** The kind or the extension id; the prefix of its codes. */
  readonly id: string;
  /** Its catalog of codes. */
  readonly diagnostics: DiagnosticCatalog;
  /** The path of the value being normalized, from the root. */
  readonly base: DiagnosticPath;
}

/** A context and the switch that ends it once the kind or extension returns. */
export interface ContextHandle<T extends NormalizeContext> {
  readonly context: T;
  close(): void;
}

/**
 * Creates the shared part of a context. Calls made after `close()` are
 * ignored, so a kind cannot report into a later phase.
 */
export function createContext<T extends object>(
  state: NormalizeState,
  owner: ContextOwner,
  extra: T,
): ContextHandle<NormalizeContext & T> {
  let open = true;
  const at = (path: unknown): DiagnosticPath => [
    ...owner.base,
    ...relativePath(path),
  ];

  const context: NormalizeContext = {
    contract: state.contract as string,

    resolve(reference: string, options?: ResolveOptions): string | undefined {
      if (!open) return undefined;
      const path = at(options?.path);
      const kind = options?.kind;
      if (
        typeof reference !== "string" ||
        !isPath(reference, MAX_LOCAL_SEGMENTS + 1)
      ) {
        state.diagnostics.core(
          "reference.invalid",
          path,
          `the reference ${JSON.stringify(String(reference))} is not a local path or <import>.<path>`,
        );
        return undefined;
      }
      const first = firstSegment(reference);
      if (state.importNames.has(first)) {
        if (reference === first || reference.length > MAX_QUALIFIED_LENGTH) {
          state.diagnostics.core(
            "reference.invalid",
            path,
            `the reference "${reference}" into the import "${first}" must name 1 to 3 segments after it within 64 characters`,
          );
          return undefined;
        }
        return reference;
      }
      if (!isPath(reference)) {
        state.diagnostics.core(
          "reference.invalid",
          path,
          `the local reference "${reference}" must be 1 to 3 segments`,
        );
        return undefined;
      }
      const qualified = state.qualify(reference);
      const entry = state.namespace.get(qualified);
      if (entry === undefined) {
        state.diagnostics.core(
          "reference.unknown",
          path,
          `"${reference}" does not name anything in the contract "${state.contract}" and does not start with an import`,
        );
        return undefined;
      }
      if (kind !== undefined && entry.kind !== kind) {
        state.diagnostics.core(
          "reference.kind-mismatch",
          path,
          `"${reference}" is of kind "${entry.kind}", not "${String(kind)}"`,
        );
        return undefined;
      }
      return qualified;
    },

    schema(schema, direction, path): JsonObject | undefined {
      if (!open) return undefined;
      const where = at(path);
      if (direction !== "input" && direction !== "output") {
        state.diagnostics.core(
          "schema.invalid",
          where,
          `the schema direction must be "input" or "output"`,
        );
        return undefined;
      }
      const result = zodToJsonSchema(schema, direction);
      if (result.ok) return result.schema;
      state.diagnostics.core(
        result.reason === "invalid"
          ? "schema.invalid"
          : "schema.unrepresentable",
        where,
        result.reason === "invalid"
          ? "the value passed as a schema is not a zod schema"
          : `the zod schema cannot be represented as JSON Schema: ${result.message}`,
      );
      return undefined;
    },

    report(code: string, path: DiagnosticPath, message: string): void {
      if (!open) return;
      const catalog: unknown = owner.diagnostics;
      const info =
        typeof code === "string" &&
        isPlainObject(catalog) &&
        hasOwn(catalog, code)
          ? (catalog[code] as { severity?: unknown } | undefined)
          : undefined;
      const severity = isPlainObject(info) ? info.severity : undefined;
      if (
        typeof code !== "string" ||
        !isDiagnosticCode(code) ||
        !code.startsWith(`${owner.id}.`) ||
        (severity !== "error" && severity !== "warning")
      ) {
        state.diagnostics.core(
          "descriptor.undeclared-code",
          owner.base,
          `the ${owner.type} "${owner.id}" reported ${JSON.stringify(String(code))}, which is not a code of its catalog prefixed with "${owner.id}."`,
        );
        return;
      }
      state.diagnostics.add({
        code,
        severity,
        path: at(path),
        message: String(message),
      });
    },

    stability(value: unknown, path?: DiagnosticPath): Stability {
      if (value === undefined) return "internal";
      if (STABILITIES.has(value)) return value as Stability;
      if (open) {
        state.diagnostics.core(
          "declaration.invalid-stability",
          at(path),
          "`stability` must be one of internal, beta or public",
        );
      }
      return "internal";
    },
  };

  return {
    context: Object.freeze(Object.assign(context, extra)),
    close() {
      open = false;
    },
  };
}
