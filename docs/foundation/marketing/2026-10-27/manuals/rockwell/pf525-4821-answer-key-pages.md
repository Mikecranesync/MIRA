# PF525 answer-key pages — MIRA issue #4821 (overload answer, 72/100)

Source: 520-UM001O-EN-E, PowerFlex 520-series User Manual, edition O, Sept 2025 (local: 520-um001.pdf, sha256 b9445a63c7886503…, 274 pp).
Page mapping: the printed page number is the same as the PDF page number in this edition (checked from the page footers with pdftotext -layout).

## (a) Motor nameplate entry (P031–P036) and P040 Autotune
| Item | Quote | PDF / printed |
|---|---|---|
| Startup steps 13–14 | "13. Configure the basic program parameters that are related to the motor… 14. Complete the autotune procedure for the drive. See parameter P040 [Autotune]" | 60 / 60 |
| Fan/pump note | "For improved motor and drive performance, tune the motor in SVC mode using parameter P040 [Autotune]." | 61 / 61 |
| Smart Startup table (P031–P036 ranges and defaults; P036 "Sets the rated nameplate rpm of motor", default 1750 rpm) | — | 65 / 65 |
| P031 | "Stop drive before changing this parameter. Sets the motor nameplate rated volts." | 84 / 84 |
| P033 | "Sets the motor nameplate overload current. Used to determine motor overload conditions and can be set from 0.1 A to 200% of drive rated current." | 84 / 84 |
| P034 | "Sets the motor nameplate FLA. Used to assist the Autotune routine and motor control." | 85 / 85 |
| P040 prerequisite | "IMPORTANT: All motor parameters in the Basic Program group must be set before running the routine. If a start command is not given … within 30 s … an Autotune Fault occurs." | 86 / 86 |
| Troubleshooting: re-enter data | Cause "Motor data was incorrectly entered" → "Correctly enter motor nameplate data into P031, P032 and P033." | 165 / 165 |
| Troubleshooting: torque mismatch | "Set motor nameplate full load amps in parameter P034 [Motor NP FLA]. Perform P040 [Autotune] 'Static Tune' or 'Rotate Tune' procedure." | 165 / 165 |

## (b) Autotune cautions (catalog-only: quoted here, not coached)
| Item | Quote | PDF / printed |
|---|---|---|
| ATTENTION | "Rotation of the motor in an undesired direction can occur during this procedure. To guard against possible injury and/or equipment damage, it is recommended that the motor be disconnected from the load before proceeding." | 86 / 86 |
| Static vs dynamic | "Enables a static (not spinning) or dynamic (motor spinning) autotune… A failure (such as if a motor is not connected) results in an Autotune Fault. It is recommended to perform a full rotate tune when using VVC mode." | 86 / 86 |
| 1 "Static Tune" | "non-rotational motor stator resistance test… Used when motor cannot be uncoupled from the load." | 86 / 86 |
| 2 "Rotate Tune" | "Important: Used when motor is uncoupled from the load. Results may not be valid if a load is coupled to the motor during this procedure." | 86 / 86 |
| P031/P040 | "Stop drive before changing this parameter." | 84, 86 |
| PM motor flowchart | "Make sure that the motor leaves the load during auto-tuning" | 266 / 266 |

## (c) Overload faults
| Item | Quote | PDF / printed |
|---|---|---|
| F007 Motor Overload (type 1) | "Internal electronic overload trip." Action: "An excessive motor load exists. Reduce load so drive output current does not exceed the current set by parameter P033 [Motor OL Current]. Verify A530 [Boost Select] setting." | 161 / 161 |
| P033 IMPORTANT (the link to the nameplate) | "The drive will fault on an F007 'Motor Overload' if the value of this parameter is exceeded based on class 10 motor overload protection according to NEC article 430…" | 84 / 84 |
| A493 Motor OL Select | "Drive provides Class 10 overload protection. Settings 0…2 select the derating factor for the I2t overload function." (Related: P032, P033) | 126 / 126 |
| F064 Drive Overload (type 2) | "Drive overload rating has been exceeded." Action: "Reduce load or extend Accel Time." | 162 / 162 |

## What the manual does not say
- It never says, in so many words, to re-enter the nameplate or redo autotune after a motor swap or an F007. The nearest text is the troubleshooting rows on p.165 and startup steps 13–14 on p.60. Treat "re-enter after motor change" as an inference.
- F064 is not tied to nameplate data. It relates to the drive's own rating, not to P033.
- There is no explicit rule for whether P033 should equal the FLA or the FLA × service factor. P033 is described only as "nameplate overload current".
- The manual gives no autotune duration and no list of required P039 modes beyond "VVC → full rotate tune".
