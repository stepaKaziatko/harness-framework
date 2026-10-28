// Declaration kinds and extensions. There is no registry: a value carries its
// descriptor under a symbol key, which JSON serialization does not see, and
// `normalize` finds descriptors in the values themselves.

import type { ChangeTable } from "./changes.js";
import type { DiagnosticCatalog, DiagnosticPath } from "./diagnostics.js";
import {
  freezeCopy,
  isPlainObject,
  type JsonObject,
  type JsonValue,
} from "./json.js";
import type { $ZodType } from "zod/v4/core";

/**
 * The symbol under which a declaration or an extension section carries its
 * descriptor. `Symbol.for` keeps it the same across two copies of the package.
 */
export const DESCRIPTOR = Symbol.for("@paddockjs/contract/descriptor");

/** The symbol that tells declaration kind descriptors from extension descriptors. */
const DESCRIPTOR_TYPE = Symbol.for("@paddockjs/contract/descriptor-type");

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

/** Options of {@link NormalizeContext.resolve}. */
export interface ResolveOptions {
  /** The kind the reference must name. Checked only for names of this contract. */
  readonly kind?: string;
  /** Where the reference is, relative to the value being normalized. */
  readonly path?: DiagnosticPath;
}

/** What the core gives to a kind or an extension while it normalizes a value. */
export interface NormalizeContext {
  /** The name of the contract being normalized. */
  readonly contract: string;
  /**
   * Resolves a reference written as a local path (`quotes.feed`) or as
   * `<import>.<path>` (`auth.users.get`) and returns its qualified name. On a
   * problem it reports a `reference.*` diagnostic and returns `undefined`. A
   * reference into an import is checked for syntax and for the import only.
   */
  resolve(reference: string, options?: ResolveOptions): string | undefined;
  /**
   * Converts a zod schema to JSON Schema (draft 2020-12) for the given
   * direction: `input` for values the product receives, `output` for values
   * it returns. On a problem it reports `schema.invalid` or
   * `schema.unrepresentable` at `path` and returns `undefined`.
   */
  schema(
    schema: $ZodType,
    direction: "input" | "output",
    path?: DiagnosticPath,
  ): JsonObject | undefined;
  /**
   * Reports a diagnostic of the caller's own catalog. The code must start with
   * the caller's kind or extension id and a dot. `path` is relative to the
   * value being normalized.
   */
  report(code: string, path: DiagnosticPath, message: string): void;
  /**
   * Checks a `stability` value of a named element and returns it, or
   * `internal` when it is absent. A wrong value is reported as
   * `declaration.invalid-stability` at `path`.
   */
  stability(value: unknown, path?: DiagnosticPath): Stability;
}

/** The context of a declaration kind. */
export interface DeclarationContext extends NormalizeContext {
  /** The qualified name of the declaration being normalized. */
  readonly name: string;
}

/** A normalized declaration as it appears in the model. */
export interface ModelDeclaration {
  readonly kind: string;
  readonly stability: Stability;
  readonly requires: readonly string[];
  readonly description?: string;
  readonly spec: JsonValue;
}

/** The context of an extension. */
export interface ExtensionContext extends NormalizeContext {
  /** Normalized declarations of the contract, by qualified name. */
  readonly declarations: Readonly<Record<string, ModelDeclaration>>;
}

/** A name that an extension puts into the namespace of the contract. */
export interface ExtensionName {
  /** Local name: 1 to 3 segments joined by `.`. */
  readonly name: string;
  /** The kind that `resolve` checks against, for example `widget`. */
  readonly kind: string;
  /** Where the name is, relative to the section. */
  readonly path?: DiagnosticPath;
}

/** What a declaration kind module passes to {@link defineDeclarationKind}. */
export interface DeclarationKindOptions<
  K extends string,
  T extends DeclarationEnvelope,
> {
  /** The kind; also the prefix of the kind's diagnostic codes. */
  readonly kind: K;
  /** Turns a declaration into the plain JSON `spec` of the model. */
  readonly normalize: (
    declaration: Declaration<K, T>,
    context: DeclarationContext,
  ) => JsonValue;
  /** How changes of `spec` are classified. */
  readonly changes: ChangeTable;
  /** The kind's own diagnostic codes, each prefixed with `<kind>.`. */
  readonly diagnostics: DiagnosticCatalog;
}

/** A declaration kind descriptor. */
export interface DeclarationKind<
  K extends string = string,
  T extends DeclarationEnvelope = DeclarationEnvelope,
> extends DeclarationKindOptions<K, T> {
  /** Creates a frozen declaration of this kind; a kind's `define*` calls it. */
  declare(input: T): Declaration<K, T>;
}

/** What an extension module passes to {@link defineExtension}. */
export interface ExtensionOptions<I extends string, T extends object> {
  /** The id; the key of the section in `extensions` of the model and the prefix of its codes. */
  readonly id: I;
  /** Names the section puts into the namespace of the contract. */
  readonly names: (
    section: ExtensionSection<T>,
    context: ExtensionContext,
  ) => readonly ExtensionName[];
  /** Turns the section into plain JSON for `extensions.<id>` of the model. */
  readonly normalize: (
    section: ExtensionSection<T>,
    context: ExtensionContext,
  ) => JsonValue;
  /** How changes of the section are classified. */
  readonly changes: ChangeTable;
  /** The extension's own diagnostic codes, each prefixed with `<id>.`. */
  readonly diagnostics: DiagnosticCatalog;
}

/** An extension descriptor. */
export interface Extension<
  I extends string = string,
  T extends object = object,
> extends ExtensionOptions<I, T> {
  /** Creates a frozen section of this extension for `extensions` of the root. */
  declare(input: T): ExtensionSection<T>;
}

/** A descriptor as found on a value, with its type resolved. */
export type FoundDescriptor =
  | {
      readonly type: "kind";
      readonly id: unknown;
      readonly descriptor: DeclarationKind;
    }
  | {
      readonly type: "extension";
      readonly id: unknown;
      readonly descriptor: Extension;
    };

/**
 * Creates a declaration kind descriptor. It checks nothing and never throws:
 * `normalize` checks the descriptor where it is used.
 */
export function defineDeclarationKind<
  const K extends string,
  T extends DeclarationEnvelope = DeclarationEnvelope,
>(options: DeclarationKindOptions<K, T>): DeclarationKind<K, T> {
  const descriptor = {
    kind: options.kind,
    normalize: options.normalize,
    changes: freezeCopy(options.changes),
    diagnostics: freezeCopy(options.diagnostics),
    declare(input: T): Declaration<K, T> {
      return attach(
        { ...input, kind: options.kind },
        descriptor,
      ) as Declaration<K, T>;
    },
  };
  Object.defineProperty(descriptor, DESCRIPTOR_TYPE, { value: "kind" });
  return Object.freeze(descriptor);
}

/**
 * Creates an extension descriptor. It checks nothing and never throws:
 * `normalize` checks the descriptor where it is used.
 */
export function defineExtension<
  const I extends string,
  T extends object = object,
>(options: ExtensionOptions<I, T>): Extension<I, T> {
  const descriptor = {
    id: options.id,
    names: options.names,
    normalize: options.normalize,
    changes: freezeCopy(options.changes),
    diagnostics: freezeCopy(options.diagnostics),
    declare(input: T): ExtensionSection<T> {
      return attach({ ...input }, descriptor) as ExtensionSection<T>;
    },
  };
  Object.defineProperty(descriptor, DESCRIPTOR_TYPE, { value: "extension" });
  return Object.freeze(descriptor);
}

function attach(value: object, descriptor: object): object {
  const carrier: Record<string | symbol, unknown> = { ...value };
  carrier[DESCRIPTOR] = descriptor;
  return freezeCopy(carrier, [DESCRIPTOR]);
}

/** Finds the descriptor a value carries, or `undefined`. */
export function findDescriptor(value: unknown): FoundDescriptor | undefined {
  if (!isPlainObject(value)) return undefined;
  const descriptor = value[DESCRIPTOR];
  if (typeof descriptor !== "object" || descriptor === null) return undefined;
  const type = (descriptor as Record<symbol, unknown>)[DESCRIPTOR_TYPE];
  if (type === "kind") {
    const kind = descriptor as DeclarationKind;
    return { type, id: kind.kind, descriptor: kind };
  }
  if (type === "extension") {
    const extension = descriptor as Extension;
    return { type, id: extension.id, descriptor: extension };
  }
  return undefined;
}
