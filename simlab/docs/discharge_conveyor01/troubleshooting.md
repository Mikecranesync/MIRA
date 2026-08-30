# Discharge Conveyor 01 Troubleshooting

## Photoeye Blocked During Discharge

Condition: `photoeye_blocked = TRUE` while `discharge_request = TRUE`.

Likely causes:

- Package or pallet still blocks the discharge photoeye.
- Palletizer cannot accept the next case or pallet.
- Photoeye lens is dirty, misaligned, or seeing a stationary package.
- Local Micro820 safety permissive or stop circuit is not ready.

Required checks:

1. Verify the package or pallet was physically removed from the discharge conveyor.
2. Check the discharge photoeye and clear the beam.
3. Confirm the Micro820 local E-stop, local stop, and photoeye logic are healthy.
4. Wait for more than 30 seconds of clear photoeye before allowing the next discharge.

Do not bypass the local Micro820 control logic. SimLab may model the request, but the real garage conveyor remains the control authority.
