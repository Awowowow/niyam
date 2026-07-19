export function decideScholarship(applicant) {
  const income = Number(applicant.annualHouseholdIncome);
  const age = Number(applicant.age);
  const hasDisability = Boolean(applicant.hasDisability);
  const eligible =
    income <= 300_000 && (age <= 25 || (hasDisability && age <= 30));
  return { outcomeCode: eligible ? "ELIGIBLE" : "INELIGIBLE" };
}
