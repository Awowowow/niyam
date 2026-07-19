import base64
from io import BytesIO
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pypdf import PdfReader
from z3 import And, Bool, BoolVal, If, Int, Not, Optimize, Or, is_true, sat


app = FastAPI(
    title="Niyam bounded verification engine",
    version="0.1.0",
    description=(
        "Finds concrete disagreements between an approved scholarship policy "
        "and a supported implementation model. This is bounded symbolic "
        "verification, not a universal proof for arbitrary software."
    ),
)


class SolveRequest(BaseModel):
    income_cap: int = Field(ge=100_000, le=10_000_000)
    standard_age_limit: int = Field(ge=16, le=100)
    disability_relaxation_years: int = Field(ge=1, le=30)
    implementation: Literal["legacy", "repaired"] = "legacy"


class Counterexample(BaseModel):
    witness: str
    annual_household_income: int
    age: int
    has_disability: bool
    policy_outcome: Literal["ELIGIBLE", "INELIGIBLE"]
    implementation_outcome: Literal["ELIGIBLE", "INELIGIBLE"]


class SolveResponse(BaseModel):
    status: Literal["counterexamples-found", "no-counterexample-in-bounds"]
    engine: Literal["z3-bounded-symbolic-search"]
    claim: str
    bounds: dict[str, str]
    counterexamples: list[Counterexample]


class DocumentExtractRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=240)
    mime_type: Literal["application/pdf", "text/plain"]
    content_base64: str = Field(min_length=1, max_length=7_100_000)


class ExtractedPage(BaseModel):
    page: int
    text: str


class DocumentExtractResponse(BaseModel):
    filename: str
    mime_type: str
    text: str
    pages: list[ExtractedPage]
    extraction: Literal["pypdf", "utf8"]


def _outcome(value: bool) -> Literal["ELIGIBLE", "INELIGIBLE"]:
    return "ELIGIBLE" if value else "INELIGIBLE"


def _find_witness(
    request: SolveRequest,
    witness: str,
    extra_constraints: list,
    distance_terms: list,
) -> Counterexample | None:
    income = Int("income")
    age = Int("age")
    disability = Bool("disability")
    relaxed_age_limit = (
        request.standard_age_limit + request.disability_relaxation_years
    )

    policy = And(
        income <= request.income_cap,
        Or(
            age <= request.standard_age_limit,
            And(disability, age <= relaxed_age_limit),
        ),
    )
    if request.implementation == "legacy":
        implementation = And(income < 250_000, age <= 25)
    else:
        implementation = And(
            income <= request.income_cap,
            Or(
                age <= request.standard_age_limit,
                And(disability, age <= relaxed_age_limit),
            ),
        )

    optimizer = Optimize()
    optimizer.add(income >= 0, income <= 10_000_000)
    optimizer.add(age >= 16, age <= 120)
    optimizer.add(policy != implementation)
    optimizer.add(*extra_constraints)
    for term in distance_terms:
        optimizer.minimize(term)

    if optimizer.check() != sat:
        return None
    model = optimizer.model()
    income_value = model.eval(income, model_completion=True).as_long()
    age_value = model.eval(age, model_completion=True).as_long()
    disability_value = is_true(model.eval(disability, model_completion=True))
    policy_value = is_true(model.eval(policy, model_completion=True))
    implementation_value = is_true(
        model.eval(implementation, model_completion=True)
    )
    return Counterexample(
        witness=witness,
        annual_household_income=income_value,
        age=age_value,
        has_disability=disability_value,
        policy_outcome=_outcome(policy_value),
        implementation_outcome=_outcome(implementation_value),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "z3-bounded-symbolic-search"}


@app.post("/v1/documents/extract", response_model=DocumentExtractResponse)
def extract_document(request: DocumentExtractRequest) -> DocumentExtractResponse:
    try:
        content = base64.b64decode(request.content_base64, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Document content is not valid base64") from error
    if not content:
        raise HTTPException(status_code=422, detail="The selected document is empty")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Policy documents must be 5 MB or smaller")
    if request.mime_type == "text/plain":
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise HTTPException(status_code=422, detail="Text policies must use UTF-8") from error
        if "\x00" in text:
            raise HTTPException(status_code=422, detail="The text file contains binary data")
        return DocumentExtractResponse(
            filename=request.filename,
            mime_type=request.mime_type,
            text=text,
            pages=[ExtractedPage(page=1, text=text)],
            extraction="utf8",
        )

    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=422, detail="The selected file is not a valid PDF")
    try:
        reader = PdfReader(BytesIO(content))
    except Exception as error:
        raise HTTPException(status_code=422, detail="The PDF could not be read safely") from error
    pages = [
        ExtractedPage(page=index + 1, text=(page.extract_text() or "").strip())
        for index, page in enumerate(reader.pages)
    ]
    text = "\n\n".join(
        f"[Page {page.page}]\n{page.text}" for page in pages if page.text
    )
    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail=(
                "No selectable text was found. Upload a text-based PDF or paste "
                "the policy text; scanned-image OCR is not enabled in this build."
            ),
        )
    return DocumentExtractResponse(
        filename=request.filename,
        mime_type=request.mime_type,
        text=text,
        pages=pages,
        extraction="pypdf",
    )


@app.post("/v1/counterexamples", response_model=SolveResponse)
def counterexamples(request: SolveRequest) -> SolveResponse:
    income = Int("income")
    age = Int("age")
    disability = Bool("disability")
    relaxed_age_limit = (
        request.standard_age_limit + request.disability_relaxation_years
    )
    abs_income_distance = If(
        income >= request.income_cap,
        income - request.income_cap,
        request.income_cap - income,
    )
    abs_standard_age_distance = If(
        age >= request.standard_age_limit,
        age - request.standard_age_limit,
        request.standard_age_limit - age,
    )
    abs_relaxed_age_distance = If(
        age >= relaxed_age_limit,
        age - relaxed_age_limit,
        relaxed_age_limit - age,
    )

    searches = [
        (
            "income-boundary",
            [age == request.standard_age_limit, disability == BoolVal(False)],
            [abs_income_distance],
        ),
        (
            "disability-exception",
            [
                income <= request.income_cap,
                age > request.standard_age_limit,
                disability == BoolVal(True),
            ],
            [abs_relaxed_age_distance, abs_income_distance],
        ),
        (
            "double-boundary-interaction",
            [
                income == request.income_cap,
                age == relaxed_age_limit,
                disability == BoolVal(True),
            ],
            [],
        ),
        (
            "inverse-drift",
            [Not(disability)],
            [abs_income_distance, abs_standard_age_distance],
        ),
    ]
    found: list[Counterexample] = []
    seen: set[tuple[int, int, bool]] = set()
    for witness, constraints, objectives in searches:
        result = _find_witness(request, witness, constraints, objectives)
        if result is None:
            continue
        key = (
            result.annual_household_income,
            result.age,
            result.has_disability,
        )
        if key not in seen:
            seen.add(key)
            found.append(result)

    return SolveResponse(
        status=(
            "counterexamples-found"
            if found
            else "no-counterexample-in-bounds"
        ),
        engine="z3-bounded-symbolic-search",
        claim=(
            "Concrete counterexample search inside declared income and age "
            "bounds; not universal formal verification of arbitrary code."
        ),
        bounds={"income": "0..10,000,000 INR", "age": "16..120 years"},
        counterexamples=found,
    )
