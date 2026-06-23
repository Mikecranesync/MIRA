# MQTT/UNS round trip

- topic: `enterprise/proveit/bench/conv_simple/conveyor/events`
- delivered: 1
- MQTT card == offline card: **True**

```json
{"abnormal": {"conv_run": "FALSE (stopped)", "di05_photoeye": "BLOCKED (TRUE)", "vfd_motor_rpm": "0"}, "asset_uns": "enterprise.proveit.bench.conv_simple.conveyor", "healthy": {"vfd_dc_bus_v": "~320 V (nominal)", "vfd_fault_code": "0 (no GS10 fault)"}, "scenario_id": "photoeye_blocked", "symptom": "conveyor_stopped"}
```
