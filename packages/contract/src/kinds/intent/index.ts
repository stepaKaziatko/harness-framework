// The intent kind (ADR 0005): an action that a widget or a plugin may ask the
// host to perform. An intent only declares the action; the host binds the
// handler, asks for confirmation, counts limits and checks grants.

import type { $ZodType } from "zod/v4/core";
import {
  defineDeclarationKind,
  type Declaration,
  type DeclarationEnvelope,
  type DeclarationKind,
} from "../../core/descriptor.js";
import type { JsonObject } from "../../core/json.js";
import { intentChangeTable } from "./changes.js";
import { intentDiagnostics } from "./diagnostics.js";
import { normalizeIntent } from "./normalize.js";

/**
 * What the host does before it performs an intent: `none` performs it
 * without a question, `user` shows the host's own confirmation dialog with
 * the parameters of the call, `step-up` asks the subject to authenticate
 * again. There is no default.
 */
export type ConfirmationPolicy = "none" | "user" | "step-up";

/**
 * Upper bounds on the number of calls of one intent by one subject per
 * window. How calls are counted is up to the runtime. A bound on a parameter
 * value belongs to `params`, not here.
 */
export interface IntentLimits {
  readonly perMinute?: number;
  readonly perHour?: number;
  readonly perDay?: number;
}

/** The input of {@link defineIntent}: the core envelope and the intent payload. */
export interface IntentInput<
  P extends $ZodType = $ZodType,
  R extends $ZodType = $ZodType,
> extends DeclarationEnvelope {
  /** Local names of permissions of this contract; at least one. */
  readonly requires: readonly [string, ...string[]];
  /** The parameters, an object schema read in the `input` direction. */
  readonly params?: P;
  /** The result, read in the `output` direction. */
  readonly result?: R;
  readonly confirmation: ConfirmationPolicy;
  readonly limits?: IntentLimits;
  /** Sources of this contract that are stale once the intent succeeds. */
  readonly invalidates?: readonly string[];
}

/** The `spec` of an intent in the model. */
export interface IntentSpec {
  /** JSON Schema of the parameters; an empty object schema by default. */
  readonly params: JsonObject;
  /** JSON Schema of the result; `{}` (any value) by default. */
  readonly result: JsonObject;
  readonly confirmation: { readonly policy: ConfirmationPolicy };
  /** `{}` by default. */
  readonly limits: IntentLimits;
  /** Qualified names of sources, sorted and without repeats; `[]` by default. */
  readonly invalidates: readonly string[];
}

/** The intent kind descriptor: its change table and its catalog of codes. */
export const intentKind: DeclarationKind<"intent", IntentInput> =
  defineDeclarationKind<"intent", IntentInput>({
    kind: "intent",
    normalize: normalizeIntent,
    changes: intentChangeTable,
    diagnostics: intentDiagnostics,
  });

/**
 * Declares an intent. It checks nothing and never throws; `normalize`
 * checks it. The types of `params` and `result` stay in the type of the
 * declaration, so a handler type can be derived from it.
 */
export function defineIntent<
  P extends $ZodType = $ZodType,
  R extends $ZodType = $ZodType,
>(input: IntentInput<P, R>): Declaration<"intent", IntentInput<P, R>> {
  return intentKind.declare(input) as Declaration<"intent", IntentInput<P, R>>;
}
