"""QR / DataMatrix identification links on nameplate photos (#5070).

Newer components print a 2D code on the nameplate: a QR that links to the
maker's product page (IEC 61406 "Identification Link"), or a DataMatrix that
carries the exact order number as an ANSI MH10.8.2 ``1P`` field. This module
reads those codes from photo bytes and classifies the payload. It is a
candidate source only: it never overrides the nameplate reading, never opens a
link, never logs the raw payload, and never calls a model.

Decoder: zxing-cpp (Apache-2.0, one native module, no further native deps).
Research and census: ``docs/research/2026-11-01-qr-identification-link.md``.
"""

from __future__ import annotations

import io
import ipaddress
import logging
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from PIL import Image, ImageOps

from ..manual_search.search import _is_denied, _is_oem_host

try:
    import zxingcpp
except ImportError:  # decoder absent → every decode returns [] (feature inert)
    zxingcpp = None

logger = logging.getLogger("mira-gsd")

KINDS = ("factorylm_tag", "oem_url", "other_url", "unsafe_url", "denied_url", "no_url")

_MAX_SIDE = 2000  # second pass for large phone photos (census: needed on misses)
_MH10_SPLIT = re.compile(r"[\x1d\x1e\x04+]")


@dataclass(frozen=True)
class DecodedCode:
    format: str  # "QRCode" | "MicroQRCode" | "DataMatrix"
    text: str


@dataclass(frozen=True)
class LinkClass:
    kind: str
    host: str | None = None
    part_number: str | None = None


def decode_codes(image_bytes: bytes | None) -> list[DecodedCode]:
    """Decode QR, Micro QR and DataMatrix codes from image bytes. Never raises."""
    if zxingcpp is None or not image_bytes:
        return []
    try:
        formats = [
            zxingcpp.BarcodeFormat.QRCode,
            zxingcpp.BarcodeFormat.MicroQRCode,
            zxingcpp.BarcodeFormat.DataMatrix,
        ]
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("L")
        found = zxingcpp.read_barcodes(img, formats=formats)
        if not found and max(img.size) > _MAX_SIDE:
            img.thumbnail((_MAX_SIDE, _MAX_SIDE))
            found = zxingcpp.read_barcodes(img, formats=formats)
        return [DecodedCode(b.format.name, b.text) for b in found if b.valid and b.text]
    except Exception as exc:  # unreadable image or decoder fault → no codes
        logger.debug("identification-link decode skipped: %s", type(exc).__name__)
        return []


def _part_number(text: str) -> str | None:
    for field in _MH10_SPLIT.split(text):
        if field.startswith("1P") and len(field) > 2:
            return field[2:].strip() or None
    return None


def classify_payload(text: object, make: str | None) -> LinkClass:
    """Classify one decoded payload against the manual-search host rules. Never raises.

    A URL is ``oem_url`` only when its host is on the OEM list for the make the
    nameplate names; the host alone never earns trust.
    """
    if not isinstance(text, str) or not text.strip():
        return LinkClass("no_url")
    t = text.strip()
    try:
        u = urlsplit(t)
        if u.scheme.lower() not in ("http", "https") or not u.netloc:
            return LinkClass("no_url", part_number=_part_number(t))
        host = (u.hostname or "").lower()
        if not host:
            return LinkClass("unsafe_url")
        try:
            ipaddress.ip_address(host)
            return LinkClass("unsafe_url", host)
        except ValueError:
            pass
        if (
            u.username
            or u.password
            or u.port not in (None, 80, 443)
            or re.search(r"[\\\s<>\"']", t)
        ):
            return LinkClass("unsafe_url", host)
        if _is_denied(host):
            return LinkClass("denied_url", host)
        if (host == "factorylm.com" or host.endswith(".factorylm.com")) and u.path.startswith(
            "/m/"
        ):
            return LinkClass("factorylm_tag", host)
        if make and _is_oem_host(host, make):
            return LinkClass("oem_url", host)
        return LinkClass("other_url", host)
    except ValueError:  # malformed URL (bad IPv6 literal, bad port)
        return LinkClass("unsafe_url")
