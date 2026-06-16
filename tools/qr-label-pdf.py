#!/usr/bin/env python3
"""MIRA QR Label PDF Generator.

Generates Avery-compatible label sheets for asset QR codes.

Layouts:
  5163  Avery 2x4" shipping labels   — 10/sheet (2 cols x 5 rows)
  5160  Avery 1"x2.625" address labels — 30/sheet (3 cols x 10 rows)

Usage:
  python3 tools/qr-label-pdf.py --tags VFD-07,PUMP-03 --tenant "Acme" --format 5163 --output labels.pdf
  python3 tools/qr-label-pdf.py --demo --format 5163 --output demo-sheet.pdf
  python3 tools/qr-label-pdf.py --from-db --tenant-id <uuid> --format 5160 --output customer.pdf
"""
from __future__ import annotations

import argparse
import io
import os
import sys

import qrcode
from qrcode.image.pil import PilImage
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

# ---------------------------------------------------------------------------
# Layout definitions (all measurements in points; 1 inch = 72 pts)
# ---------------------------------------------------------------------------

LAYOUTS: dict[str, dict] = {
    "5163": {
        "label_w": 4.0 * inch,
        "label_h": 2.0 * inch,
        "cols": 2,
        "rows": 5,
        "margin_left": 0.15 * inch,
        "margin_top": 0.5 * inch,
        "col_gap": 0.19 * inch,
        "row_gap": 0.0 * inch,
        "qr_size": 1.5 * inch,
        "font_title": 11,
        "font_tag": 8,
        "font_tagline": 7,
    },
    "5160": {
        "label_w": 2.625 * inch,
        "label_h": 1.0 * inch,
        "cols": 3,
        "rows": 10,
        "margin_left": 0.19 * inch,
        "margin_top": 0.5 * inch,
        "col_gap": 0.125 * inch,
        "row_gap": 0.0 * inch,
        "qr_size": 0.75 * inch,
        "font_title": 7,
        "font_tag": 6,
        "font_tagline": 5,
    },
}

DEMO_TAGS = [
    ("VFD-LINE1", "AutomationDirect GS20 — Line 1"),
    ("VFD-LINE2", "AutomationDirect GS20 — Line 2"),
    ("VFD-PUMP",  "GS10 VFD — Coolant Pump"),
    ("MOTOR-A1",  "3HP Motor — Assembly A1"),
    ("PLC-PANEL", "Micro820 PLC Panel"),
]

BASE_URL = "https://app.factorylm.com/m"


def make_qr_image(url: str) -> ImageReader:
    img = qrcode.make(url, image_factory=PilImage, box_size=10, border=1,
                      error_correction=qrcode.constants.ERROR_CORRECT_M)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)


def draw_label(
    c: canvas.Canvas,
    x: float,
    y: float,
    layout: dict,
    asset_tag: str,
    asset_name: str,
    tenant_name: str,
) -> None:
    lw = layout["label_w"]
    lh = layout["label_h"]
    qs = layout["qr_size"]
    pad = 4

    url = f"{BASE_URL}/{asset_tag}"
    qr_img = make_qr_image(url)

    # QR code — left side
    qr_x = x + pad
    qr_y = y + (lh - qs) / 2
    c.drawImage(qr_img, qr_x, qr_y, width=qs, height=qs, preserveAspectRatio=True)

    # Text — right of QR
    tx = x + qs + pad * 3
    tw = lw - qs - pad * 4

    # Asset name (bold, wrap if needed)
    c.setFont("Helvetica-Bold", layout["font_title"])
    text_y = y + lh - layout["font_title"] - pad
    c.drawString(tx, text_y, asset_name[:28])

    # Asset tag
    c.setFont("Helvetica", layout["font_tag"])
    text_y -= layout["font_tag"] + 2
    c.drawString(tx, text_y, f"Tag: {asset_tag}")

    # Tenant
    text_y -= layout["font_tag"] + 2
    c.drawString(tx, text_y, tenant_name[:22])

    # Tagline
    c.setFont("Helvetica-Oblique", layout["font_tagline"])
    text_y -= layout["font_tagline"] + 2
    c.drawString(tx, text_y, "Scan to diagnose")
    text_y -= layout["font_tagline"] + 1
    c.drawString(tx, text_y, "Powered by MIRA")


def generate_pdf(
    labels: list[tuple[str, str]],  # (asset_tag, asset_name)
    tenant_name: str,
    layout_key: str,
    output_path: str,
) -> None:
    layout = LAYOUTS[layout_key]
    page_w, page_h = letter

    c = canvas.Canvas(output_path, pagesize=letter)

    per_page = layout["cols"] * layout["rows"]
    label_w = layout["label_w"]
    label_h = layout["label_h"]
    cols = layout["cols"]
    rows = layout["rows"]
    margin_l = layout["margin_left"]
    margin_t = layout["margin_top"]
    col_gap = layout["col_gap"]
    row_gap = layout["row_gap"]

    for i, (tag, name) in enumerate(labels):
        page_pos = i % per_page
        if page_pos == 0 and i > 0:
            c.showPage()

        col = page_pos % cols
        row = page_pos // cols

        x = margin_l + col * (label_w + col_gap)
        y = page_h - margin_t - (row + 1) * label_h - row * row_gap

        draw_label(c, x, y, layout, tag, name, tenant_name)

    c.save()
    print(f"Wrote {len(labels)} label(s) across {((len(labels) - 1) // per_page) + 1} page(s) → {output_path}")


def labels_from_db(tenant_id: str) -> list[tuple[str, str]]:
    import psycopg2  # noqa: PLC0415
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        sys.exit("NEON_DATABASE_URL not set — run with: doppler run --project factorylm --config prd -- python3 ...")
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    cur.execute(
        "SELECT asset_tag, asset_name FROM asset_qr_tags WHERE tenant_id = %s ORDER BY asset_tag",
        (tenant_id,),
    )
    rows = [(r[0], r[1] or r[0]) for r in cur.fetchall()]
    conn.close()
    if not rows:
        sys.exit(f"No assets found for tenant_id={tenant_id}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="MIRA QR Label PDF Generator")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--tags", help="Comma-separated asset tags, e.g. VFD-07,PUMP-03")
    src.add_argument("--demo", action="store_true", help="Generate 5-VFD sales demo sheet")
    src.add_argument("--from-db", action="store_true", help="Pull all tags from NeonDB for tenant")

    parser.add_argument("--tenant", default="FactoryLM", help="Tenant name shown on label")
    parser.add_argument("--tenant-id", help="UUID for --from-db mode")
    parser.add_argument("--format", choices=["5163", "5160"], default="5163")
    parser.add_argument("--output", default="labels.pdf")
    args = parser.parse_args()

    if args.demo:
        labels = DEMO_TAGS
        tenant_name = args.tenant
    elif args.from_db:
        if not args.tenant_id:
            sys.exit("--from-db requires --tenant-id")
        labels = labels_from_db(args.tenant_id)
        tenant_name = args.tenant
    else:
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        labels = [(t, t) for t in tags]
        tenant_name = args.tenant

    generate_pdf(labels, tenant_name, args.format, args.output)

    # Verify: print encoded URLs
    print("\nQR URLs encoded:")
    for tag, name in labels:
        print(f"  {tag}: {BASE_URL}/{tag}")


if __name__ == "__main__":
    main()
