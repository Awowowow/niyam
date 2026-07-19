import { readFile } from "node:fs/promises";
import { decideScholarship } from "../examples/decision-protected/eligibility.mjs";

const contract = JSON.parse(
  await readFile(
    new URL("../contracts/scholarship.active.json", import.meta.url),
  ),
);
const { incomeCap, standardAgeLimit, disabilityAgeLimit } = contract.parameters;
const cases = [
  [incomeCap - 1, standardAgeLimit, false, "ELIGIBLE", "below income boundary"],
  [incomeCap, standardAgeLimit, false, "ELIGIBLE", "inclusive income boundary"],
  [
    incomeCap + 1,
    standardAgeLimit,
    false,
    "INELIGIBLE",
    "above income boundary",
  ],
  [
    incomeCap,
    standardAgeLimit + 1,
    false,
    "INELIGIBLE",
    "standard age exceeded",
  ],
  [incomeCap, disabilityAgeLimit, true, "ELIGIBLE", "disability boundary"],
  [
    incomeCap,
    disabilityAgeLimit + 1,
    true,
    "INELIGIBLE",
    "disability age exceeded",
  ],
];

const failures = cases.flatMap(([income, age, disability, expected, label]) => {
  const actual = decideScholarship({
    annualHouseholdIncome: income,
    age,
    hasDisability: disability,
  }).outcomeCode;
  return actual === expected ? [] : [{ label, expected, actual }];
});

if (failures.length) {
  console.error("Niyam Policy CI blocked this revision:", failures);
  process.exit(1);
}

console.log(
  `Niyam Policy CI passed ${cases.length}/${cases.length} contract cases for ${contract.id}@v${contract.version}.`,
);
