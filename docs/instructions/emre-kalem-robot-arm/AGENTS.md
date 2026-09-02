# Agent Quick Context - Emre Kalem Robot Arm

This folder is the source-of-truth local package for the Emre Kalem 6-axis
3D-printed robot arm using an Arduino Uno.

## What To Open First

1. `README.md` - morning wiring sequence and package map.
2. `emre-kalem-robot-arm-wiring-and-programming-guide.pdf` - printable guide.
3. `wiring-map.csv` - servo signal/power/ground table.
4. `arduino/README.md` - upload and Serial Monitor command notes.
5. `arduino/emre_kalem_arm_calibrate/emre_kalem_arm_calibrate.ino` - one-servo
   calibration sketch.
6. `arduino/emre_kalem_arm_uno_controller/emre_kalem_arm_uno_controller.ino` -
   main manual-control and locked waypoint-playback sketch.

## Hardware Assumptions

- Arduino Uno.
- 4x MG995/MG996R 180-degree servos.
- 3x MG90S 180-degree servos.
- 6 logical axes, 7 physical servos.
- Shoulder / Arm A uses two opposed servos; the second is mirrored in code as
  `180 - angle`.
- External regulated 5V 10A servo supply.
- KCD1 rocker switch used as servo-power enable.
- Servo power ground and Arduino GND must be common.
- Servo red wires must not be powered from the Arduino 5V pin.

## Default Signal Map

This package follows Emre's original Arduino pin map:

- D3 - base.
- D4 - Arm A left.
- D5 - Arm A right, mirrored.
- D6 - Arm B / elbow.
- D9 - wrist A / pitch.
- D10 - wrist B / roll.
- D11 - gripper.

## Safety Defaults

- Automatic conveyor demo playback is locked in code:
  `ALLOW_DEMO_PROGRAM = false`.
- Do not unlock playback until physical limits and conveyor waypoints are
  calibrated on the actual printed arm.
- Treat the KCD1 rocker as a power enable, not a safety-rated emergency stop.
