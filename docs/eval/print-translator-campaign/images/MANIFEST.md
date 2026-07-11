# Rendered Print Images — Manifest

Local, private-eval single-page excerpts rendered from the cited OEM PDFs at 200 dpi (PyMuPDF). Each `<id>.png` is exactly the page fed to the vision model for the matching `results/<id>.json` run. Never a whole manual — one page per image.

| id | image | page | png_sha256 | source URL |
|---|---|---|---|---|
| 3 | `images/03.png` | 4 | `146749bb955e478dad39aa2c6598d3de...` | library.e.abb.com/public/ac6b6e46df1ea3e6c1256e35004c9145/Star-delta%20Starters%20Open%20Type_technical%20data.pdf |
| 5 | `images/05.png` | 12 | `294e246bacf0434e1a747876cd66a9a7...` | literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf |
| 7 | `images/07.png` | 9 | `294f365ecf4743c1710d3adc7c3e8a35...` | cdn.automationdirect.com/static/manuals/softstartersr44/ch2.pdf |
| 9 | `images/09.png` | 41 | `5fa9882159cfc5890a628c8541c8c68a...` | literature.rockwellautomation.com/idc/groups/literature/documents/um/440r-um013_-en-p.pdf |
| 13 | `images/13.png` | 30 | `cd9481115213c424f07c84a44b9a0dc1...` | cdn.automationdirect.com/static/manuals/c0userm/ch3.pdf |
| 14 | `images/14.png` | 31 | `db3c19bc0f2fa84af4fa5ff86a2afa17...` | cdn.automationdirect.com/static/manuals/d006userm/ch2.pdf |
| 17 | `images/17.png` | 37 | `6bb1ff9ab538fd68d35ccd18eb9f8797...` | cdn.automationdirect.com/static/manuals/gs20m/ch2.pdf |
| 18 | `images/18.png` | 50 | `743ed1b4b1af08cbcdf79cbd852997fa...` | library.e.abb.com/public/805f31a82d524d8aa8a750011e2cd001/EN_ACS355_UM_E_A5.pdf |
| 20 | `images/20.png` | 26 | `bfb7993a62f25f394aed67c7786529a2...` | static.weg.net/medias/downloadcenter/hae/h83/WEG-10004699316-13871637-r00-CFW11-W-users-manual-en.pdf |
| 25 | `images/25.png` | 1 | `f88e9d5c600e4c147f8cd40b103c17da...` | www.yaskawa.com/delegate/getAttachment?documentId=WD.V1000.01&cmd=documents&documentName=WD.V1000.01.pdf |

Entry #21 (AutomationDirect AN-GS-022) was run but excluded from the first-10 set (see `../rejected.md`) — no image persisted for it.
