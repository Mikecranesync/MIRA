# Frozen question — AR find-one 2026-09-08

**Mission:** `AR-2026-09-08-ROCKWELL-OMRON-DEVICENET-AO`
**Platform:** MrPLC
**URL:** https://mrplc.com/forums/topic/45896-rockwell-1756-l81e-%E2%86%94-omron-drt1-com-via-1756-dnb-%E2%80%93-analog-io-scaling-issue/
**Author:** Mehakk
**Posted:** 2026-09-08T03:49:17Z (~10 hours at freeze)
**Community answers inspected:** NO
**Answer researched:** NO

## Equipment
Rockwell 1756-L81E + 1756-DNB ↔ Omron DRT1-COM with GT1-ID16 / GT1-OD16 / GT1-AD04 / GT1-DA04

## Original problem
Digital Omron DeviceNet I/O works under Rockwell 1756-DNB; GT1-DA04 shows commanded values in Studio 5000 but no physical 4–20 mA. Needs RSNetWorx byte sizes, word mapping, raw scaling, and enable config for GT1-DA04.

## Technician version
I'm talking Rockwell 1756-L81E ControlLogix to an Omron DRT1-COM RTU through a 1756-DNB DeviceNet scanner. Digital GT1-ID16 and GT1-OD16 work. On GT1-DA04 analog output, Studio 5000 raw values change when I command them, but a meter shows no 4-20 mA on the physical output. GT1-AD04 is also in the rack. What RSNetWorx I/O byte sizes should I use for the DRT1-COM, how do GT1-AD04/GT1-DA04 words map through it, and what raw range/scaling is correct for GT1-DA04 4-20 mA? Any config needed to enable the physical AO?
