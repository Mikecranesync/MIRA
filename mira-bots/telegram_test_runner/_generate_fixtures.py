"""
Generate synthetic industrial nameplate test fixtures.
Run once to create test-assets/sample_tags/*.jpg
"""
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow")
    raise SystemExit(1)


OUT_DIR = Path(__file__).parent / "test-assets" / "sample_tags"
OUT_DIR.mkdir(parents=True, exist_ok=True)

W, H = 800, 500
BG = (210, 215, 212)
HEADER_BG = (30, 30, 80)
HEADER_FG = (255, 255, 255)
HAZARD_BG = (240, 200, 0)
HAZARD_FG = (0, 0, 0)
TEXT_FG = (0, 0, 0)
BORDER = (0, 0, 0)

try:
    font_header = ImageFont.load_default(size=28)
    font_body = ImageFont.load_default(size=18)
    font_hazard = ImageFont.load_default(size=16)
except TypeError:
    # Pillow < 10 fallback
    font_header = ImageFont.load_default()
    font_body = ImageFont.load_default()
    font_hazard = ImageFont.load_default()


def draw_nameplate(fields: list[tuple[str, str]], manufacturer: str) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Outer border
    draw.rectangle([0, 0, W - 1, H - 1], outline=BORDER, width=3)

    # Header bar (top 60px)
    draw.rectangle([3, 3, W - 4, 63], fill=HEADER_BG)
    draw.text((20, 18), manufacturer, font=font_header, fill=HEADER_FG)

    # Hazard bar (bottom 40px)
    draw.rectangle([3, H - 43, W - 4, H - 4], fill=HAZARD_BG)
    draw.text((20, H - 33), "⚠  CAUTION: ELECTRICAL HAZARD", font=font_hazard, fill=HAZARD_FG)

    # Fields (2-column table)
    y = 80
    col1_x = 20
    col2_x = 260
    row_h = 34

    for label, value in fields:
        draw.text((col1_x, y), label + ":", font=font_body, fill=TEXT_FG)
        # Bold effect: draw twice offset by 1px
        draw.text((col2_x + 1, y + 1), value, font=font_body, fill=TEXT_FG)
        draw.text((col2_x, y), value, font=font_body, fill=TEXT_FG)
        y += row_h

    return img


# --- 1. ab_micro820_tag ---
fields_ab = [
    ("Manufacturer", "Allen-Bradley"),
    ("Model", "Micro820"),
    ("Catalog", "2080-LC20-20QWB"),
    ("Voltage", "24VDC"),
    ("I/O Points", "20"),
    ("Type", "PLC — Programmable Logic Controller"),
]
img1 = draw_nameplate(fields_ab, "Allen-Bradley — Micro820 Programmable Controller")
img1.save(OUT_DIR / "ab_micro820_tag.jpg", "JPEG", quality=92)
print("Created ab_micro820_tag.jpg")


# --- 2. gs10_vfd_tag ---
fields_gs10 = [
    ("Manufacturer", "AutomationDirect"),
    ("Model", "GS10"),
    ("Catalog", "GS10-20P5"),
    ("Input", "208-240VAC 1Φ"),
    ("Output", "0-240VAC 3Φ"),
    ("Rating", "0.5HP Variable Frequency Drive"),
]
img2 = draw_nameplate(fields_gs10, "AutomationDirect — GS10 Variable Frequency Drive")
img2.save(OUT_DIR / "gs10_vfd_tag.jpg", "JPEG", quality=92)
print("Created gs10_vfd_tag.jpg")


# --- 3. generic_cabinet_tag ---
fields_cab = [
    ("Panel ID", "MCC-003"),
    ("Manufacturer", "Square D"),
    ("Voltage", "480VAC 3Φ"),
    ("Current", "100A"),
    ("Enclosure", "NEMA 12"),
    ("Type", "Motor Control Center"),
]
img3 = draw_nameplate(fields_cab, "Square D — Motor Control Center Panel MCC-003")
img3.save(OUT_DIR / "generic_cabinet_tag.jpg", "JPEG", quality=92)
print("Created generic_cabinet_tag.jpg")


# --- 4. bad_glare_tag (ab_micro820 + glare overlay) ---
img4_base = img1.copy().convert("RGBA")
glare_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
glare_draw = ImageDraw.Draw(glare_layer)
# Glare rectangle covering the catalog number field row (~y=148 to y=182)
glare_draw.rectangle([200, 148, 600, 182], fill=(255, 255, 255, 180))
img4 = Image.alpha_composite(img4_base, glare_layer).convert("RGB")
img4.save(OUT_DIR / "bad_glare_tag.jpg", "JPEG", quality=92)
print("Created bad_glare_tag.jpg")


# --- 5. cropped_tight_tag (gs10, top third) ---
crop_h = H // 3  # 166px
img5 = img2.crop((0, 0, W, crop_h))
img5.save(OUT_DIR / "cropped_tight_tag.jpg", "JPEG", quality=92)
print("Created cropped_tight_tag.jpg")

print("\nAll fixtures generated successfully.")
