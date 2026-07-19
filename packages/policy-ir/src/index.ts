import { z } from "zod";

export const DataTypeSchema = z.enum([
  "money",
  "number",
  "string",
  "boolean",
  "date",
]);
export type DataType = z.infer<typeof DataTypeSchema>;

export const ComparatorSchema = z.enum(["lt", "lte", "gt", "gte", "eq", "neq"]);
export type Comparator = z.infer<typeof ComparatorSchema>;

export const MoneyValueSchema = z.object({
  type: z.literal("money"),
  amount: z.string().regex(/^-?\d+(\.\d+)?$/, "Use a base-10 amount"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use an ISO 4217 currency code"),
});

export const NumberValueSchema = z.object({
  type: z.literal("number"),
  value: z.string().regex(/^-?\d+(\.\d+)?$/, "Use a base-10 number"),
});

export const StringValueSchema = z.object({
  type: z.literal("string"),
  value: z.string(),
});

export const BooleanValueSchema = z.object({
  type: z.literal("boolean"),
  value: z.boolean(),
});

export const DateValueSchema = z.object({
  type: z.literal("date"),
  value: z.string().date(),
});

export const PolicyValueSchema = z.discriminatedUnion("type", [
  MoneyValueSchema,
  NumberValueSchema,
  StringValueSchema,
  BooleanValueSchema,
  DateValueSchema,
]);
export type PolicyValue = z.infer<typeof PolicyValueSchema>;

export const FactReferenceSchema = z.object({
  path: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/,
      "Use a dotted fact path",
    ),
  label: z.string().min(1),
  dataType: DataTypeSchema,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});
export type FactReference = z.infer<typeof FactReferenceSchema>;

export const PredicateConditionSchema = z.object({
  type: z.literal("predicate"),
  id: z.string().min(1),
  fact: FactReferenceSchema,
  operator: ComparatorSchema,
  value: PolicyValueSchema,
});
export type PredicateCondition = z.infer<typeof PredicateConditionSchema>;

export interface AllCondition {
  type: "all";
  conditions: Condition[];
}

export interface AnyCondition {
  type: "any";
  conditions: Condition[];
}

export interface NotCondition {
  type: "not";
  condition: Condition;
}

export type Condition =
  PredicateCondition | AllCondition | AnyCondition | NotCondition;

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("type", [
    PredicateConditionSchema,
    z.object({
      type: z.literal("all"),
      conditions: z.array(ConditionSchema).min(1),
    }),
    z.object({
      type: z.literal("any"),
      conditions: z.array(ConditionSchema).min(1),
    }),
    z.object({
      type: z.literal("not"),
      condition: ConditionSchema,
    }),
  ]),
);

export const SourceCitationSchema = z.object({
  documentName: z.string().min(1),
  section: z.string().min(1),
  page: z.number().int().positive().optional(),
  quote: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  contentHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
});
export type SourceCitation = z.infer<typeof SourceCitationSchema>;

export const OutcomeSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  explanation: z.string().min(1),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const PolicyRuleSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  jurisdiction: z.string().min(1),
  effectiveFrom: z.string().date(),
  citation: SourceCitationSchema,
  condition: ConditionSchema,
  outcomes: z.object({
    onPass: OutcomeSchema,
    onFail: OutcomeSchema,
  }),
  approved: z.object({
    status: z.literal("human-approved"),
    approvedBy: z.string().min(1),
    approvedAt: z.string().datetime({ offset: true }),
  }),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type FactMap = { [key: string]: JsonValue };

export function parsePolicyRule(input: unknown): PolicyRule {
  return PolicyRuleSchema.parse(input);
}

export function collectPredicates(condition: Condition): PredicateCondition[] {
  switch (condition.type) {
    case "predicate":
      return [condition];
    case "not":
      return collectPredicates(condition.condition);
    case "all":
    case "any":
      return condition.conditions.flatMap(collectPredicates);
  }
}
