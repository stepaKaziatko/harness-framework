// Diagnostics: the shape of a finding, the catalog of core codes and the
// collector that keeps them in a deterministic order.

/** How bad a finding is. Only errors make `normalize` fail. */
export type Severity = "error" | "warning";

/** A path into the object passed to `defineContract`. */
export type DiagnosticPath = readonly (string | number)[];

/** One finding of `normalize`. */
export interface Diagnostic {
  /** A code from {@link diagnosticCodes} or from a kind's or extension's catalog. */
  readonly code: string;
  /** Always the severity the catalog gives for `code`. */
  readonly severity: Severity;
  /** Where the problem is, from the root of the object passed to `defineContract`. */
  readonly path: DiagnosticPath;
  /** Human-readable explanation; not part of the contract. */
  readonly message: string;
}

/** A catalog entry: the severity of a code and a one-line summary. */
export interface DiagnosticCodeInfo {
  readonly severity: Severity;
  readonly summary: string;
}

/** A catalog of diagnostic codes. */
export type DiagnosticCatalog = Readonly<Record<string, DiagnosticCodeInfo>>;

/**
 * Areas of diagnostic codes that belong to the core. A kind or an extension
 * may not use one of these as its identifier, because its own codes are
 * prefixed with that identifier.
 */
export const RESERVED_CODE_AREAS = Object.freeze([
  "root",
  "contract",
  "name",
  "import",
  "reference",
  "permission",
  "declaration",
  "descriptor",
  "schema",
] as const);

const error = (summary: string): DiagnosticCodeInfo =>
  Object.freeze({ severity: "error", summary });

/**
 * The catalog of core diagnostic codes. Renaming or removing a code after a
 * release is a breaking change of the package.
 */
export const diagnosticCodes = Object.freeze({
  "root.invalid-shape": error(
    "The input is not an object, or a field of the root or of its entries has the wrong type.",
  ),
  "root.unknown-field": error(
    "The root has a key that the contract does not define.",
  ),
  "contract.invalid-name": error(
    "The contract name is not a single lowercase kebab-case segment of 1 to 32 characters.",
  ),
  "contract.invalid-version": error(
    "The contract version is not SemVer 2.0.0, or it carries build metadata.",
  ),
  "import.invalid-contract": error(
    "The imported contract name is not a single lowercase kebab-case segment.",
  ),
  "import.invalid-range": error(
    "The version range of an import is outside the range grammar.",
  ),
  "import.self": error("The contract imports itself."),
  "import.duplicate": error("The same contract is imported more than once."),
  "name.invalid": error(
    "A local name is not 1 to 3 segments, or its qualified name is longer than 64 characters.",
  ),
  "name.duplicate": error(
    "Two entries of the contract namespace have the same qualified name.",
  ),
  "name.import-conflict": error(
    "The first segment of a local name equals the name of an import.",
  ),
  "reference.invalid": error(
    "A reference is not a valid local or imported path.",
  ),
  "reference.unknown": error(
    "A local reference does not name anything in the contract and does not start with an import.",
  ),
  "reference.kind-mismatch": error(
    "A reference names an entry of a different kind.",
  ),
  "permission.unknown": error(
    "`requires` names a permission that the contract does not declare, or a permission of an import.",
  ),
  "permission.unknown-subject": error(
    "A permission subject has an unknown `kind`.",
  ),
  "permission.empty-subjects": error(
    "A permission has an empty `subjects` list.",
  ),
  "declaration.invalid-envelope": error(
    "A declaration lacks `kind` or `name`, or its `requires` or `description` has the wrong type.",
  ),
  "declaration.invalid-stability": error(
    "`stability` is not one of internal, beta or public.",
  ),
  "declaration.unknown-kind": error(
    "A declaration does not carry a declaration kind descriptor.",
  ),
  "descriptor.conflict": error(
    "Two different descriptors share one kind or extension id, or one extension is given twice.",
  ),
  "descriptor.reserved-id": error(
    "A kind or extension id is not a valid segment or takes a reserved code area.",
  ),
  "descriptor.invalid-changes": error(
    "The change classification table of a descriptor uses a rule outside the closed set.",
  ),
  "descriptor.undeclared-code": error(
    "A kind or extension reported a code missing from its catalog or without its own prefix.",
  ),
  "descriptor.non-json-output": error(
    "A kind or extension produced a value that is not plain JSON.",
  ),
  "descriptor.failed": error(
    "A function of a kind or extension threw, or returned names of the wrong shape.",
  ),
  "schema.invalid": error("The value passed as a schema is not a zod schema."),
  "schema.unrepresentable": error(
    "The zod schema cannot be represented as JSON Schema.",
  ),
} as const satisfies DiagnosticCatalog);

/** A code of the core catalog. */
export type CoreDiagnosticCode = keyof typeof diagnosticCodes;

/** Collects diagnostics in the order they are found. */
export class DiagnosticCollector {
  readonly #items: Diagnostic[] = [];

  /** Adds a core diagnostic; its severity comes from the core catalog. */
  core(code: CoreDiagnosticCode, path: DiagnosticPath, message: string): void {
    this.add({ code, severity: diagnosticCodes[code].severity, path, message });
  }

  /** Adds a diagnostic whose severity is already resolved. */
  add(diagnostic: Diagnostic): void {
    this.#items.push(
      Object.freeze({
        code: diagnostic.code,
        severity: diagnostic.severity,
        path: Object.freeze([...diagnostic.path]),
        message: diagnostic.message,
      }),
    );
  }

  /** True when at least one error has been collected. */
  hasErrors(): boolean {
    return this.#items.some((item) => item.severity === "error");
  }

  /** The collected diagnostics, in order. */
  list(): Diagnostic[] {
    return [...this.#items];
  }
}
