// Contract versions (SemVer 2.0.0 without build metadata) and the narrow
// grammar of import ranges. Every accepted range is also a valid node-semver
// range with the same meaning, so a later switch to `semver` is compatible.

const NUMBER = "(?:0|[1-9]\\d*)";
const PRERELEASE_ID = "(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)";
const CORE = `(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})`;

const VERSION = new RegExp(
  `^${CORE}(?:-${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*)?$`,
);
const PLAIN = new RegExp(`^${CORE}$`);
const BARE = `${NUMBER}\\.${NUMBER}\\.${NUMBER}`;
const SINGLE = new RegExp(`^[\\^~]?(${BARE})$`);
const BOUNDED = new RegExp(`^>=(${BARE}) <(${BARE})$`);

/** Longest version string, as in node-semver. */
const MAX_VERSION_LENGTH = 256;

function safeNumbers(version: string): boolean {
  const match = PLAIN.exec(version.split("-", 1)[0] as string);
  if (match === null) return false;
  return match
    .slice(1, 4)
    .every((part) => Number(part) <= Number.MAX_SAFE_INTEGER);
}

/**
 * True for a SemVer 2.0.0 version with an optional pre-release and without
 * build metadata: `0.1.0`, `1.0.0-rc.1`.
 */
export function isContractVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_VERSION_LENGTH &&
    VERSION.test(value) &&
    safeNumbers(value)
  );
}

/**
 * True for a range of the narrow grammar: alternatives joined by ` || `, each
 * one of `X.Y.Z`, `^X.Y.Z`, `~X.Y.Z` or `>=X.Y.Z <X.Y.Z`, without pre-releases
 * and without leading zeros.
 */
export function isImportRange(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_VERSION_LENGTH) {
    return false;
  }
  return value.split(" || ").every((alternative) => {
    const single = SINGLE.exec(alternative);
    if (single !== null) return safeNumbers(single[1] as string);
    const bounded = BOUNDED.exec(alternative);
    if (bounded !== null) {
      return (
        safeNumbers(bounded[1] as string) && safeNumbers(bounded[2] as string)
      );
    }
    return false;
  });
}
