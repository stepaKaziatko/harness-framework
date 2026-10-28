// The diagnostic codes of the source kind (ADR 0004). Every code is an error.
// Renaming or removing a code after a release is a breaking change of the
// package; adding one is a minor change.

import type {
  DiagnosticCatalog,
  DiagnosticCodeInfo,
} from "../../core/diagnostics.js";

const error = (summary: string): DiagnosticCodeInfo =>
  Object.freeze({ severity: "error", summary });

/** The catalog of the diagnostic codes of the source kind. */
export const sourceDiagnostics = Object.freeze({
  "source.unknown-field": error(
    "The source has a key that is neither part of the declaration envelope nor one of params, result and subscription.",
  ),
  "source.missing-result": error("The source does not declare a result."),
  "source.params-not-object": error(
    "The parameters of the source are not described by an object schema.",
  ),
  "source.invalid-subscription": error(
    "The subscription is not an object with exactly the key intervalMs, or intervalMs is not an integer.",
  ),
  "source.interval-out-of-range": error(
    "The subscription interval is outside 100 ms to 3 600 000 ms.",
  ),
} as const satisfies DiagnosticCatalog);

/** A diagnostic code of the source kind. */
export type SourceDiagnosticCode = keyof typeof sourceDiagnostics;
