import base64
from io import BytesIO

from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.main import app


client = TestClient(app)


def test_finds_income_and_disability_counterexamples_against_legacy():
    response = client.post(
        "/v1/counterexamples",
        json={
            "income_cap": 300_000,
            "standard_age_limit": 25,
            "disability_relaxation_years": 5,
            "implementation": "legacy",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "counterexamples-found"
    assert {item["witness"] for item in body["counterexamples"]} >= {
        "income-boundary",
        "disability-exception",
    }


def test_finds_no_counterexample_for_repaired_supported_model():
    response = client.post(
        "/v1/counterexamples",
        json={
            "income_cap": 437_500,
            "standard_age_limit": 27,
            "disability_relaxation_years": 4,
            "implementation": "repaired",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "no-counterexample-in-bounds"
    assert body["counterexamples"] == []


def test_extracts_plain_text_policy_documents():
    content = "Applicants earning up to and including INR 300,000 are eligible."
    response = client.post(
        "/v1/documents/extract",
        json={
            "filename": "policy.txt",
            "mime_type": "text/plain",
            "content_base64": base64.b64encode(content.encode()).decode(),
        },
    )
    assert response.status_code == 200
    assert response.json()["text"] == content
    assert response.json()["pages"][0]["page"] == 1


def test_extracts_page_aware_pdf_documents():
    output = BytesIO()
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {NameObject("/F1"): writer._add_object(font)}
            )
        }
    )
    content = DecodedStreamObject()
    content.set_data(
        b"BT /F1 12 Tf 72 720 Td (Income up to INR 300,000 is eligible.) Tj ET"
    )
    page[NameObject("/Contents")] = writer._add_object(content)
    writer.write(output)
    response = client.post(
        "/v1/documents/extract",
        json={
            "filename": "policy.pdf",
            "mime_type": "application/pdf",
            "content_base64": base64.b64encode(output.getvalue()).decode(),
        },
    )
    assert response.status_code == 200
    assert response.json()["extraction"] == "pypdf"
    assert "Income up to INR 300,000" in response.json()["pages"][0]["text"]


def test_rejects_scanned_or_empty_pdf_without_inventing_text():
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.write(output)
    response = client.post(
        "/v1/documents/extract",
        json={
            "filename": "scan.pdf",
            "mime_type": "application/pdf",
            "content_base64": base64.b64encode(output.getvalue()).decode(),
        },
    )
    assert response.status_code == 422
    assert "No selectable text" in response.json()["detail"]
