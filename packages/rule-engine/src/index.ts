import Decimal from "decimal.js";
import {
  type Comparator,
  type Condition,
  type FactMap,
  type FactReference,
  type JsonValue,
  type Outcome,
  type PolicyRule,
  type PolicyValue,
  parsePolicyRule,
} from "@niyam/policy-ir";

export interface EvaluationTrace {
  node: Condition["type"];
  result: boolean;
  predicateId?: string;
  factPath?: string;
  factLabel?: string;
  operator?: Comparator;
  actual?: JsonValue;
  expected?: PolicyValue;
  children?: EvaluationTrace[];
}

export interface EvaluationIssue {
  code: "MISSING_FACT" | "TYPE_MISMATCH" | "CURRENCY_MISMATCH";
  message: string;
  factPath: string;
}

export type EvaluationResult =
  | {
      status: "evaluated";
      passed: boolean;
      decision: Outcome;
      trace: EvaluationTrace;
      issues: [];
    }
  | {
      status: "invalid-input";
      passed: null;
      decision: null;
      trace: null;
      issues: EvaluationIssue[];
    };

class FactEvaluationError extends Error {
  constructor(public readonly issue: EvaluationIssue) {
    super(issue.message);
  }
}

function getFact(facts: FactMap, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = facts;

  for (const segment of path.split(".")) {
    if (
      current === null ||
      Array.isArray(current) ||
      typeof current !== "object" ||
      !(segment in current)
    ) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function requireFact(facts: FactMap, fact: FactReference): JsonValue {
  const value = getFact(facts, fact.path);
  if (value === undefined) {
    throw new FactEvaluationError({
      code: "MISSING_FACT",
      factPath: fact.path,
      message: `Missing required fact: ${fact.label}`,
    });
  }
  return value;
}

function compareDecimals(
  actual: Decimal,
  expected: Decimal,
  operator: Comparator,
): boolean {
  switch (operator) {
    case "lt":
      return actual.lt(expected);
    case "lte":
      return actual.lte(expected);
    case "gt":
      return actual.gt(expected);
    case "gte":
      return actual.gte(expected);
    case "eq":
      return actual.eq(expected);
    case "neq":
      return !actual.eq(expected);
  }

  throw new Error(`Unsupported numeric operator: ${operator satisfies never}`);
}

function comparePrimitive(
  actual: string | boolean,
  expected: string | boolean,
  operator: Comparator,
): boolean {
  if (operator !== "eq" && operator !== "neq") {
    throw new Error(`Operator ${operator} is not valid for primitive values`);
  }
  return operator === "eq" ? actual === expected : actual !== expected;
}

function compareDate(
  actual: string,
  expected: string,
  operator: Comparator,
): boolean {
  const actualEpoch = Date.parse(`${actual}T00:00:00.000Z`);
  const expectedEpoch = Date.parse(`${expected}T00:00:00.000Z`);
  if (Number.isNaN(actualEpoch) || !/^\d{4}-\d{2}-\d{2}$/.test(actual)) {
    throw new Error("Date facts must use YYYY-MM-DD");
  }
  return compareDecimals(
    new Decimal(actualEpoch),
    new Decimal(expectedEpoch),
    operator,
  );
}

function compare(
  actual: JsonValue,
  expected: PolicyValue,
  operator: Comparator,
  fact: FactReference,
): boolean {
  try {
    switch (expected.type) {
      case "money": {
        if (
          fact.dataType !== "money" ||
          (fact.currency && fact.currency !== expected.currency)
        ) {
          throw new FactEvaluationError({
            code: "CURRENCY_MISMATCH",
            factPath: fact.path,
            message: `Expected ${expected.currency} money for ${fact.label}`,
          });
        }
        if (typeof actual !== "number" && typeof actual !== "string") {
          throw new Error("Money facts must be numbers or base-10 strings");
        }
        return compareDecimals(
          new Decimal(actual),
          new Decimal(expected.amount),
          operator,
        );
      }
      case "number":
        if (
          fact.dataType !== "number" ||
          (typeof actual !== "number" && typeof actual !== "string")
        ) {
          throw new Error("Number facts must be numbers or base-10 strings");
        }
        return compareDecimals(
          new Decimal(actual),
          new Decimal(expected.value),
          operator,
        );
      case "date":
        if (fact.dataType !== "date" || typeof actual !== "string") {
          throw new Error("Date facts must be strings");
        }
        return compareDate(actual, expected.value, operator);
      case "string":
        if (fact.dataType !== "string" || typeof actual !== "string") {
          throw new Error("String fact required");
        }
        return comparePrimitive(actual, expected.value, operator);
      case "boolean":
        if (fact.dataType !== "boolean" || typeof actual !== "boolean") {
          throw new Error("Boolean fact required");
        }
        return comparePrimitive(actual, expected.value, operator);
    }

    throw new Error(`Unsupported policy value: ${expected satisfies never}`);
  } catch (error) {
    if (error instanceof FactEvaluationError) {
      throw error;
    }
    throw new FactEvaluationError({
      code: "TYPE_MISMATCH",
      factPath: fact.path,
      message:
        error instanceof Error
          ? error.message
          : `Invalid value for ${fact.label}`,
    });
  }
}

function evaluateCondition(
  condition: Condition,
  facts: FactMap,
): EvaluationTrace {
  switch (condition.type) {
    case "predicate": {
      const actual = requireFact(facts, condition.fact);
      const result = compare(
        actual,
        condition.value,
        condition.operator,
        condition.fact,
      );
      return {
        node: "predicate",
        result,
        predicateId: condition.id,
        factPath: condition.fact.path,
        factLabel: condition.fact.label,
        operator: condition.operator,
        actual,
        expected: condition.value,
      };
    }
    case "all": {
      const children = condition.conditions.map((child) =>
        evaluateCondition(child, facts),
      );
      return {
        node: "all",
        result: children.every((child) => child.result),
        children,
      };
    }
    case "any": {
      const children = condition.conditions.map((child) =>
        evaluateCondition(child, facts),
      );
      return {
        node: "any",
        result: children.some((child) => child.result),
        children,
      };
    }
    case "not": {
      const child = evaluateCondition(condition.condition, facts);
      return { node: "not", result: !child.result, children: [child] };
    }
  }

  throw new Error(`Unsupported condition: ${condition satisfies never}`);
}

export function evaluatePolicy(
  ruleInput: PolicyRule,
  facts: FactMap,
): EvaluationResult {
  const rule = parsePolicyRule(ruleInput);

  try {
    const trace = evaluateCondition(rule.condition, facts);
    return {
      status: "evaluated",
      passed: trace.result,
      decision: trace.result ? rule.outcomes.onPass : rule.outcomes.onFail,
      trace,
      issues: [],
    };
  } catch (error) {
    if (error instanceof FactEvaluationError) {
      return {
        status: "invalid-input",
        passed: null,
        decision: null,
        trace: null,
        issues: [error.issue],
      };
    }
    throw error;
  }
}
