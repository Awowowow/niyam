def decide_scholarship(applicant: dict) -> dict:
    income = int(applicant.get("annualHouseholdIncome", 0))
    age = int(applicant.get("age", 0))
    has_disability = bool(applicant.get("hasDisability", False))
    eligible = income < 250_000 and age <= 25
    return {
        "outcomeCode": "ELIGIBLE" if eligible else "INELIGIBLE",
        "explanation": (
            f"Python production evaluated income {income} < 250000 and age "
            f"{age} <= 25; disability={has_disability}."
        ),
    }
