// Public entry point of @paddockjs/contract: the contract core.

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
