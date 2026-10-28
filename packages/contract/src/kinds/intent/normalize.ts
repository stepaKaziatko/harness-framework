// Turns an intent declaration into its `spec` (ADR 0005). Every problem of
// one declaration is reported in a single pass, in a fixed order of fields:
// unknown keys, `requires`, `params`, `result`, `confirmation`, `limits`,
// `invalidates`. Defaults are written into the spec.

import type { $ZodType } from "zod/v4/core";
import type { Declaration, DeclarationContext } from "../../core/descriptor.js";
import {
  compareCodePoints,
  isPlainArray,
  isPlainObject,
  type JsonObject,
  type JsonValue,
} from "../../core/json.js";
import type { IntentDiagnosticCode } from "./diagnostics.js";
import type { ConfirmationPolicy, IntentInput } from "./index.js";

/** Keys an intent declaration may have: the core envelope and the payload. */
const FIELDS: ReadonlySet<string> = new Set([
  "kind",
  "name",
  "stability",
  "requires",
  "description",
  "params",
  "result",
  "confirmation",
  "limits",
  "invalidates",
]);

const POLICIES: ReadonlySet<unknown> = new Set<ConfirmationPolicy>([
  "none",
  "user",
  "step-up",
]);

/** The windows of `limits`, from the smallest. */
const WINDOWS = ["perMinute", "perHour", "perDay"] as const;

type Window = (typeof WINDOWS)[number];

const WINDOW_NAMES: ReadonlySet<string> = new Set(WINDOWS);

const EMPTY_OBJECT_SCHEMA: JsonObject = { properties: {}, type: "object" };

/** The `normalize` of the intent kind. */
export function normalizeIntent(
  declaration: Declaration<"intent", IntentInput>,
  context: DeclarationContext,
): JsonValue {
  const value = declaration as unknown as Readonly<Record<string, unknown>>;
  const report = (
    code: IntentDiagnosticCode,
    path: (string | number)[],
    message: string,
  ) => context.report(code, path, message);

  for (const key of Object.keys(value)) {
    if (!FIELDS.has(key)) {
      report(
        "intent.unknown-field",
        [key],
        `an intent has no field "${key}"; an intent only declares an action, the host binds its handler`,
      );
    }
  }

  const requires = value.requires;
  if (requires === undefined || (isPlainArray(requires) && !requires.length)) {
    report(
      "intent.missing-requires",
      ["requires"],
      `the intent "${context.name}" must name at least one permission in \`requires\``,
    );
  }

  let params: JsonValue = EMPTY_OBJECT_SCHEMA;
  if (value.params !== undefined) {
    const schema = context.schema(value.params as $ZodType, "input", [
      "params",
    ]);
    if (schema === undefined) {
      params = null;
    } else if (schema.type !== "object") {
      report(
        "intent.params-not-object",
        ["params"],
        "`params` must be an object schema at the top level, such as z.object({ ... })",
      );
      params = null;
    } else {
      params = schema;
    }
  }

  let result: JsonValue = {};
  if (value.result !== undefined) {
    result =
      context.schema(value.result as $ZodType, "output", ["result"]) ?? null;
  }

  let confirmation: JsonValue = null;
  if (value.confirmation === undefined) {
    report(
      "intent.missing-confirmation",
      ["confirmation"],
      `the intent "${context.name}" must set \`confirmation\` to none, user or step-up; there is no default`,
    );
  } else if (POLICIES.has(value.confirmation)) {
    confirmation = { policy: value.confirmation as ConfirmationPolicy };
  } else {
    report(
      "intent.unknown-confirmation",
      ["confirmation"],
      "`confirmation` must be one of none, user or step-up",
    );
  }

  const limits = normalizeLimits(value.limits, report);
  const invalidates = normalizeInvalidates(value.invalidates, context, report);
  return { confirmation, invalidates, limits, params, result };
}

type Report = (
  code: IntentDiagnosticCode,
  path: (string | number)[],
  message: string,
) => void;

/**
 * Checks `limits`: an object of known windows with positive safe integers.
 * Among the windows that are present and valid, taken from the smallest, a
 * smaller window may not allow more calls than the next larger one: that
 * bound could never be reached. Equal values are allowed.
 */
function normalizeLimits(limits: unknown, report: Report): JsonValue {
  if (limits === undefined) return {};
  if (!isPlainObject(limits)) {
    report(
      "intent.invalid-limit",
      ["limits"],
      "`limits` must be an object with perMinute, perHour or perDay",
    );
    return null;
  }
  const valid = new Map<Window, number>();
  for (const key of Object.keys(limits)) {
    const bound = limits[key];
    if (!WINDOW_NAMES.has(key)) {
      report(
        "intent.invalid-limit",
        ["limits", key],
        `"${key}" is not a window of \`limits\`; use perMinute, perHour or perDay`,
      );
    } else if (bound === undefined) {
      continue;
    } else if (
      typeof bound !== "number" ||
      !Number.isSafeInteger(bound) ||
      bound <= 0
    ) {
      report(
        "intent.invalid-limit",
        ["limits", key],
        `\`limits.${key}\` must be a positive safe integer`,
      );
    } else {
      valid.set(key as Window, bound);
    }
  }
  const present = WINDOWS.filter((window) => valid.has(window));
  for (let index = 0; index + 1 < present.length; index += 1) {
    const smaller = present[index] as Window;
    const larger = present[index + 1] as Window;
    if ((valid.get(smaller) as number) > (valid.get(larger) as number)) {
      report(
        "intent.invalid-limit",
        ["limits", smaller],
        `\`limits.${smaller}\` is greater than \`limits.${larger}\`, so it can never be reached`,
      );
    }
  }
  return Object.fromEntries(valid);
}

/**
 * Resolves `invalidates` to qualified names of sources of this contract,
 * sorted and without repeats.
 */
function normalizeInvalidates(
  invalidates: unknown,
  context: DeclarationContext,
  report: Report,
): JsonValue {
  if (invalidates === undefined) return [];
  if (!isPlainArray(invalidates)) {
    report(
      "intent.invalid-invalidates",
      ["invalidates"],
      "`invalidates` must be an array of source names",
    );
    return null;
  }
  const own = `${context.contract}.`;
  const names = new Set<string>();
  invalidates.forEach((reference, index) => {
    if (typeof reference !== "string") {
      report(
        "intent.invalid-invalidates",
        ["invalidates", index],
        "an entry of `invalidates` must be a source name",
      );
      return;
    }
    const qualified = context.resolve(reference, {
      kind: "source",
      path: ["invalidates", index],
    });
    if (qualified === undefined) return;
    if (!qualified.startsWith(own)) {
      report(
        "intent.foreign-invalidates",
        ["invalidates", index],
        `"${reference}" is a source of an import; an intent invalidates only sources of its own contract`,
      );
      return;
    }
    names.add(qualified);
  });
  return [...names].sort(compareCodePoints);
}
