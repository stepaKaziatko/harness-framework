// The grammar of names: segments, local names, qualified names and codes.

/** Lowercase kebab-case; a letter starts the name and every part after `-`. */
const SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/;

/** Longest segment, in characters. */
export const MAX_SEGMENT_LENGTH = 32;

/** Most segments in a local name. */
export const MAX_LOCAL_SEGMENTS = 3;

/** Longest qualified name `<contract>.<local>`, in characters. */
export const MAX_QUALIFIED_LENGTH = 64;

/** True for one name segment: `quotes`, `quotes-feed`, `v2`. */
export function isSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_SEGMENT_LENGTH &&
    SEGMENT.test(value)
  );
}

/** True for a path of 1 to `maxSegments` segments joined by `.`. */
export function isPath(
  value: unknown,
  maxSegments = MAX_LOCAL_SEGMENTS,
): value is string {
  if (typeof value !== "string") return false;
  const segments = value.split(".");
  return segments.length <= maxSegments && segments.every(isSegment);
}

/** The qualified name of a local name in a contract. */
export function qualify(contract: string, local: string): string {
  return `${contract}.${local}`;
}

/**
 * True when `local` is a valid local name of `contract`: 1 to 3 segments and a
 * qualified name of at most 64 characters.
 */
export function isLocalName(contract: string, local: unknown): local is string {
  return (
    isPath(local) && qualify(contract, local).length <= MAX_QUALIFIED_LENGTH
  );
}

/** The first segment of a dotted path. */
export function firstSegment(path: string): string {
  const dot = path.indexOf(".");
  return dot === -1 ? path : path.slice(0, dot);
}

/** A diagnostic code: `<area>.<detail>`, both parts kebab-case segments. */
export function isDiagnosticCode(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return (
    parts.length === 2 &&
    parts.every((part) => SEGMENT.test(part) && part.length > 0)
  );
}
