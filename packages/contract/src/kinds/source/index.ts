// The source kind: a named read of data with parameters, a result schema and
// an optional subscription (ADR 0004). A source is only declared here; the
// owner of the product executes it in the runtime.

import type { $ZodType } from "zod/v4/core";
import {
  defineDeclarationKind,
  type Declaration,
  type DeclarationEnvelope,
} from "../../core/descriptor.js";
import type { JsonObject } from "../../core/json.js";
import { sourceChanges } from "./changes.js";
import { sourceDiagnostics, type SourceDiagnosticCode } from "./diagnostics.js";
import { normalizeSource } from "./normalize.js";

export type { SourceDiagnosticCode };

/**
 * A subscription: the owner of the source sends a new full value of the
 * result for the same parameters at most once per `intervalMs`.
 */
export type SourceSubscription = {
  /** An integer from 100 to 3 600 000. */
  readonly intervalMs: number;
};

/** What `defineSource` takes: the declaration envelope and the payload. */
export interface SourceInput<
  P extends $ZodType = $ZodType,
  R extends $ZodType = $ZodType,
> extends DeclarationEnvelope {
  /** The parameters as a zod object schema; none means no parameters. */
  readonly params?: P;
  /** The value a read returns. */
  readonly result: R;
  /** Present when the source can be subscribed to. */
  readonly subscription?: SourceSubscription;
}

/** A source declaration; it keeps the types of its schemas. */
export type Source<
  P extends $ZodType = $ZodType,
  R extends $ZodType = $ZodType,
> = Declaration<"source", SourceInput<P, R>>;

/** The `spec` of a source in the model. */
export type SourceSpec = {
  /** JSON Schema of the parameters (input direction), always an object. */
  readonly params: JsonObject;
  /** JSON Schema of the result (output direction). */
  readonly result: JsonObject;
  /** Present only when the source declares a subscription. */
  readonly subscription?: SourceSubscription;
};

/**
 * The descriptor of the source kind. Its `changes` and `diagnostics` are read
 * by the function that compares versions and by the CLI.
 */
export const sourceKind = defineDeclarationKind<"source", SourceInput>({
  kind: "source",
  normalize: normalizeSource,
  changes: sourceChanges,
  diagnostics: sourceDiagnostics,
});

/**
 * Declares a source. It checks nothing and never throws: `normalize` checks
 * the declaration.
 */
export function defineSource<
  P extends $ZodType = $ZodType,
  R extends $ZodType = $ZodType,
>(input: SourceInput<P, R>): Source<P, R> {
  return sourceKind.declare(input) as Source<P, R>;
}
