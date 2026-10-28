// The version bump that a list of changes requires.

import type { ChangeClass } from "../core/changes.js";

/** The smallest version bump the changes require. */
export type RequiredBump = "major" | "minor" | "none";

/** `major` with a breaking change, `minor` with compatible ones only, else `none`. */
export function requiredBumpOf(
  changes: readonly { readonly class: ChangeClass }[],
): RequiredBump {
  if (changes.some((change) => change.class === "breaking")) return "major";
  return changes.length > 0 ? "minor" : "none";
}
