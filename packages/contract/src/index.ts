// Public entry point of @paddockjs/contract: the contract core.
// The list of values exported here is an allowlist pinned by test/smoke.test.ts.

export { coreChangeTable } from "./core/changes.js";
export type {
  AddRemoveClasses,
  BreakingRule,
  ChangeClass,
  ChangeRule,
  ChangeTable,
  CompatibleRule,
  NestedRule,
  OrderedRule,
  SchemaRule,
  SetRule,
} from "./core/changes.js";

export { defineDeclarationKind, defineExtension } from "./core/descriptor.js";
export type {
  Declaration,
  DeclarationContext,
  DeclarationEnvelope,
  DeclarationKind,
  DeclarationKindOptions,
  Extension,
  ExtensionContext,
  ExtensionName,
  ExtensionOptions,
  ExtensionSection,
  ModelDeclaration,
  NormalizeContext,
  ResolveOptions,
  Stability,
} from "./core/descriptor.js";

export { diagnosticCodes } from "./core/diagnostics.js";
export type {
  CoreDiagnosticCode,
  Diagnostic,
  DiagnosticCatalog,
  DiagnosticCodeInfo,
  DiagnosticPath,
  Severity,
} from "./core/diagnostics.js";

export type {
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
} from "./core/json.js";

export { MODEL_FORMAT_VERSION } from "./core/model.js";
export type {
  ContractModel,
  ModelImport,
  ModelPermission,
} from "./core/model.js";

export { normalize } from "./core/normalize.js";
export type { NormalizeResult } from "./core/normalize.js";

export { defineContract } from "./core/root.js";
export type {
  ContractInput,
  ContractRoot,
  EndUserSubject,
  ImportInput,
  PermissionInput,
  Subject,
} from "./core/root.js";

// Declaration kind: source (ADR 0004).
export { defineSource, sourceKind } from "./kinds/source/index.js";
export type {
  Source,
  SourceDiagnosticCode,
  SourceInput,
  SourceSpec,
  SourceSubscription,
} from "./kinds/source/index.js";
