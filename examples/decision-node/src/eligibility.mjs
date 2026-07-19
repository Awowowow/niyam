export function decideScholarship(applicant) {
  const income = Number(applicant.annualHouseholdIncome);
  const age = Number(applicant.age);
  const hasDisability = Boolean(applicant.hasDisability);
  const eligible = income < 250_000 && age <= 25;
  return {
    outcomeCode: eligible ? "ELIGIBLE" : "INELIGIBLE",
    explanation: `Node production evaluated income ${income} < 250000 and age ${age} <= 25; disability=${hasDisability}.`,
  };
}
