// An extension that exists only in tests. It proves that an extension plugs
// into the core without a change to src/: it puts names into the namespace of
// the contract, reads normalized declarations and gives its own section.

import {
  defineExtension,
  type ChangeTable,
  type DiagnosticCatalog,
  type ExtensionContext,
  type ExtensionSection,
  type JsonValue,
} from "../../src/index.js";

export interface LayoutPanel {
  readonly name: string;
  /** A reference to a probe declaration. */
  readonly source: string;
  readonly stability?: string;
}

export interface LayoutInput {
  readonly panels: readonly LayoutPanel[];
}

export const layoutChanges: ChangeTable = {
  fields: {
    panels: {
      rule: "nested",
      table: {
        entry: { added: "compatible", removed: "breaking" },
        fields: {
          source: { rule: "breaking" },
          sourceStability: { rule: "compatible" },
          stability: {
            rule: "ordered",
            order: ["internal", "beta", "public"],
            raised: "compatible",
            lowered: "breaking",
          },
        },
      },
    },
  },
};

export const layoutDiagnostics: DiagnosticCatalog = {
  "layout.empty": {
    severity: "warning",
    summary: "The layout has no panels.",
  },
};

export function layoutNames(section: ExtensionSection<LayoutInput>) {
  return section.panels.map((panel, index) => ({
    name: panel.name,
    kind: "panel",
    path: ["panels", index, "name"],
  }));
}

export function normalizeLayout(
  section: ExtensionSection<LayoutInput>,
  context: ExtensionContext,
): JsonValue {
  if (section.panels.length === 0) {
    context.report("layout.empty", ["panels"], "the layout has no panels");
  }
  const panels: Record<string, JsonValue> = {};
  section.panels.forEach((panel, index) => {
    const source = context.resolve(panel.source, {
      kind: "probe",
      path: ["panels", index, "source"],
    });
    const declaration =
      source === undefined ? undefined : context.declarations[source];
    panels[`${context.contract}.${panel.name}`] = {
      source: source ?? null,
      sourceStability: declaration?.stability ?? null,
      stability: context.stability(panel.stability, [
        "panels",
        index,
        "stability",
      ]),
    };
  });
  return { panels };
}

export const layout = defineExtension<"layout", LayoutInput>({
  id: "layout",
  names: layoutNames,
  normalize: normalizeLayout,
  changes: layoutChanges,
  diagnostics: layoutDiagnostics,
});

/** What an extension module builds on top of its descriptor. */
export function defineLayout(
  input: LayoutInput,
): ExtensionSection<LayoutInput> {
  return layout.declare(input);
}
