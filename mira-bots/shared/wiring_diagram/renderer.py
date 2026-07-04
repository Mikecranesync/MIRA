"""WiringRenderer — spec → SVG → PNG pipeline.

Takes a DiagramSpec and produces a professional IEC 60617 wiring
diagram as SVG, then to PNG/PDF via PyMuPDF (fitz).
"""

from __future__ import annotations

import logging
from datetime import date

from .layout import (
    BusBar,
    LayoutResult,
    PlacedComponent,
    WireSegment,
    compute_layout,
    route_wires,
)
from .schema import DiagramSpec
from .style import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    COLOR_BG,
    COLOR_BLACK,
    COLOR_GRAY,
    COLOR_LIGHT_GRAY,
    COLOR_PE,
    CONNECTION_DOT,
    FONT_DEVICE_TAG,
    FONT_FAMILY,
    FONT_NOTE,
    FONT_SUBTITLE,
    FONT_TERMINAL,
    FONT_TITLE,
    FONT_WIRE_LABEL,
    HIRES_SCALE,
    STROKE_BUS,
    STROKE_DETAIL,
    STROKE_PRIMARY,
    TITLE_BLOCK_HEIGHT,
    TITLE_BLOCK_WIDTH,
    WIRE_COLORS,
)
from .symbols import SYMBOL_REGISTRY

log = logging.getLogger(__name__)


class WiringRenderer:
    """Renders a DiagramSpec into SVG and PNG."""

    def __init__(self, spec: DiagramSpec):
        self.spec = spec
        self._svg_parts: list[str] = []

    def render_svg(self) -> str:
        """Generate a complete, auto-fitted SVG string from the spec.

        The sheet is cropped to the drawn content (no fixed 1600x1000 canvas /
        scattered whitespace), the title block + notes + legend are placed just
        under the drawing, and terminal IDs are drawn once (by the symbols
        themselves) instead of being double-labelled.
        """
        self._svg_parts = []

        # 1. Layout + component drawing (fills terminal_positions) + wire routing
        layout = compute_layout(self.spec)
        self._draw_components(layout)
        wire_segments = route_wires(layout, self.spec.connections)
        layout.wire_segments = wire_segments

        # 2. Content bounding box (terminals + component centres + wires + buses)
        xs: list[float] = []
        ys: list[float] = []
        for pc in layout.placed_components:
            xs.append(pc.cx)
            ys.append(pc.cy)
            for tx, ty in pc.terminal_positions.values():
                xs.append(tx)
                ys.append(ty)
        for seg in wire_segments:
            xs += [seg.x1, seg.x2]
            ys += [seg.y1, seg.y2]
        for bus in layout.bus_bars:
            xs += [bus.x1, bus.x2]
            ys += [bus.y1, bus.y2]
        if not xs:  # empty spec — fall back to a small canvas
            xs, ys = [0.0, 400.0], [0.0, 200.0]
        sym = 55  # symbol bodies extend past their terminal points
        cminx, cmaxx = min(xs) - sym, max(xs) + sym
        cminy, cmaxy = min(ys) - sym, max(ys) + sym

        # 3. Footer STACKED below the drawing (notes -> legend -> title block) so a
        #    long note can never collide with the title block.
        footer_top = cmaxy + 30
        notes_svg = self._draw_notes(cminx, footer_top + 12)
        n_notes = min(len(self.spec.notes), 10)
        notes_bottom = footer_top + 12 + ((15 + n_notes * 14) if self.spec.notes else 0)
        legend_svg = self._draw_legend(cminx, notes_bottom + 18)
        legend_bottom = notes_bottom + 24
        title_top = legend_bottom + 16
        content_right = max(cmaxx, cminx + TITLE_BLOCK_WIDTH)
        title_svg = self._draw_title_block(content_right - TITLE_BLOCK_WIDTH, title_top)
        footer_bottom = title_top + TITLE_BLOCK_HEIGHT

        # 4. Tight viewBox around content + footer
        pad = 36
        vminx, vminy = cminx - pad, cminy - pad
        vw = (content_right - cminx) + 2 * pad
        vh = (footer_bottom - cminy) + 2 * pad

        svg_lines = [self._svg_header(vminx, vminy, vw, vh)]
        svg_lines.append(
            f'<rect x="{vminx}" y="{vminy}" width="{vw}" height="{vh}" fill="{COLOR_BG}"/>'
        )
        for bus in layout.bus_bars:
            svg_lines.append(self._draw_bus(bus))
        for seg in layout.wire_segments:
            svg_lines.append(self._draw_wire(seg))
        svg_lines.extend(self._draw_connection_dots(layout.wire_segments))
        svg_lines.extend(self._svg_parts)  # symbols draw + label their own pins
        svg_lines.append(title_svg)
        svg_lines.append(notes_svg)
        svg_lines.append(legend_svg)
        svg_lines.append("</svg>")

        return "\n".join(svg_lines)

    def render_png(self, hires: bool = False) -> bytes:
        """Generate PNG bytes from the spec via PyMuPDF (fitz).

        Rasterizes the SVG string. Replaces the original CairoSVG path:
        cairosvg is LGPL and MIRA ships MIT/Apache-2.0 only (PRD §4). fitz is
        already a repo dependency.
        """
        import fitz  # PyMuPDF

        svg_str = self.render_svg()
        scale = HIRES_SCALE if hires else 1
        doc = fitz.open(stream=svg_str.encode("utf-8"), filetype="svg")
        try:
            page = doc[0]
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            return pix.tobytes("png")
        finally:
            doc.close()

    def render_pdf(self) -> bytes:
        """Generate a vector PDF from the spec via PyMuPDF (fitz)."""
        import fitz  # PyMuPDF

        svg_str = self.render_svg()
        doc = fitz.open(stream=svg_str.encode("utf-8"), filetype="svg")
        try:
            return doc.convert_to_pdf()
        finally:
            doc.close()

    def render_png_to_file(self, path: str, hires: bool = False) -> None:
        """Render PNG to a file path."""
        png_bytes = self.render_png(hires=hires)
        with open(path, "wb") as f:
            f.write(png_bytes)
        log.info("PNG written to %s (%d bytes)", path, len(png_bytes))

    def render_pdf_to_file(self, path: str) -> None:
        """Render a vector PDF to a file path."""
        pdf_bytes = self.render_pdf()
        with open(path, "wb") as f:
            f.write(pdf_bytes)
        log.info("PDF written to %s (%d bytes)", path, len(pdf_bytes))

    # ------------------------------------------------------------------
    # SVG construction helpers
    # ------------------------------------------------------------------

    def _svg_header(self, vx: float, vy: float, vw: float, vh: float) -> str:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{vw:.0f}" height="{vh:.0f}" '
            f'viewBox="{vx:.0f} {vy:.0f} {vw:.0f} {vh:.0f}" '
            f'style="font-family: {FONT_FAMILY};">'
        )

    def _draw_grid(self) -> str:
        """Subtle background grid for alignment reference."""
        lines = ['<g opacity="0.1">']
        # Vertical grid lines every 100px
        for x in range(0, CANVAS_WIDTH + 1, 100):
            lines.append(
                f'<line x1="{x}" y1="0" x2="{x}" y2="{CANVAS_HEIGHT}" '
                f'stroke="{COLOR_LIGHT_GRAY}" stroke-width="0.5"/>'
            )
        # Horizontal grid lines every 100px
        for y in range(0, CANVAS_HEIGHT + 1, 100):
            lines.append(
                f'<line x1="0" y1="{y}" x2="{CANVAS_WIDTH}" y2="{y}" '
                f'stroke="{COLOR_LIGHT_GRAY}" stroke-width="0.5"/>'
            )
        lines.append("</g>")
        return "\n".join(lines)

    def _draw_components(self, layout: LayoutResult) -> None:
        """Draw each component symbol and record terminal positions."""
        for pc in layout.placed_components:
            comp = pc.component
            draw_fn = SYMBOL_REGISTRY.get(comp.type)
            if not draw_fn:
                log.warning("Unknown symbol type: %s for %s", comp.type, comp.tag)
                # Fallback: draw a labeled rectangle
                svg, terminals = self._fallback_symbol(pc.cx, pc.cy, comp.tag, comp.type)
            else:
                # Handle PLC cards with custom pins
                if comp.type in ("plc_input_card", "plc_output_card") and comp.terminals:
                    pins = [
                        {"name": t.id, "side": t.side, "label": t.label} for t in comp.terminals
                    ]
                    svg, terminals = draw_fn(pc.cx, pc.cy, tag=comp.tag, pins=pins)
                else:
                    svg, terminals = draw_fn(pc.cx, pc.cy, tag=comp.tag)

            pc.terminal_positions = terminals
            self._svg_parts.append(f'<g id="comp-{comp.tag}">\n{svg}\n</g>')

    def _fallback_symbol(
        self, cx: float, cy: float, tag: str, comp_type: str
    ) -> tuple[str, dict[str, tuple[float, float]]]:
        """Draw a generic labeled box for unknown component types."""
        w, h = 80, 50
        x0, y0 = cx - w / 2, cy - h / 2
        parts = [
            f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" '
            f'fill="none" stroke="{COLOR_BLACK}" stroke-width="{STROKE_PRIMARY}" '
            f'stroke-dasharray="4,2"/>',
            f'<text x="{cx}" y="{cy - 5}" font-size="{FONT_DEVICE_TAG}" '
            f'text-anchor="middle" fill="{COLOR_BLACK}">{tag}</text>',
            f'<text x="{cx}" y="{cy + 12}" font-size="8" '
            f'text-anchor="middle" fill="{COLOR_GRAY}">{comp_type}</text>',
        ]
        # Generic terminals top and bottom
        terminals = {
            "1": (cx, y0 - 20),
            "2": (cx, y0 + h + 20),
        }
        parts.append(
            f'<line x1="{cx}" y1="{y0}" x2="{cx}" y2="{y0 - 20}" '
            f'stroke="{COLOR_BLACK}" stroke-width="{STROKE_PRIMARY}"/>'
        )
        parts.append(
            f'<line x1="{cx}" y1="{y0 + h}" x2="{cx}" y2="{y0 + h + 20}" '
            f'stroke="{COLOR_BLACK}" stroke-width="{STROKE_PRIMARY}"/>'
        )
        return "\n".join(parts), terminals

    def _draw_bus(self, bus: BusBar) -> str:
        """Draw a bus bar with label."""
        color = WIRE_COLORS.get(bus.bus_type, COLOR_BLACK)
        if bus.name == "PE":
            color = COLOR_PE

        parts = [
            f'<line x1="{bus.x1}" y1="{bus.y1}" x2="{bus.x2}" y2="{bus.y2}" '
            f'stroke="{color}" stroke-width="{STROKE_BUS}" stroke-linecap="round"/>',
        ]

        # Bus label
        if bus.x1 == bus.x2:
            # Vertical bus
            lx, ly = bus.x1 - 15, (bus.y1 + bus.y2) / 2
            parts.append(
                f'<text x="{lx}" y="{ly}" font-size="{FONT_WIRE_LABEL}" '
                f'text-anchor="end" fill="{color}" font-weight="bold">{bus.name}</text>'
            )
        else:
            # Horizontal bus
            lx, ly = bus.x1 - 10, bus.y1
            parts.append(
                f'<text x="{lx}" y="{ly + 4}" font-size="{FONT_WIRE_LABEL}" '
                f'text-anchor="end" fill="{color}" font-weight="bold">{bus.name}</text>'
            )

        return "\n".join(parts)

    def _draw_wire(self, seg: WireSegment) -> str:
        """Draw a wire segment."""
        color = WIRE_COLORS.get(seg.wire_type, COLOR_BLACK)
        sw = STROKE_PRIMARY
        if seg.wire_type == "signal":
            sw = STROKE_DETAIL

        parts = [
            f'<line x1="{seg.x1}" y1="{seg.y1}" x2="{seg.x2}" y2="{seg.y2}" '
            f'stroke="{color}" stroke-width="{sw}" stroke-linecap="round"/>',
        ]

        # Wire label at midpoint
        if seg.wire_label:
            mx = (seg.x1 + seg.x2) / 2
            my = (seg.y1 + seg.y2) / 2
            # Offset label slightly from wire
            offset = 8 if seg.x1 == seg.x2 else -8  # right of vertical, above horizontal
            if seg.x1 == seg.x2:
                parts.append(
                    f'<text x="{mx + offset}" y="{my}" font-size="{FONT_WIRE_LABEL}" '
                    f'text-anchor="start" fill="{color}">{seg.wire_label}</text>'
                )
            else:
                parts.append(
                    f'<text x="{mx}" y="{my + offset}" font-size="{FONT_WIRE_LABEL}" '
                    f'text-anchor="middle" fill="{color}">{seg.wire_label}</text>'
                )

        return "\n".join(parts)

    def _draw_connection_dots(self, segments: list[WireSegment]) -> list[str]:
        """Find T-junctions (3+ wire endpoints at same point) and draw filled dots."""
        # Count endpoints at each coordinate
        point_count: dict[tuple[float, float], int] = {}
        for seg in segments:
            p1 = (round(seg.x1, 1), round(seg.y1, 1))
            p2 = (round(seg.x2, 1), round(seg.y2, 1))
            point_count[p1] = point_count.get(p1, 0) + 1
            point_count[p2] = point_count.get(p2, 0) + 1

        dots = []
        for (x, y), count in point_count.items():
            if count >= 3:
                dots.append(
                    f'<circle cx="{x}" cy="{y}" r="{CONNECTION_DOT}" '
                    f'fill="{COLOR_BLACK}" stroke="none"/>'
                )
        return dots

    def _draw_terminal_labels(self, pc: PlacedComponent) -> str:
        """Draw terminal number labels near each terminal point."""
        parts = []
        for tid, (tx, ty) in pc.terminal_positions.items():
            # Offset label slightly from terminal dot
            parts.append(
                f'<text x="{tx + 6}" y="{ty - 6}" font-size="{FONT_TERMINAL}" '
                f'fill="{COLOR_GRAY}" text-anchor="start">{tid}</text>'
            )
        return "\n".join(parts)

    def _draw_title_block(self, bx: float, by: float) -> str:
        """Draw the title block at the given top-left origin."""
        bw = TITLE_BLOCK_WIDTH
        bh = TITLE_BLOCK_HEIGHT

        d = self.spec.date or date.today().isoformat()

        parts = [
            f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" '
            f'fill="none" stroke="{COLOR_BLACK}" stroke-width="{STROKE_PRIMARY}"/>',
            # Horizontal divider
            f'<line x1="{bx}" y1="{by + bh / 2}" x2="{bx + bw}" y2="{by + bh / 2}" '
            f'stroke="{COLOR_BLACK}" stroke-width="{STROKE_DETAIL}"/>',
            # Title
            f'<text x="{bx + 10}" y="{by + 20}" font-size="{FONT_TITLE}" '
            f'font-weight="bold" fill="{COLOR_BLACK}">{self.spec.title}</text>',
            # Drawing number + revision
            f'<text x="{bx + 10}" y="{by + bh / 2 + 18}" font-size="{FONT_SUBTITLE}" '
            f'fill="{COLOR_BLACK}">{self.spec.drawing_number} Rev {self.spec.revision} | '
            f"{self.spec.standard} | {d}</text>",
            # Author
            f'<text x="{bx + bw - 10}" y="{by + bh / 2 + 18}" font-size="{FONT_NOTE}" '
            f'text-anchor="end" fill="{COLOR_GRAY}">{self.spec.author}</text>',
        ]
        return "\n".join(parts)

    def _draw_notes(self, nx: float, ny: float) -> str:
        """Draw the notes block at the given origin (nx, ny = 'Notes:' baseline)."""
        if not self.spec.notes:
            return ""

        parts = [
            f'<text x="{nx}" y="{ny}" font-size="{FONT_NOTE}" '
            f'font-weight="bold" fill="{COLOR_BLACK}">Notes:</text>'
        ]
        for i, note in enumerate(self.spec.notes[:10]):
            parts.append(
                f'<text x="{nx}" y="{ny + 15 + i * 14}" font-size="{FONT_NOTE}" '
                f'fill="{COLOR_BLACK}">{i + 1}. {_escape_xml(note[:120])}</text>'
            )
        return "\n".join(parts)

    def _draw_legend(self, lx: float, ly: float) -> str:
        """Draw the wire-type legend at the given origin."""
        # Collect wire types used
        wire_types_used = {c.wire_type for c in self.spec.connections}
        if not wire_types_used:
            return ""

        parts = []
        offset = 0
        for wt in sorted(wire_types_used):
            color = WIRE_COLORS.get(wt, COLOR_BLACK)
            x = lx + offset
            parts.append(
                f'<line x1="{x}" y1="{ly}" x2="{x + 20}" y2="{ly}" '
                f'stroke="{color}" stroke-width="{STROKE_PRIMARY}"/>'
            )
            parts.append(
                f'<text x="{x + 25}" y="{ly + 4}" font-size="8" fill="{COLOR_BLACK}">{wt}</text>'
            )
            offset += 80

        return "\n".join(parts)


def _escape_xml(text: str) -> str:
    """Escape special XML characters."""
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


def render_from_json(spec_json: dict) -> bytes:
    """Convenience: parse JSON dict into DiagramSpec and render PNG."""
    spec = DiagramSpec.model_validate(spec_json)
    renderer = WiringRenderer(spec)
    return renderer.render_png()


def render_markdown_summary(spec: DiagramSpec) -> str:
    """Generate the Telegram markdown summary for a diagram."""
    lines = [
        f"**{spec.title}**",
        f"Drawing: {spec.drawing_number} Rev {spec.revision}",
        "",
    ]

    if spec.components:
        lines.append("**Components:**")
        for comp in spec.components:
            ratings_str = ""
            if comp.ratings:
                r = comp.ratings
                parts = []
                if r.voltage:
                    parts.append(r.voltage)
                if r.current:
                    parts.append(r.current)
                if r.power:
                    parts.append(r.power)
                ratings_str = ", " + ", ".join(parts) if parts else ""
            label = comp.label or comp.type.replace("_", " ").title()
            lines.append(f"- {comp.tag}: {label}{ratings_str}")

    if spec.connections:
        lines.append("")
        lines.append("**Connections:**")
        lines.append("| From | To | Wire | Type |")
        lines.append("|------|----|------|------|")
        for conn in spec.connections[:15]:
            lines.append(
                f"| {conn.from_terminal} | {conn.to_terminal} | "
                f"{conn.wire_label} | {conn.wire_type} |"
            )
        if len(spec.connections) > 15:
            lines.append(f"| ... | +{len(spec.connections) - 15} more | | |")

    if spec.notes:
        lines.append("")
        lines.append("**Notes:**")
        for note in spec.notes:
            lines.append(f"- {note}")

    return "\n".join(lines)
