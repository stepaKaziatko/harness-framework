// A declaration kind that exists only in tests. It proves that a kind plugs
// into the core without a change to src/: it uses every part of the context
// and every rule of the change table.

import type { $ZodType } from "zod/v4/core";
import {
  defineDeclarationKind,
  type ChangeTable,
  type Declaration,
  type DeclarationContext,
  type DeclarationEnvelope,
  type DiagnosticCatalog,
  type JsonValue,
} from "../../src/index.js";

/** A reference with an optional kind filter. */
export type ProbeReference =
  string | { readonly ref: string; readonly kind?: string };

/** The payload of a probe declaration. */
export interface ProbeInput extends DeclarationEnvelope {
  readonly input?: $ZodType;
  readonly output?: $ZodType;
  readonly refs?: readonly ProbeReference[];
  readonly tags?: readonly string[];
  readonly level?: "low" | "high";
  readonly options?: { readonly retries?: number; readonly note?: string };
  readonly note?: string;
  /** Makes the kind report its own warning. */
  readonly unusual?: boolean;
}

export const probeChanges: ChangeTable = {
  fields: {
    input: { rule: "schema", direction: "input" },
    output: { rule: "schema", direction: "output" },
    refs: { rule: "breaking" },
    note: { rule: "compatible" },
    tags: { rule: "set", added: "compatible", removed: "breaking" },
    level: {
      rule: "ordered",
      order: ["low", "high"],
      raised: "compatible",
      lowered: "breaking",
    },
    options: {
      rule: "nested",
      table: {
        fields: {
          retries: { rule: "compatible" },
          note: { rule: "compatible" },
        },
      },
    },
  },
};

export const probeDiagnostics: DiagnosticCatalog = {
  "probe.unusual": {
    severity: "warning",
    summary: "The probe was asked to report a warning.",
  },
};

/** The `normalize` of the probe kind, exported so a test can spy on it. */
export function normalizeProbe(
  declaration: Declaration<string, ProbeInput>,
  context: DeclarationContext,
): JsonValue {
  const spec: Record<string, JsonValue> = {};
  if (declaration.input !== undefined) {
    spec.input = context.schema(declaration.input, "input", ["input"]) ?? null;
  }
  if (declaration.output !== undefined) {
    spec.output =
      context.schema(declaration.output, "output", ["output"]) ?? null;
  }
  spec.refs = (declaration.refs ?? []).map((reference, index) => {
    const { ref, kind } =
      typeof reference === "string"
        ? { ref: reference, kind: undefined }
        : reference;
    return (
      context.resolve(ref, {
        ...(kind === undefined ? {} : { kind }),
        path: ["refs", index],
      }) ?? null
    );
  });
  spec.tags = [...new Set(declaration.tags ?? [])].sort();
  spec.level = declaration.level ?? "low";
  if (declaration.options !== undefined)
    spec.options = { ...declaration.options };
  if (declaration.note !== undefined) spec.note = declaration.note;
  if (declaration.unusual === true) {
    context.report("probe.unusual", ["unusual"], `${context.name} is unusual`);
  }
  return spec;
}

/** Creates a probe kind; tests pass their own `normalize` to spy on it. */
export function createProbeKind(
  normalize: typeof normalizeProbe = normalizeProbe,
) {
  return defineDeclarationKind<"probe", ProbeInput>({
    kind: "probe",
    normalize,
    changes: probeChanges,
    diagnostics: probeDiagnostics,
  });
}

/** The probe kind. */
export const probe = createProbeKind();

/** What a kind module builds on top of its descriptor: its `define*`. */
export function defineProbe(
  input: ProbeInput,
): Declaration<"probe", ProbeInput> {
  return probe.declare(input);
}
