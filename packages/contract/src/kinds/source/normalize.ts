// The `normalize` of the source kind. It never throws: every field is read
// only after its type is checked, and a problem becomes a diagnostic.

import type { Declaration, DeclarationContext } from "../../core/descriptor.js";
import {
  hasOwn,
  isPlainObject,
  type JsonObject,
  type JsonValue,
} from "../../core/json.js";
import type { SourceInput } from "./index.js";

/** The shortest interval between updates of a subscription, in milliseconds. */
export const MIN_INTERVAL_MS = 100;

/** The longest interval between updates of a subscription, in milliseconds. */
export const MAX_INTERVAL_MS = 3_600_000;

/** Keys of a source: the envelope, its kind and the payload. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "name",
  "stability",
  "requires",
  "description",
  "params",
  "result",
  "subscription",
]);

/** What `params` is in the model when a source declares none. */
const NO_PARAMS: JsonObject = { properties: {}, type: "object" };

/**
 * Turns a source into its `spec`. Diagnostics come in a fixed order: unknown
 * keys in the order of the input, then params, result and subscription. A
 * field that is absent, or `undefined`, is not declared.
 */
export function normalizeSource(
  declaration: Declaration<"source", SourceInput>,
  context: DeclarationContext,
): JsonValue {
  const input: Readonly<Record<string, unknown>> = declaration;
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      context.report(
        "source.unknown-field",
        [key],
        `"${key}" is not a field of a source; a source has name, stability, requires, description, params, result and subscription`,
      );
    }
  }

  const params = normalizeParams(input.params, context);
  const result = normalizeResult(input.result, context);
  const subscription = normalizeSubscription(input.subscription, context);

  return {
    params,
    result,
    ...(subscription === undefined ? {} : { subscription }),
  };
}

function normalizeParams(
  params: unknown,
  context: DeclarationContext,
): JsonValue {
  if (params === undefined) return NO_PARAMS;
  const schema = context.schema(params as never, "input", ["params"]);
  if (schema === undefined) return null;
  if (schema.type !== "object") {
    context.report(
      "source.params-not-object",
      ["params"],
      "the parameters of a source must be an object schema, because they become the arguments of a read tool and the key of a subscription",
    );
  }
  return schema;
}

function normalizeResult(
  result: unknown,
  context: DeclarationContext,
): JsonValue {
  if (result === undefined) {
    context.report(
      "source.missing-result",
      [],
      "a source must declare the schema of its result",
    );
    return null;
  }
  return context.schema(result as never, "output", ["result"]) ?? null;
}

function normalizeSubscription(
  subscription: unknown,
  context: DeclarationContext,
): JsonObject | undefined {
  if (subscription === undefined) return undefined;
  if (!isPlainObject(subscription)) {
    context.report(
      "source.invalid-subscription",
      ["subscription"],
      "`subscription` must be an object with the key intervalMs",
    );
    return undefined;
  }
  let valid = true;
  for (const key of Object.keys(subscription)) {
    if (key !== "intervalMs") {
      valid = false;
      context.report(
        "source.invalid-subscription",
        ["subscription", key],
        `"${key}" is not a field of a subscription; the only field is intervalMs`,
      );
    }
  }
  const interval = hasOwn(subscription, "intervalMs")
    ? subscription.intervalMs
    : undefined;
  if (interval === undefined) {
    context.report(
      "source.invalid-subscription",
      ["subscription"],
      "`subscription` must declare intervalMs",
    );
    return undefined;
  }
  if (typeof interval !== "number" || !Number.isInteger(interval)) {
    context.report(
      "source.invalid-subscription",
      ["subscription", "intervalMs"],
      "`intervalMs` must be an integer number of milliseconds",
    );
    return undefined;
  }
  if (interval < MIN_INTERVAL_MS || interval > MAX_INTERVAL_MS) {
    context.report(
      "source.interval-out-of-range",
      ["subscription", "intervalMs"],
      `\`intervalMs\` must be from ${MIN_INTERVAL_MS} to ${MAX_INTERVAL_MS} milliseconds`,
    );
    return undefined;
  }
  return valid ? { intervalMs: interval } : undefined;
}
