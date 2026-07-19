from eligibility import decide_scholarship


def test_clearly_eligible() -> None:
    assert (
        decide_scholarship(
            {
                "annualHouseholdIncome": 200_000,
                "age": 24,
                "hasDisability": False,
            }
        )["outcomeCode"]
        == "ELIGIBLE"
    )


def test_clearly_over_income() -> None:
    assert (
        decide_scholarship(
            {
                "annualHouseholdIncome": 500_000,
                "age": 24,
                "hasDisability": True,
            }
        )["outcomeCode"]
        == "INELIGIBLE"
    )


def test_over_age_without_exception() -> None:
    assert (
        decide_scholarship(
            {
                "annualHouseholdIncome": 200_000,
                "age": 40,
                "hasDisability": False,
            }
        )["outcomeCode"]
        == "INELIGIBLE"
    )
