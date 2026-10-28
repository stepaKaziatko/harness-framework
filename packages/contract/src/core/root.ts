// The contract root: what `paddock/contract.ts` exports by default.

import {
  DESCRIPTOR,
  type Declaration,
  type ExtensionSection,
} from "./descriptor.js";
import { freezeCopy } from "./json.js";

/** A subject that a permission can be granted to. Today only the end user. */
export interface EndUserSubject {
  readonly kind: "end-user";
}

/** A permission subject, discriminated by `kind`. */
export type Subject = EndUserSubject;

/** A permission declared by the contract. */
export interface PermissionInput {
  /** Who can be granted the permission. Defaults to `[{ kind: "end-user" }]`. */
  readonly subjects?: readonly Subject[];
  readonly description?: string;
}

/** An import of another contract by name and version range. */
export interface ImportInput {
  /** The name of the imported contract. */
  readonly contract: string;
  /** A range of the narrow grammar: `1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3 <2.0.0`, joined by ` || `. */
  readonly range: string;
}

/** The fields of a contract root. */
export interface ContractInput {
  /** The contract name: one lowercase kebab-case segment. */
  readonly name: string;
  /** SemVer 2.0.0 without build metadata. */
  readonly version: string;
  readonly imports?: readonly ImportInput[];
  /** Permissions by local name. */
  readonly permissions?: Readonly<Record<string, PermissionInput>>;
  /** Declarations created by declaration kinds. */
  readonly declarations?: readonly Declaration[];
  /** Sections created by extensions. */
  readonly extensions?: readonly ExtensionSection[];
}

/** The value `defineContract` returns: the input, deeply frozen. */
export type ContractRoot<T extends ContractInput = ContractInput> = Readonly<T>;

/**
 * Declares the contract root. The product exports its result by default from
 * `paddock/contract.ts`. It checks nothing and never throws: it returns a
 * deeply frozen copy of plain objects and arrays, keeping declarations and
 * sections tied to their descriptors. `normalize` does the checking.
 */
export function defineContract<const T extends ContractInput>(
  input: T,
): ContractRoot<T> {
  return freezeCopy(input, [DESCRIPTOR]);
}
