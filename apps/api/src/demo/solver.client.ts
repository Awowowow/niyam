export interface SolverParameters {
  incomeCap: number;
  standardAgeLimit: number;
  disabilityRelaxationYears: number;
}

export interface SolverCounterexample {
  witness: string;
  annual_household_income: number;
  age: number;
  has_disability: boolean;
  policy_outcome: "ELIGIBLE" | "INELIGIBLE";
  implementation_outcome: "ELIGIBLE" | "INELIGIBLE";
}

export interface SolverEvidence {
  status:
    | "counterexamples-found"
    | "no-counterexample-in-bounds"
    | "solver-not-configured"
    | "solver-unavailable";
  engine: "z3-bounded-symbolic-search" | "deterministic-node-fallback";
  claim: string;
  bounds?: Record<string, string>;
  counterexamples: SolverCounterexample[];
}

export async function requestBoundedCounterexamples(
  parameters: SolverParameters,
  implementation: "legacy" | "repaired",
): Promise<SolverEvidence> {
  const baseUrl = process.env.NIYAM_SOLVER_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    return {
      status: "solver-not-configured",
      engine: "deterministic-node-fallback",
      claim:
        "Python/Z3 is optional locally. Node boundary and interaction verification remains active.",
      counterexamples: [],
    };
  }

  try {
    const response = await fetch(`${baseUrl}/v1/counterexamples`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        income_cap: parameters.incomeCap,
        standard_age_limit: parameters.standardAgeLimit,
        disability_relaxation_years: parameters.disabilityRelaxationYears,
        implementation,
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Solver returned ${response.status}`);
    return (await response.json()) as SolverEvidence;
  } catch (error) {
    return {
      status: "solver-unavailable",
      engine: "deterministic-node-fallback",
      claim:
        error instanceof Error
          ? `Z3 service unavailable: ${error.message}. Node verification remained active.`
          : "Z3 service unavailable. Node verification remained active.",
      counterexamples: [],
    };
  }
}
