# Asset map (unified UNS namespace)

| key | UNS | MQTT topic | layer | mode | supervised | 24/7 | model |
|---|---|---|---|---|---|---|---|
| tank01 | `enterprise.proveit.bottling.plant1.liquid_processing.tank01` | `enterprise/proveit/bottling/plant1/liquid_processing/tank01/events` | simulated | simulated | False | True | SIMULATED |
| mixer01 | `enterprise.proveit.bottling.plant1.liquid_processing.mixer01` | `enterprise/proveit/bottling/plant1/liquid_processing/mixer01/events` | simulated | simulated | False | True | SIMULATED |
| filler01 | `enterprise.proveit.bottling.plant1.filling.filler01` | `enterprise/proveit/bottling/plant1/filling/filler01/events` | simulated | simulated | False | True | SIMULATED |
| capper01 | `enterprise.proveit.bottling.plant1.filling.capper01` | `enterprise/proveit/bottling/plant1/filling/capper01/events` | simulated | simulated | False | True | SIMULATED |
| labeler01 | `enterprise.proveit.bottling.plant1.packaging.labeler01` | `enterprise/proveit/bottling/plant1/packaging/labeler01/events` | simulated | simulated | False | True | SIMULATED |
| casepacker01 | `enterprise.proveit.bottling.plant1.packaging.casepacker01` | `enterprise/proveit/bottling/plant1/packaging/casepacker01/events` | simulated | simulated | False | True | SIMULATED |
| conv_simple | `enterprise.proveit.bottling.plant1.packaging.conv_simple` | `enterprise/proveit/bottling/plant1/packaging/conv_simple/events` | live | live_supervised_bench | True | False | CONV_SIMPLE_BENCH |
| conv_simple.conveyor | `enterprise.proveit.bottling.plant1.packaging.conv_simple.conveyor` | `enterprise/proveit/bottling/plant1/packaging/conv_simple/conveyor/events` | live | live_supervised_bench | True | False | Conv_Simple (Factory I/O + bench) |
| conv_simple.gs10_vfd | `enterprise.proveit.bottling.plant1.packaging.conv_simple.gs10_vfd` | `enterprise/proveit/bottling/plant1/packaging/conv_simple/gs10_vfd/events` | live | live_supervised_bench | True | False | AutomationDirect DURApulse GS10 |
| conv_simple.micro820_plc | `enterprise.proveit.bottling.plant1.packaging.conv_simple.micro820_plc` | `enterprise/proveit/bottling/plant1/packaging/conv_simple/micro820_plc/events` | live | live_supervised_bench | True | False | Allen-Bradley Micro820 2080-LC20-20QBB |
| conv_simple.photoeye_pe101 | `enterprise.proveit.bottling.plant1.packaging.conv_simple.photoeye_pe101` | `enterprise/proveit/bottling/plant1/packaging/conv_simple/photoeye_pe101/events` | live | live_supervised_bench | True | False | UNKNOWN_MODEL |
| conv_simple.conveyor_motor | `enterprise.proveit.bottling.plant1.packaging.conv_simple.conveyor_motor` | `enterprise/proveit/bottling/plant1/packaging/conv_simple/conveyor_motor/events` | live | live_supervised_bench | True | False | UNKNOWN_MODEL |
