import Decimal from "decimal.js";
import {
  collectPredicates,
  type FactMap,
  type JsonValue,
  type PolicyRule,
  type PredicateCondition,
} from "@niyam/policy-ir";
import { evaluatePolicy, type EvaluationTrace } from "@niyam/rule-engine";

export type BoundaryPosition = "just-below" | "exact" | "just-above";

export interface GeneratedCase {
  id: string;
  label: string;
  predicateId: string;
  factPath: string;
  position: BoundaryPosition;
  facts: FactMap;
  expected: {
    passed: boolean;
    outcomeCode: string;
    outcomeLabel: string;
    trace: EvaluationTrace;
  };
}

export interface BoundaryGenerationOptions {
  numericStep?: string;
}

function cloneFacts(facts: FactMap): FactMap {
  return structuredClone(facts);
}

function setFact(facts: FactMap, path: string, value: JsonValue): FactMap {
  const copy = cloneFacts(facts);
  const segments = path.split(".");
  let current: Record<string, JsonValue> = copy;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }

    const existing = current[segment];
    if (
      existing === null ||
      Array.isArray(existing) ||
      typeof existing !== "object"
    ) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, JsonValue>;
  });

  return copy;
}

function dateAtOffset(date: string, dayOffset: number): string {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  const shifted = new Date(timestamp + dayOffset * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function boundaryValues(
  predicate: PredicateCondition,
  step: string,
): Array<{ position: BoundaryPosition; value: JsonValue }> {
  switch (predicate.value.type) {
    case "money": {
      const threshold = new Decimal(predicate.value.amount);
      const delta = new Decimal(step);
      return [
        { position: "just-below", value: threshold.minus(delta).toString() },
        { position: "exact", value: threshold.toString() },
        { position: "just-above", value: threshold.plus(delta).toString() },
      ];
    }
    case "number": {
      const threshold = new Decimal(predicate.value.value);
      const delta = new Decimal(step);
      return [
        { position: "just-below", value: threshold.minus(delta).toString() },
        { position: "exact", value: threshold.toString() },
        { position: "just-above", value: threshold.plus(delta).toString() },
      ];
    }
    case "date":
      return [
        {
          position: "just-below",
          value: dateAtOffset(predicate.value.value, -1),
        },
        { position: "exact", value: predicate.value.value },
        {
          position: "just-above",
          value: dateAtOffset(predicate.value.value, 1),
        },
      ];
    case "string":
    case "boolean":
      return [];
  }
}

export function generateBoundaryCases(
  policy: PolicyRule,
  baseFacts: FactMap,
  options: BoundaryGenerationOptions = {},
): GeneratedCase[] {
  const step = options.numericStep ?? "1";

  return collectPredicates(policy.condition).flatMap((predicate) =>
    boundaryValues(predicate, step).map(({ position, value }) => {
      const facts = setFact(baseFacts, predicate.fact.path, value);
      const evaluation = evaluatePolicy(policy, facts);

      if (evaluation.status !== "evaluated") {
        throw new Error(
          `Cannot generate ${predicate.id}/${position}: ${evaluation.issues
            .map((issue) => issue.message)
            .join(", ")}`,
        );
      }

      return {
        id: `${policy.id}:${predicate.id}:${position}`,
        label: `${predicate.fact.label} — ${position.replace("-", " ")}`,
        predicateId: predicate.id,
        factPath: predicate.fact.path,
        position,
        facts,
        expected: {
          passed: evaluation.passed,
          outcomeCode: evaluation.decision.code,
          outcomeLabel: evaluation.decision.label,
          trace: evaluation.trace,
        },
      };
    }),
  );
}
