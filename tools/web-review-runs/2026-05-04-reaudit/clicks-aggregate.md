# Interaction-crawl aggregate — 2026-05-04

## Per-route interaction summary

| Slug | Status | Clickables | Run | Nav | ConsoleErr | NetFail | Skipped |
|---|---|---|---|---|---|---|---|
| apex-activated__desktop | 200 | 13 | 13 | 9 | 1 | 0 | 0 |
| apex-activated__mobile | 200 | 13 | 13 | 4 | 1 | 0 | 0 |
| apex-blog-fault-codes__desktop | 200 | 64 | 50 | 50 | 28 | 21 | 0 |
| apex-blog__desktop | 200 | 23 | 23 | 21 | 6 | 2 | 0 |
| apex-blog__mobile | 200 | 23 | 23 | 16 | 13 | 12 | 0 |
| apex-cmms__desktop | 200 | 13 | 13 | 9 | 1 | 0 | 0 |
| apex-cmms__mobile | 200 | 13 | 13 | 4 | 1 | 0 | 0 |
| apex-home__desktop | 200 | 30 | 29 | 15 | 1 | 0 | 1 |
| apex-home__mobile | 200 | 30 | 29 | 8 | 1 | 0 | 1 |
| apex-limitations__desktop | 200 | 14 | 13 | 10 | 1 | 0 | 1 |
| apex-pricing__desktop | 200 | 21 | 21 | 13 | 4 | 0 | 0 |
| apex-pricing__mobile | 200 | 21 | 21 | 9 | 4 | 0 | 0 |
| apex-security__desktop | 200 | 14 | 13 | 11 | 1 | 0 | 1 |
| app-activated__desktop | 200 | 4 | 4 | 1 | 1 | 0 | 0 |
| app-pricing__desktop | 200 | 21 | 21 | 13 | 14 | 0 | 0 |
| app-root__desktop | 200 | 4 | 4 | 2 | 1 | 0 | 0 |
| app-sample__desktop | 200 | 14 | 14 | 13 | 13 | 0 | 0 |

## Broken interactions

| Slug | # | Element | Tag | Failure |
|---|---|---|---|---|
| apex-activated__mobile | 6 | Security | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-activated__mobile | 7 | Sign in | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-activated__mobile | 9 | Limitations | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-activated__mobile | 10 | Trust | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-activated__mobile | 11 | Privacy | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-activated__mobile | 12 | Terms | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-activated__mobile | 13 | ☀ Sun-readable | button | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-blog-fault-codes__desktop | 19 | User Program Error User Program Error Mi | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 20 | Comms Timeout Communication Timeout Micr | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 22 | F070 Power Loss PowerFlex F070 power los | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 24 | E.OU DC Bus Overvoltage GS20 E.OU overvo | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 26 | E.OCA Overcurrent During Acceleration GS | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 27 | E.CF Communication Fault GS20 E.CF commu | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 29 | Alarm 414 Servo Alarm: N-Axis Excess Err | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 29 | Alarm 414 Servo Alarm: N-Axis Excess Err | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 29 | Alarm 414 Servo Alarm: N-Axis Excess Err | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 30 | Alarm 410 Servo Alarm: Excess Error (Dec | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 30 | Alarm 410 Servo Alarm: Excess Error (Dec | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 30 | Alarm 410 Servo Alarm: Excess Error (Dec | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 31 | Alarm 401 Servo Alarm: VRDY Off FANUC Al | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 31 | Alarm 401 Servo Alarm: VRDY Off FANUC Al | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 31 | Alarm 401 Servo Alarm: VRDY Off FANUC Al | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 32 | Alarm 306 Servo Overheating FANUC Alarm  | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 32 | Alarm 306 Servo Overheating FANUC Alarm  | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 32 | Alarm 306 Servo Overheating FANUC Alarm  | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 33 | High Oil Temp High Oil Temperature Hydra | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 33 | High Oil Temp High Oil Temperature Hydra | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 33 | High Oil Temp High Oil Temperature Hydra | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 34 | Low Oil Level Low Oil Level Hydraulic lo | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 34 | Low Oil Level Low Oil Level Hydraulic lo | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 34 | Low Oil Level Low Oil Level Hydraulic lo | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 35 | High Vibration High Vibration Alarm Moto | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 35 | High Vibration High Vibration Alarm Moto | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 35 | High Vibration High Vibration Alarm Moto | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 36 | Bearing Temp High Bearing Temperature Hi | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 36 | Bearing Temp High Bearing Temperature Hi | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 36 | Bearing Temp High Bearing Temperature Hi | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 37 | High Discharge Temp High Discharge Tempe | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 37 | High Discharge Temp High Discharge Tempe | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 37 | High Discharge Temp High Discharge Tempe | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 38 | High Current Motor High Current Air comp | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 38 | High Current Motor High Current Air comp | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 38 | High Current Motor High Current Air comp | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 39 | Low Oil Pressure Low Oil Pressure Air co | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 39 | Low Oil Pressure Low Oil Pressure Air co | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 39 | Low Oil Pressure Low Oil Pressure Air co | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 40 | Belt Slip Belt Slip Detected Conveyor be | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 40 | Belt Slip Belt Slip Detected Conveyor be | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 40 | Belt Slip Belt Slip Detected Conveyor be | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 41 | Belt Misalignment Belt Tracking / Misali | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 41 | Belt Misalignment Belt Tracking / Misali | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 41 | Belt Misalignment Belt Tracking / Misali | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 42 | Low Air Pressure Low Air Pressure Pneuma | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 42 | Low Air Pressure Low Air Pressure Pneuma | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 42 | Low Air Pressure Low Air Pressure Pneuma | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 43 | Cavitation Cavitation Detected Pump cavi | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 43 | Cavitation Cavitation Detected Pump cavi | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 43 | Cavitation Cavitation Detected Pump cavi | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 44 | Seal Leak Mechanical Seal Leak Pump mech | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 44 | Seal Leak Mechanical Seal Leak Pump mech | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 44 | Seal Leak Mechanical Seal Leak Pump mech | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 45 | Low Water Cutoff Low Water Cutoff Boiler | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 45 | Low Water Cutoff Low Water Cutoff Boiler | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 45 | Low Water Cutoff Low Water Cutoff Boiler | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 47 | Ground Fault Trip Ground Fault Relay Tri | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 47 | Ground Fault Trip Ground Fault Relay Tri | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 47 | Ground Fault Trip Ground Fault Relay Tri | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 48 | Wire Feed Fault Wire Feed Jam / Birdnest | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 48 | Wire Feed Fault Wire Feed Jam / Birdnest | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 48 | Wire Feed Fault Wire Feed Jam / Birdnest | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 49 | No Label Detected No Label Detected Labe | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 49 | No Label Detected No Label Detected Labe | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 49 | No Label Detected No Label Detected Labe | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog-fault-codes__desktop | 50 | AI Out of Range Analog Input Out of Rang | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog-fault-codes__desktop | 50 | AI Out of Range Analog Input Out of Rang | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog-fault-codes__desktop | 50 | AI Out of Range Analog Input Out of Rang | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__desktop | 15 | W PRODUCT 5 min read What Is CMMS? A Sim | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__desktop | 15 | W PRODUCT 5 min read What Is CMMS? A Sim | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__desktop | 21 | Privacy | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog__desktop | 22 | Terms | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog__desktop | 23 | Open Mira chat | button | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__desktop | 23 | Open Mira chat | button | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog__desktop | 23 | Open Mira chat | button | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 2 | CMMS | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-blog__mobile | 3 | Pricing | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-blog__mobile | 4 | Blog | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-blog__mobile | 5 | Limitations | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-blog__mobile | 6 | Security | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-blog__mobile | 11 | 5 GUIDES 6 min read 5 Most Common Allen- | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 11 | 5 GUIDES 6 min read 5 Most Common Allen- | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 12 | 4 FUNDAMENTALS 7 min read Understanding  | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 12 | 4 FUNDAMENTALS 7 min read Understanding  | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 13 | 10 GUIDES 5 min read VFD Troubleshooting | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 13 | 10 GUIDES 5 min read VFD Troubleshooting | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 14 | C TROUBLESHOOTING 6 min read Why Your Ai | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 14 | C TROUBLESHOOTING 6 min read Why Your Ai | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 15 | W PRODUCT 5 min read What Is CMMS? A Sim | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 15 | W PRODUCT 5 min read What Is CMMS? A Sim | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 16 | Equipment Fault Code Library  50 free tr | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 16 | Equipment Fault Code Library  50 free tr | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 17 | Try free | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 17 | Try free | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 18 | FactoryLM | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 18 | FactoryLM | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 19 | Limitations | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 19 | Limitations | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 20 | Trust | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 20 | Trust | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 21 | Privacy | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 21 | Privacy | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 22 | Terms | a | console:error: Failed to load resource: the server responded with a status of 404 (Not Found) |
| apex-blog__mobile | 22 | Terms | a | console:error: Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME  |
| apex-blog__mobile | 22 | Terms | a | net:404 POST https://factorylm.com/api/mira/session |
| apex-blog__mobile | 22 | Terms | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-cmms__mobile | 6 | Security | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-cmms__mobile | 7 | Sign in | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-cmms__mobile | 9 | Limitations | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-cmms__mobile | 10 | Trust | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-cmms__mobile | 11 | Privacy | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-cmms__mobile | 12 | Terms | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-cmms__mobile | 13 | ☀ Sun-readable | button | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-home__mobile | 6 | Security | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-home__mobile | 7 | Sign in | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-home__mobile | 24 | See pricing | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-home__mobile | 25 | Limitations | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-home__mobile | 26 | Trust | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-home__mobile | 27 | Privacy | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-home__mobile | 28 | Terms | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-home__mobile | 29 | ☀ Sun-readable | button | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-pricing__desktop | 1 | Skip to main content | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-pricing__desktop | 9 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| apex-pricing__desktop | 9 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| apex-pricing__desktop | 10 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| apex-pricing__desktop | 10 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| apex-pricing__mobile | 1 | Skip to main content | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-pricing__mobile | 3 | CMMS | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-pricing__mobile | 4 | Pricing | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-pricing__mobile | 5 | Blog | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-pricing__mobile | 6 | Limitations | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-pricing__mobile | 7 | Security | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| apex-pricing__mobile | 9 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| apex-pricing__mobile | 9 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| apex-pricing__mobile | 10 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| apex-pricing__mobile | 10 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| apex-pricing__mobile | 10 | Start Free Trial | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| app-activated__desktop | 2 | px-4 h-11 rounded-md font-medium text-wh | button | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-activated__desktop | 2 | px-4 h-11 rounded-md font-medium text-wh | button | note:element-disappeared-before-click |
| app-pricing__desktop | 1 | Skip to main content | a | note:click-error: TimeoutError: elementHandle.click: Timeout 5000ms exceeded. Call log: [2m  - attempting click actio |
| app-pricing__desktop | 2 | FactoryLM | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 3 | CMMS | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 4 | Pricing | a | console:pageerror: SyntaxError: Unexpected token '<' |
| app-pricing__desktop | 5 | Blog | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 6 | Limitations | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 7 | Security | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 8 | Sign in | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 9 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| app-pricing__desktop | 9 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| app-pricing__desktop | 9 | Start Free Trial | a | console:error: Failed to load resource: net::ERR_CONNECTION_RESET |
| app-pricing__desktop | 9 | Start Free Trial | a | console:error: Failed to load resource: net::ERR_CONNECTION_RESET |
| app-pricing__desktop | 9 | Start Free Trial | a | console:error: Failed to load resource: net::ERR_CONNECTION_RESET |
| app-pricing__desktop | 9 | Start Free Trial | a | console:error: Failed to load resource: net::ERR_CONNECTION_RESET |
| app-pricing__desktop | 9 | Start Free Trial | a | console:error: Error: Loading CSS chunk 50452 failed. (https://js.stripe.com/v3/fingerprinted/css/checkout-app-init-b8cbfa0da0afae2dfcaba51e453e3c15.css)     at a.onerror.a.on |
| app-pricing__desktop | 9 | Start Free Trial | a | console:pageerror: Error: Loading CSS chunk 50452 failed. (https://js.stripe.com/v3/fingerprinted/css/checkout-app-init-b8cbfa0da0afae2dfcaba51e453e3c15.css) |
| app-pricing__desktop | 10 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| app-pricing__desktop | 10 | Start Free Trial | a | console:warning: <link rel=preload> uses an unsupported `as` value |
| app-pricing__desktop | 17 | FactoryLM | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 18 | Limitations | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 19 | Trust | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 20 | Privacy | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-pricing__desktop | 21 | Terms | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-root__desktop | 2 | px-4 h-11 rounded-md font-medium text-wh | button | note:element-disappeared-before-click |
| app-root__desktop | 3 | Sign in with password | button | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-root__desktop | 3 | Sign in with password | button | note:element-disappeared-before-click |
| app-sample__desktop | 1 | FactoryLM | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 2 | CMMS | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 3 | Pricing | a | console:pageerror: SyntaxError: Unexpected token '<' |
| app-sample__desktop | 4 | Blog | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 5 | Limitations | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 6 | Security | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 7 | Sign in | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 8 | Upload your first manual | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 9 | Back to home | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 10 | Limitations | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 11 | Trust | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 12 | Privacy | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |
| app-sample__desktop | 13 | Terms | a | console:error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block |

## Persistent baseline noise

- Persistent SVG `<rect>` warning fires on 17 interactions (suppressed in broken table). Root cause: an SVG element has `rx="0 0 12 12"` instead of a valid length value. **Likely the SAFETY badge / step icon on home — bug introduced when the dark-theme cartoon hero shipped.**

## Totals

- Pages crawled: 17
- Total clickables enumerated: 335
- Total interactions run: 317
- Pages with at least one broken interaction (excl. SVG warning): 12
- Broken-interaction records: 112
