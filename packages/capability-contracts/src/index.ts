import type {
  CapabilityRecord,
  RiskClass,
  RouteKind,
} from "../../core-contracts/src/index.js";

export const CAPABILITY_CONTRACT_FIELD_TYPES = [
  "NUMBER",
  "STRING",
  "BOOLEAN",
  "ENUM",
] as const;
export type CapabilityContractFieldTypeV1 =
  (typeof CAPABILITY_CONTRACT_FIELD_TYPES)[number];

export interface CapabilityContractFieldV1 {
  readonly name: string;
  readonly type: CapabilityContractFieldTypeV1;
  readonly required: boolean;
  readonly nominal: number | string | boolean;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly enumValues?: readonly string[];
}

export interface CapabilityContractEdgeCaseV1 {
  readonly edgeId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly expectedOutcome: "ACCEPT" | "REJECT";
  readonly assertions: readonly string[];
}

export interface CapabilityProofContractV1 {
  readonly schema: "editflow.capability-proof-contract.v1";
  readonly capabilityId: string;
  readonly riskClass: RiskClass;
  readonly dependencies: readonly string[];
  readonly supportedRouteKinds: readonly RouteKind[];
  readonly inputFields: readonly CapabilityContractFieldV1[];
  readonly readbackAssertions: readonly string[];
  readonly rollbackAssertions: readonly string[];
  readonly edgeConditions: readonly string[];
  readonly edgeCases?: readonly CapabilityContractEdgeCaseV1[];
}

export type GeneratedCapabilityProofKindV1 =
  | "NOMINAL"
  | "READBACK"
  | "ROLLBACK"
  | "BOUNDARY"
  | "INVALID_INPUT"
  | "EDGE_CASE";

export interface GeneratedCapabilityProofCaseV1 {
  readonly caseId: string;
  readonly capabilityId: string;
  readonly kind: GeneratedCapabilityProofKindV1;
  readonly input: Readonly<Record<string, unknown>>;
  readonly expectedOutcome: "ACCEPT" | "REJECT";
  readonly assertions: readonly string[];
  readonly rationale: string;
}

export interface CapabilityContractValidationV1 {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;
const fieldTypeMatches = (
  field: CapabilityContractFieldV1,
  value: unknown,
): boolean => {
  if (field.type === "NUMBER") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (field.type === "STRING") return typeof value === "string";
  if (field.type === "BOOLEAN") return typeof value === "boolean";
  return typeof value === "string"
    && (field.enumValues ?? []).includes(value);
};

export const validateCapabilityProofContractV1 = (
  contract: CapabilityProofContractV1,
): CapabilityContractValidationV1 => {
  const errors: string[] = [];
  if (contract.schema !== "editflow.capability-proof-contract.v1") {
    errors.push("Capability proof contract schema is invalid.");
  }
  if (!nonEmpty(contract.capabilityId)) errors.push("capabilityId must not be empty.");
  if (contract.supportedRouteKinds.length === 0) {
    errors.push("supportedRouteKinds must contain at least one route kind.");
  }
  if (contract.readbackAssertions.length === 0) {
    errors.push("readbackAssertions must contain at least one assertion.");
  }
  if (contract.riskClass !== "R0_READ_ONLY" && contract.rollbackAssertions.length === 0) {
    errors.push("Non-read-only capability contracts require rollbackAssertions.");
  }
  const names = new Set<string>();
  for (const field of contract.inputFields) {
    if (!nonEmpty(field.name)) errors.push("Capability input field name must not be empty.");
    if (names.has(field.name)) errors.push("Duplicate capability input field '" + field.name + "'.");
    names.add(field.name);
    if (!fieldTypeMatches(field, field.nominal)) {
      errors.push("Field '" + field.name + "' nominal value does not match type " + field.type + ".");
    }
    if (field.type === "NUMBER") {
      const nominal = field.nominal as number;
      if (field.min !== undefined && !Number.isFinite(field.min)) {
        errors.push("Field '" + field.name + "' min must be finite.");
      }
      if (field.max !== undefined && !Number.isFinite(field.max)) {
        errors.push("Field '" + field.name + "' max must be finite.");
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        errors.push("Field '" + field.name + "' min cannot exceed max.");
      }
      if (field.min !== undefined && nominal < field.min) {
        errors.push("Field '" + field.name + "' nominal is below min.");
      }
      if (field.max !== undefined && nominal > field.max) {
        errors.push("Field '" + field.name + "' nominal is above max.");
      }
      if (field.integer && !Number.isInteger(nominal)) {
        errors.push("Field '" + field.name + "' nominal must be an integer.");
      }
    }
    if (field.type === "ENUM") {
      const values = field.enumValues ?? [];
      if (values.length === 0 || values.some((value) => !nonEmpty(value))) {
        errors.push("ENUM field '" + field.name + "' requires non-empty enumValues.");
      }
      if (new Set(values).size !== values.length) {
        errors.push("ENUM field '" + field.name + "' contains duplicate enumValues.");
      }
      if (!values.includes(field.nominal as string)) {
        errors.push("ENUM field '" + field.name + "' nominal must be an enum value.");
      }
    } else if (field.enumValues !== undefined) {
      errors.push("Field '" + field.name + "' may declare enumValues only for ENUM type.");
    }
  }

  for (const dependency of contract.dependencies) {
    if (!nonEmpty(dependency)) errors.push("Capability dependency IDs must not be empty.");
    if (dependency === contract.capabilityId) {
      errors.push("Capability contract cannot depend on itself.");
    }
  }
  for (const assertion of [
    ...contract.readbackAssertions,
    ...contract.rollbackAssertions,
    ...contract.edgeConditions,
  ]) {
    if (!nonEmpty(assertion)) errors.push("Contract assertions and edge conditions must not be empty.");
  }
  const edgeIds = new Set<string>();
  for (const edgeCase of contract.edgeCases ?? []) {
    if (!nonEmpty(edgeCase.edgeId)) errors.push("Capability edge case edgeId must not be empty.");
    if (edgeIds.has(edgeCase.edgeId)) {
      errors.push("Duplicate capability edge case '" + edgeCase.edgeId + "'.");
    }
    edgeIds.add(edgeCase.edgeId);
    if (edgeCase.assertions.length === 0
      || edgeCase.assertions.some((assertion) => !nonEmpty(assertion))) {
      errors.push("Edge case '" + edgeCase.edgeId + "' requires non-empty assertions.");
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
};
export class CapabilityProofContractError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super("Capability proof contract invalid: " + errors.join(" | "));
    this.name = "CapabilityProofContractError";
    this.errors = errors;
  }
}

export const assertValidCapabilityProofContractV1 = (
  contract: CapabilityProofContractV1,
): CapabilityProofContractV1 => {
  const validation = validateCapabilityProofContractV1(contract);
  if (!validation.valid) throw new CapabilityProofContractError(validation.errors);
  return contract;
};

const nominalInput = (
  contract: CapabilityProofContractV1,
): Record<string, unknown> => Object.fromEntries(
  contract.inputFields.map((field) => [field.name, structuredClone(field.nominal)]),
);

const boundaryValue = (
  field: CapabilityContractFieldV1,
  side: "min" | "max",
): number | undefined => {
  if (field.type !== "NUMBER") return undefined;
  return side === "min" ? field.min : field.max;
};
const invalidTypeValue = (field: CapabilityContractFieldV1): unknown => {
  if (field.type === "NUMBER") return "not-a-number";
  if (field.type === "STRING") return 42;
  if (field.type === "BOOLEAN") return "true";
  return "__EDITFLOW_INVALID_ENUM__";
};

const invalidBelow = (field: CapabilityContractFieldV1): number | undefined => {
  if (field.type !== "NUMBER" || field.min === undefined) return undefined;
  return field.integer ? field.min - 1 : field.min - Math.max(1, Math.abs(field.min) * 0.01);
};

const invalidAbove = (field: CapabilityContractFieldV1): number | undefined => {
  if (field.type !== "NUMBER" || field.max === undefined) return undefined;
  return field.integer ? field.max + 1 : field.max + Math.max(1, Math.abs(field.max) * 0.01);
};

const withField = (
  base: Readonly<Record<string, unknown>>,
  name: string,
  value: unknown,
): Record<string, unknown> => ({ ...structuredClone(base), [name]: structuredClone(value) });

const withoutField = (
  base: Readonly<Record<string, unknown>>,
  name: string,
): Record<string, unknown> => {
  const copy = structuredClone(base) as Record<string, unknown>;
  delete copy[name];
  return copy;
};
export const validateCapabilityContractInputV1 = (
  contract: CapabilityProofContractV1,
  input: Readonly<Record<string, unknown>>,
): CapabilityContractValidationV1 => {
  const contractValidation = validateCapabilityProofContractV1(contract);
  if (!contractValidation.valid) return contractValidation;
  const errors: string[] = [];
  const fields = new Map(contract.inputFields.map((field) => [field.name, field]));

  for (const field of contract.inputFields) {
    const hasValue = Object.hasOwn(input, field.name);
    if (field.required && !hasValue) {
      errors.push("Required input field '" + field.name + "' is missing.");
      continue;
    }
    if (!hasValue) continue;
    const value = input[field.name];
    if (!fieldTypeMatches(field, value)) {
      errors.push("Input field '" + field.name + "' does not match type " + field.type + ".");
      continue;
    }
    if (field.type === "NUMBER") {
      const numeric = value as number;
      if (field.min !== undefined && numeric < field.min) {
        errors.push("Input field '" + field.name + "' is below min.");
      }
      if (field.max !== undefined && numeric > field.max) {
        errors.push("Input field '" + field.name + "' is above max.");
      }
      if (field.integer && !Number.isInteger(numeric)) {
        errors.push("Input field '" + field.name + "' must be an integer.");
      }
    }
  }

  for (const key of Object.keys(input)) {
    if (!fields.has(key)) errors.push("Unknown input field '" + key + "'.");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
};

const proofCase = (
  contract: CapabilityProofContractV1,
  caseId: string,
  kind: GeneratedCapabilityProofKindV1,
  input: Readonly<Record<string, unknown>>,
  expectedOutcome: "ACCEPT" | "REJECT",
  assertions: readonly string[],
  rationale: string,
): GeneratedCapabilityProofCaseV1 => ({
  caseId,
  capabilityId: contract.capabilityId,
  kind,
  input: structuredClone(input),
  expectedOutcome,
  assertions: structuredClone(assertions),
  rationale,
});

export const generateCapabilityProofCasesV1 = (
  rawContract: CapabilityProofContractV1,
): readonly GeneratedCapabilityProofCaseV1[] => {
  const contract = assertValidCapabilityProofContractV1(rawContract);
  const nominal = nominalInput(contract);
  const cases: GeneratedCapabilityProofCaseV1[] = [
    proofCase(contract, "nominal", "NOMINAL", nominal, "ACCEPT",
      ["Operation is accepted for the nominal declared input."],
      "Establish the cheapest positive contract proof."),
    proofCase(contract, "readback", "READBACK", nominal, "ACCEPT",
      contract.readbackAssertions,
      "Verify semantic readback for the nominal operation."),
  ];
  if (contract.rollbackAssertions.length > 0) {
    cases.push(proofCase(contract, "rollback", "ROLLBACK", nominal, "ACCEPT",
      contract.rollbackAssertions,
      "Verify the declared rollback or recovery invariant."));
  }

  for (const field of contract.inputFields) {
    for (const side of ["min", "max"] as const) {
      if (side === "max" && field.min !== undefined && field.max === field.min) continue;
      const value = boundaryValue(field, side);
      if (value === undefined) continue;
      cases.push(proofCase(
        contract,
        "boundary:" + field.name + ":" + side,
        "BOUNDARY",
        withField(nominal, field.name, value),
        "ACCEPT",
        ["Declared " + side + " boundary for '" + field.name + "' is accepted."],
        "Exercise the declared numeric boundary without inventing unrelated combinations.",
      ));
    }
    if (field.required) {
      cases.push(proofCase(
        contract,
        "invalid:" + field.name + ":missing",
        "INVALID_INPUT",
        withoutField(nominal, field.name),
        "REJECT",
        ["Missing required field '" + field.name + "' is rejected."],
        "Generated required-field negative proof.",
      ));
    }
    cases.push(proofCase(
      contract,
      "invalid:" + field.name + ":type",
      "INVALID_INPUT",
      withField(nominal, field.name, invalidTypeValue(field)),
      "REJECT",
      ["Wrong type for '" + field.name + "' is rejected."],
      "Generated type-safety negative proof.",
    ));
    const below = invalidBelow(field);
    if (below !== undefined) {
      cases.push(proofCase(
        contract,
        "invalid:" + field.name + ":below-min",
        "INVALID_INPUT",
        withField(nominal, field.name, below),
        "REJECT",
        ["Value below min for '" + field.name + "' is rejected."],
        "Generated lower-bound negative proof.",
      ));
    }
    const above = invalidAbove(field);
    if (above !== undefined) {
      cases.push(proofCase(
        contract,
        "invalid:" + field.name + ":above-max",
        "INVALID_INPUT",
        withField(nominal, field.name, above),
        "REJECT",
        ["Value above max for '" + field.name + "' is rejected."],
        "Generated upper-bound negative proof.",
      ));
    }
  }
  for (const edgeCase of contract.edgeCases ?? []) {
    cases.push(proofCase(
      contract,
      "edge:" + edgeCase.edgeId,
      "EDGE_CASE",
      edgeCase.input,
      edgeCase.expectedOutcome,
      edgeCase.assertions,
      "Exercise a capability-specific edge condition declared by its adapter contract.",
    ));
  }
  return cases.sort((a, b) => a.caseId.localeCompare(b.caseId));
};
export const validateCapabilityContractAgainstRecordV1 = (
  contract: CapabilityProofContractV1,
  record: CapabilityRecord,
): CapabilityContractValidationV1 => {
  const errors = [...validateCapabilityProofContractV1(contract).errors];
  if (String(record.id) !== contract.capabilityId) {
    errors.push("Contract capabilityId does not match Capability Registry record.");
  }
  if (record.riskClass !== contract.riskClass) {
    errors.push("Contract riskClass does not match Capability Registry record.");
  }
  const recordRouteKinds = new Set(record.routes.map((route) => route.kind));
  for (const kind of contract.supportedRouteKinds) {
    if (!recordRouteKinds.has(kind)) {
      errors.push("Contract route kind '" + kind + "' is not declared by the registry record.");
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
};
