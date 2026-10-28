// Replace with defineSource from src/kinds/source once HAF-20 is merged.
//
// A stand-in declaration kind named "source", for the tests of `invalidates`
// of intents. It does not imitate the fields of real sources: an intent sees
// a source only through the kind name "source" in the namespace.

import {
  defineDeclarationKind,
  type Declaration,
  type DeclarationEnvelope,
} from "../../src/index.js";

/** The stand-in source kind. */
export const sourceStubKind = defineDeclarationKind<
  "source",
  DeclarationEnvelope
>({
  kind: "source",
  normalize: () => ({}),
  changes: { fields: {} },
  diagnostics: {},
});

/** Declares a stand-in source with a name and optional permissions. */
export function defineSourceStub(input: {
  readonly name: string;
  readonly requires?: readonly string[];
}): Declaration<"source", DeclarationEnvelope> {
  return sourceStubKind.declare(input);
}
