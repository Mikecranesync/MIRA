# Internet Print Test — aggregate index

| test_id | source | category | standard | result | score | hard_fail | email |
|---|---|---|---|---|---|---|---|
| rockwell-509-nema-starter | https://literature.rockwellautomation.co | motor_starter | NEMA | ok | 83 | False | sent |
| banner-esfl-estop-relay | https://info.bannerengineering.com/cs/gr | safety_relay | ISO 13850 / EN 418 | ok | 88 | False | dry-run (package built, not sent) |
| automationdirect-gs20-vfd | https://cdn.automationdirect.com/static/ | vfd | NEMA ICS 6 | ok | 86 | False | dry-run (package built, not sent) |
| abb-star-delta-starter | https://library.e.abb.com/public/ac6b6e4 | contactor | IEC 60947-4-1 | ok | 78 | False | sent |
| automationdirect-click-plc-io | https://cdn.automationdirect.com/static/ | plc_io | Industrial 24VDC | ok | 42 | True | sent |
| schneider-atv340-vfd | https://download.schneider-electric.com/ | vfd | IEC 61800-5-1 | ok | 81 | False | sent |
| siemens-3sk1-safety-relay | https://cache.industry.siemens.com/dl/fi | safety_relay | ISO 13849-1 PLe / IEC 62061 SIL3 | ok | 84 | False | sent |
| automationdirect-an-gs-022-reversing | https://support.automationdirect.com/doc | reversing_braking | NEMA ICS 2 | ok | 79 | False | sent |
| boundary-plc-ladder-rungs | https://my.ece.utah.edu/~ece3510/Ladder% | plc_ladder | IEC 61131-3 ladder | ok | None | None | dry-run (package built, not sent) |
| boundary-terminal-block | https://productguides.aucotec.com/Docume | terminal_block | IEC 61082 / IEC 60445 | ok | None | None | dry-run (package built, not sent) |
| boundary-pneumatic-iso1219 | https://lagos.udg.mx/sites/default/files | pneumatic | DIN ISO 1219 | ok | None | None | dry-run (package built, not sent) |
| boundary-single-line | https://s3.amazonaws.com/suncam/docs/469 | single_line | ANSI/IEEE one-line; IEEE C37.2 device numbers | skip: robots.txt disallows fetching https://s3.amazonaws.com/suncam/docs/469.pdf | None | None | not-attempted |
| boundary-multipage-xref | https://wiredwhite.com/wp-content/upload | multipage_xref | IEC 60204-1 / IEC 60617 (/sheet.gridref xref) | ok | None | None | dry-run (package built, not sent) |
| boundary-relay-ladder-xref | https://archive.org/download/Square-d-wi | relay_ladder | NEMA ICS elementary/ladder (JIC) | ok | None | None | dry-run (package built, not sent) |
| boundary-panel-layout | https://hybridplc.org/wp-content/uploads | panel_layout | UL 508A / NFPA 79 practice (no single drawing standard) | ok | None | None | dry-run (package built, not sent) |
| boundary-pid-isa | https://pdhacademy.com/wp-content/upload | pid | ANSI/ISA-5.1 | ok | None | None | dry-run (package built, not sent) |
| boundary-hydraulic | https://media.toro.com/toroumaterials/pd | hydraulic | ISO 1219 / ANSI / JIC fluid-power symbols | ok | None | None | dry-run (package built, not sent) |
| boundary-safety-guardmaster | https://literature.rockwellautomation.co | safety_relay | IEC 60204-1 / ISO 13849-1 PLd Cat 3 / IEC 62061 SIL CL2 / NFPA 79 | ok | None | None | dry-run (package built, not sent) |