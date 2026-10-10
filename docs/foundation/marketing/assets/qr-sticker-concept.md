# QR sticker concept: "Manual on the machine"
*Free kit. Works today with no MIRA. Later, pilot plants get stickers that open that machine's Hub notebook.*

## The idea
A small sticker on the drive, panel or machine. A tech scans it and lands on that machine's manual and the most-needed page (fault table, wiring, parameter list) in seconds, with no hunting through a filing cabinet or a shared drive.

## Two versions
| | **Free kit (now)** | **Pilot plants (after a pilot starts)** |
|---|---|---|
| QR opens | The OEM's **own public manual file/page** (we never host it) | That machine's FactoryLM Hub notebook (cited Q&A on the plant's own manuals) |
| Who makes it | Fault Page Writer finds official URLs + page numbers; Mike spot-checks 2 per sheet | Mike, during pilot setup |
| Cost | $0 (printable PDF) | $0 printable; weatherproof printing at plant's choice |

## Sticker layout (about 2 × 3 in)
```
┌───────────────────────────────┐
│ [QR]   MANUAL: PowerFlex 525   │
│        User Manual, pub. [#]   │
│        Fault codes: p. [nn]    │
│        Wiring: p. [nn]         │
│  Scan for the manual           │
│  Asset: ________  (write-in)   │
│  Manual sticker by FactoryLM   │
└───────────────────────────────┘
```
- Plain black on white or yellow for readability; large type for page numbers.
- **No OEM logos.** Model names are text only.
- Footer: "Manual sticker by FactoryLM · verify against your site's documents."
- Write-in asset tag line so it fits any CMMS numbering.

## How a plant gets a kit
1. Fill in a short form (or reply to Mike): up to 10 machine/drive models.
2. Within 2 business days, receive a printable PDF sheet (Avery-style layout) plus a one-line note offering a free Manual Check.
3. Optional: send a photo of a sticker on a real machine (used publicly only with permission).

## Production (on the box)
- Generate QR codes with a free Python QR library → render the sheet to PDF with Shell.
- Each URL is checked to resolve to the OEM's own domain; broken links are replaced before sending.
- Log every kit in HubSpot (plant, models, date).

## Guardrails
- Link only to OEM-hosted manuals: no re-hosting, no copies (copyright).
- If an OEM manual is behind a login, the sticker shows the publication number and page only, no QR.
- Never imply OEM endorsement.
- **Money:** printing weatherproof sample stickers for events (SMRP Nov 6) needs Mike's OK on a small print order (get a quote first).

## Metric
Kits requested · photos of stickers on real machines · kit → Manual Check requests.
