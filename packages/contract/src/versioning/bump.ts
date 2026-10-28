// The version bump that a list of changes requires, and the check of the
// next version against it. The check follows caret ranges (`^`), the form of
// import ranges: a breaking version leaves `^P`, a compatible one stays in it
// and grows (ADR 0006, "Required bump and the version check").

import type { ChangeClass } from "../core/changes.js";
import { compareVersions } from "../core/semver.js";

/** The smallest version bump the changes require. */
export type RequiredBump = "major" | "minor" | "none";

/** `major` with a breaking change, `minor` with compatible ones only, else `none`. */
export function requiredBumpOf(
  changes: readonly { readonly class: ChangeClass }[],
): RequiredBump {
  if (changes.some((change) => change.class === "breaking")) return "major";
  return changes.length > 0 ? "minor" : "none";
}

type Triple = readonly [number, number, number];

function triple(version: string): Triple {
  const [major, minor, patch] = (version.split("-", 1)[0] as string)
    .split(".")
    .map(Number);
  return [major as number, minor as number, patch as number];
}

function compareTriples(a: Triple, b: Triple): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = Math.sign((a[index] as number) - (b[index] as number));
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The lowest `X.Y.Z` that leaves (`major`) or grows inside (`minor`) `^P`. */
function floorOf(previous: Triple, bump: "major" | "minor"): Triple {
  const [major, minor, patch] = previous;
  if (major >= 1) {
    return bump === "major" ? [major + 1, 0, 0] : [major, minor + 1, 0];
  }
  if (minor >= 1) {
    return bump === "major" ? [0, minor + 1, 0] : [0, minor, patch + 1];
  }
  return [0, 0, patch + 1];
}

/**
 * Checks the next version against the previous one and the required bump.
 * Returns `undefined` when it is enough, or what it must be otherwise. Both
 * versions are valid contract versions.
 */
export function checkBump(
  previous: string,
  next: string,
  bump: RequiredBump,
): string | undefined {
  const order = compareVersions(next, previous);
  if (previous.includes("-")) {
    // A pre-release is unstable: any change needs a higher version.
    if (bump === "none") return order >= 0 ? undefined : `at least ${previous}`;
    return order > 0 ? undefined : `higher than ${previous}`;
  }
  if (bump === "none") return order >= 0 ? undefined : `at least ${previous}`;
  const floor = floorOf(triple(previous), bump);
  if (order >= 0 && compareTriples(triple(next), floor) >= 0) return undefined;
  return `at least ${floor.join(".")}`;
}
