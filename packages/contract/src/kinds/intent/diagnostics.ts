// The diagnostic codes of the intent kind (ADR 0005). Renaming or removing a
// code after a release is a breaking change of the package.

import type {
  DiagnosticCatalog,
  DiagnosticCodeInfo,
} from "../../core/diagnostics.js";

const error = (summary: string): DiagnosticCodeInfo =>
  Object.freeze({ severity: "error", summary });

/** The catalog of `intent.*` codes; every code is an error. */
export const intentDiagnostics = Object.freeze({
  "intent.unknown-field": error(
    "An intent has a key that the intent kind does not define, such as a handler.",
  ),
  "intent.params-not-object": error(
    "The JSON Schema of `params` is not an object schema at the top level.",
  ),
  "intent.missing-confirmation": error(
    "An intent does not say which confirmation policy the host applies.",
  ),
  "intent.unknown-confirmation": error(
    "`confirmation` is not one of none, user or step-up.",
  ),
  "intent.invalid-limit": error(
    "`limits` is not an object of perMinute, perHour and perDay with positive safe integers that do not decrease with the window.",
  ),
  "intent.missing-requires": error(
    "An intent does not name at least one permission in `requires`.",
  ),
  "intent.invalid-invalidates": error(
    "`invalidates` is not an array of strings.",
  ),
  "intent.foreign-invalidates": error(
    "`invalidates` names a source of an imported contract.",
  ),
} as const satisfies DiagnosticCatalog);

/** A code of the intent catalog. */
export type IntentDiagnosticCode = keyof typeof intentDiagnostics;
