from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output" / "pdf" / "niyam-demo-policy.pdf"

INK = HexColor("#15172D")
TEAL = HexColor("#123432")
MINT = HexColor("#56D6B1")
PAPER = HexColor("#F7F8F4")
MUTED = HexColor("#667085")
LINE = HexColor("#D8DCE5")
CORAL = HexColor("#F36D62")


def paragraph(canvas: Canvas, text: str, x: float, y: float, width: float, style: ParagraphStyle) -> float:
    item = Paragraph(text, style)
    _, height = item.wrap(width, 1000)
    item.drawOn(canvas, x, y - height)
    return y - height


def rule_card(canvas: Canvas, number: str, title: str, text: str, x: float, y: float, width: float) -> float:
    body_style = ParagraphStyle(
        "rule-body",
        fontName="Helvetica",
        fontSize=10.8,
        leading=15,
        textColor=INK,
        alignment=TA_LEFT,
    )
    title_style = ParagraphStyle(
        "rule-title",
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=MUTED,
        spaceAfter=5,
    )
    title_item = Paragraph(title.upper(), title_style)
    body_item = Paragraph(text, body_style)
    _, title_height = title_item.wrap(width - 26 * mm, 1000)
    _, body_height = body_item.wrap(width - 26 * mm, 1000)
    height = max(24 * mm, title_height + body_height + 13 * mm)

    canvas.setFillColor(PAPER)
    canvas.setStrokeColor(LINE)
    canvas.roundRect(x, y - height, width, height, 3 * mm, fill=1, stroke=1)
    canvas.setFillColor(TEAL)
    canvas.circle(x + 11 * mm, y - 12 * mm, 5.4 * mm, fill=1, stroke=0)
    canvas.setFillColor(MINT)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawCentredString(x + 11 * mm, y - 13.4 * mm, number)

    text_x = x + 21 * mm
    title_item.drawOn(canvas, text_x, y - 8 * mm - title_height)
    body_item.drawOn(canvas, text_x, y - 10.5 * mm - title_height - body_height)
    return y - height - 5 * mm


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    width, height = A4
    canvas.setTitle("Niyam Scholarship Eligibility Policy 2026")
    canvas.setAuthor("Niyam Demo Policy Board")
    canvas.setSubject("Human-approved scholarship policy for the Niyam Policy CI demonstration")

    canvas.setFillColor(TEAL)
    canvas.rect(0, height - 58 * mm, width, 58 * mm, fill=1, stroke=0)
    canvas.setFillColor(MINT)
    canvas.roundRect(18 * mm, height - 22 * mm, 10 * mm, 10 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawCentredString(23 * mm, height - 18.8 * mm, "N")
    canvas.setFillColor(PAPER)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(32 * mm, height - 17.7 * mm, "NIYAM DEMO POLICY BOARD")
    canvas.setFillColor(MINT)
    canvas.setFont("Courier-Bold", 7)
    canvas.drawRightString(width - 18 * mm, height - 17.5 * mm, "APPROVED POLICY / 2026")

    canvas.setFillColor(PAPER)
    canvas.setFont("Helvetica-Bold", 26)
    canvas.drawString(18 * mm, height - 36 * mm, "Scholarship Eligibility Policy")
    canvas.setFont("Helvetica", 10.5)
    canvas.drawString(18 * mm, height - 44 * mm, "The exact rules the scholarship decision software must implement")

    canvas.setFillColor(MINT)
    canvas.roundRect(width - 67 * mm, height - 52 * mm, 49 * mm, 12 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.setFont("Courier-Bold", 7.3)
    canvas.drawString(width - 63 * mm, height - 45.5 * mm, "EFFECTIVE FROM")
    canvas.setFont("Helvetica-Bold", 9.5)
    canvas.drawString(width - 63 * mm, height - 50 * mm, "1 August 2026")

    x = 18 * mm
    y = height - 70 * mm
    content_width = width - 36 * mm

    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(x, y, "Approved eligibility conditions")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8.5)
    canvas.drawRightString(width - 18 * mm, y, "Document NS-2026-04  |  Version 4")
    y -= 8 * mm

    y = rule_card(
        canvas,
        "01",
        "Annual household income",
        "Applicants with annual household income up to and including INR 437,500 are eligible.",
        x,
        y,
        content_width,
    )
    y = rule_card(
        canvas,
        "02",
        "Standard age limit",
        "Applicants must be 27 years old or younger.",
        x,
        y,
        content_width,
    )
    y = rule_card(
        canvas,
        "03",
        "Disability exception",
        "Applicants with disabilities receive a 4 year age relaxation.",
        x,
        y,
        content_width,
    )

    authority_height = 29 * mm
    canvas.setFillColor(HexColor("#FFF3F1"))
    canvas.setStrokeColor(HexColor("#F5B7B1"))
    canvas.roundRect(x, y - authority_height, content_width, authority_height, 3 * mm, fill=1, stroke=1)
    canvas.setFillColor(CORAL)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(x + 6 * mm, y - 8 * mm, "AUTHORITY BOUNDARY")
    authority_style = ParagraphStyle(
        "authority",
        fontName="Helvetica",
        fontSize=9.2,
        leading=13,
        textColor=INK,
    )
    paragraph(
        canvas,
        "These rules become executable only after policy-owner approval. A software repair requires separate engineer review. No automated system may merge or deploy a change without those approvals.",
        x + 6 * mm,
        y - 11 * mm,
        content_width - 12 * mm,
        authority_style,
    )

    footer_y = 15 * mm
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, footer_y + 7 * mm, width - 18 * mm, footer_y + 7 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Courier", 6.8)
    canvas.drawString(18 * mm, footer_y, "Niyam records the page citation and SHA-256 document hash at upload.")
    page_text = "Page 1 of 1"
    canvas.drawString(width - 18 * mm - stringWidth(page_text, "Courier", 6.8), footer_y, page_text)

    canvas.showPage()
    canvas.save()
    print(OUTPUT)


if __name__ == "__main__":
    build()
