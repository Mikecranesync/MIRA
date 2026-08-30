# Arena fixtures

Photos are **captured, never generated**: the point of the corpus is arbitrary real-world
input. Nothing is committed here yet; each `needs_capture` case names the file it expects.
Commit only photos you own; no faces, no customer nameplates with serials you cannot share.
Keep each under 2 MB (`jpg`/`png`/`webp`).

| File | Case | What to photograph |
|---|---|---|
| `industrial/hall-sensor-cable-abrasion.jpg` | gi-ind-speed-sensor-cable | a speed/Hall sensor cable rubbed against a frame edge |
| `industrial/motor-nameplate.jpg` | gi-ind-motor-nameplate | any three-phase motor nameplate |
| `industrial/plc-fault-screen.jpg` | gi-ind-plc-fault | an HMI/PLC fault banner |
| `industrial/vfd-display.jpg` | gi-ind-vfd-display | a VFD keypad showing a code (e.g. GS10 `oC`) |
| `industrial/hydraulic-valve.jpg` | gi-ind-hydraulic-valve | a directional valve with coil/plug visible |
| `industrial/contactor.jpg` | gi-ind-contactor | a contactor/relay with pitted or discoloured contacts |
| `industrial/bearing-race.jpg` | gi-ind-bearing | a bearing race with spalling/brinelling |
| `industrial/gearbox-leak.jpg` | gi-ind-gearbox-leak | oil weep at a gearbox seal |
| `industrial/unknown-pcb.jpg` | gi-ind-unknown-pcb | an industrial control PCB |
| `industrial/weld-defect.jpg` | gi-ind-weld | a weld with porosity/undercut |
| `household/mower-carburetor.jpg` | gi-home-mower | a small-engine carburetor |
| `household/fridge-compressor.jpg` | gi-home-fridge | a refrigerator compressor + start relay |
| `household/plumbing-fitting.jpg` | gi-home-plumbing | a compression/push-fit fitting |
| `household/stripped-bolt.jpg` | gi-home-stripped-bolt | a rounded/stripped fastener head |
| `electronics/solder-joint.jpg` | gi-elec-solder | a cracked or cold solder joint |
| `electronics/psu-board.jpg` | gi-elec-psu | a switch-mode PSU board (bulged caps welcome) |
| `electronics/unknown-connector.jpg` | gi-elec-connector | an automotive/industrial connector |
| `nonmaint/beetle.jpg` | gi-world-beetle | any beetle |
| `nonmaint/leaf-spots.jpg` | gi-world-plant | a leaf with spots/blight |
| `nonmaint/rock.jpg` | gi-world-rock | a rock/mineral sample |
| `maker/first-layer.jpg` | gi-maker-first-layer | a bad 3D-print first layer |
| `maker/broken-print.jpg` | gi-maker-broken-part | a snapped printed part along layer lines |

`private_data` cases reference fixtures under `private/` that are **synthetic** and
tenant-scoped (a disposable notebook + seeded window created through the real
application routes by the runner, never SQL). None are committed in GI-1; GI-2 adds them.
