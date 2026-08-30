# Internet Print Test — aggregate index

| test_id | source | category | standard | result | score | hard_fail | email |
|---|---|---|---|---|---|---|---|
| rockwell-509-nema-starter | https://literature.rockwellautomation.co | motor_starter | NEMA ICS 2 | ok | None | None | dry-run (package built, not sent) |
| banner-esfl-estop-relay | https://info.bannerengineering.com/cs/gr | safety_relay | ISO 13850 / EN 418 | ok | None | None | dry-run (package built, not sent) |
| automationdirect-gs20-vfd | https://cdn.automationdirect.com/static/ | vfd | NEMA ICS 6 | ok | 86 | False | dry-run (package built, not sent) |
| abb-star-delta-starter | https://library.e.abb.com/public/ac6b6e4 | contactor | IEC 60947-4-1 | ok | None | None | dry-run (package built, not sent) |
| automationdirect-click-plc-io | https://cdn.automationdirect.com/static/ | plc_io | Industrial 24VDC | ok | 42 | True | sent |
| schneider-atv340-vfd | https://download.schneider-electric.com/ | vfd | IEC 61800-5-1 | ok | None | None | dry-run (package built, not sent) |
| siemens-3sk1-safety-relay | https://cache.industry.siemens.com/dl/fi | safety_relay | ISO 13849-1 PLe / IEC 62061 SIL3 | ok | 84 | False | sent |
| automationdirect-an-gs-022-reversing | https://support.automationdirect.com/doc | reversing_braking | NEMA ICS 2 | ok | 79 | False | sent |
| omron-cp1e-plc-io | https://www.omron-ap.com/data_pdf/mnu/cp | plc_io | Industrial 24VDC | error: FetchError: robots.txt disallows fetching https://www.omron-ap.com/data_pdf/mnu/cp1e-cpu(iowiringdiagram)_inst-1131078-2b.pdf?id=2064 | None | None | not-attempted |
| mitsubishi-fx3u-input-wiring | https://dl.mitsubishielectric.com/dl/fa/ | plc_io | Industrial 24VDC | ok | None | None | dry-run (package built, not sent) |
| url-d82eba78cf | https://support.automationdirect.com/doc | None | None | ok | 82 | False | sent |
| local-us1839934-p0 |  | None | None | ok | None | None | dry-run (package built, not sent) |
| local-pf525-523-control-io |  | None | None | ok | None | None | dry-run (package built, not sent) |