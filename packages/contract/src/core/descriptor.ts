// Declarations and extension sections carry their descriptor under a symbol
// key, which JSON serialization does not see. Declaration kinds and
// extensions that create such values come in the next step.

import type { JsonValue } from "./json.js";

/**
 * The symbol under which a declaration or an extension section carries its
 * descriptor. `Symbol.for` keeps it the same across two copies of the package.
 */
export const DESCRIPTOR = Symbol.for("@paddockjs/contract/descriptor");

/** How public a declaration is. The default is `internal`. */
export type Stability = "internal" | "beta" | "public";

/** Fields of the core envelope that every declaration has, besides `kind`. */
export interface DeclarationEnvelope {
  /** Local name: 1 to 3 segments joined by `.`, for example `quotes.feed`. */
  readonly name: string;
  /** Defaults to `internal`. */
  readonly stability?: Stability;
  /** Local names of permissions of this contract. */
  readonly requires?: readonly string[];
  readonly description?: string;
}

/** A declaration value: the envelope, the payload of its kind and its `kind`. */
export type Declaration<
  K extends string = string,
  T extends DeclarationEnvelope = DeclarationEnvelope,
> = Readonly<T> & { readonly kind: K };

/** An extension section value as placed in `extensions` of the root. */
export type ExtensionSection<T extends object = object> = Readonly<T>;

/** A normalized declaration as it appears in the model. */
export interface ModelDeclaration {
  readonly kind: string;
  readonly stability: Stability;
  readonly requires: readonly string[];
  readonly description?: string;
  readonly spec: JsonValue;
}
