# Emre Kalem Robot Arm Wiring Package

This package is for the 6-axis Emre Kalem "Robotic Arm with Servo & Arduino"
build using an Arduino Uno, 4 MG995/MG996R 180-degree servos, 3 MG90S
180-degree servos, and a separate 5V 10A servo power supply.

## Start here when you wake up

1. Print or open the PDF:
   `docs/instructions/emre-kalem-robot-arm/emre-kalem-robot-arm-wiring-and-programming-guide.pdf`
2. Put the arm at the mechanical home pose before applying servo power.
3. Wire only the power bus first:
   external 5V supply positive -> rocker switch/fuse -> servo red bus;
   external 5V supply negative -> servo ground bus.
4. Connect Arduino GND to the servo ground bus. Do not connect the external
   5V servo rail to the Uno 5V pin while the Uno is on USB.
5. Upload the calibration sketch and test one servo channel at a time.
6. Upload the main controller sketch and use Serial Monitor at 115200 baud.
7. Leave conveyor load/unload playback locked until each joint limit has been
   calibrated on your physical print.

## Files

- `wiring-map.csv` - servo-by-servo wiring table.
- `conveyor-waypoints-template.csv` - worksheet for the second arm's
  conveyor pick/place cycle.
- `arduino/emre_kalem_arm_calibrate/emre_kalem_arm_calibrate.ino` - one-servo
  calibration and horn-centering sketch.
- `arduino/emre_kalem_arm_uno_controller/emre_kalem_arm_uno_controller.ino` -
  main manual-control and waypoint-playback sketch.
- `arduino/README.md` - upload and serial-command notes.
- `emre-kalem-robot-arm-wiring-and-programming-guide.pdf` - printable bench
  guide tracked in the package for fast GitHub access.
- `tools/emre-kalem-arm-guide-pdf.py` - generator for the printable PDF.

## Default Uno signal map

This package follows Emre's original Arduino pin map:

- D3 - base
- D4 - Arm A left
- D5 - Arm A right, mirrored in code
- D6 - Arm B
- D9 - wrist A
- D10 - wrist B
- D11 - gripper

If you prefer a contiguous D2-D8 signal strip, that also works electrically,
but update `SERVO_PINS` in both sketches and mark the change on the wiring
table before powering the arm.

## Morning order of operations

Do the job in this order. It prevents most of the usual servo drama.

1. Mechanical check:
   - Arm moves by hand with power off.
   - No links bind.
   - Servo horns are not tightened yet unless already centered.
   - Wires can flex without pulling on servo sockets.

2. Power check:
   - 5V supply adjusted to 5.0V before connecting servos.
   - Rocker switch interrupts only the servo positive rail.
   - Servo ground and Arduino ground are common.
   - No servo red wire is connected to the Uno 5V pin.

3. Calibration:
   - Upload `emre_kalem_arm_calibrate.ino`.
   - Select one channel, attach it, center it at 90, then install/tighten the
     horn in the closest mechanical home position.
   - Repeat for all seven physical servos.

4. Manual control:
   - Upload `emre_kalem_arm_uno_controller.ino`.
   - Open Serial Monitor at 115200 baud.
   - Use `help`, `status`, `home`, and the small nudges (`b+`, `b-`, `a+`,
     `a-`, `e+`, `e-`, `p+`, `p-`, `r+`, `r-`, `g+`, `g-`).

5. Conveyor arm later:
   - Fill `conveyor-waypoints-template.csv` after manual jogging proves the
     pickup and drop poses.
   - Copy those angles into the demo waypoint array.
   - Only then change `ALLOW_DEMO_PROGRAM` from `false` to `true`.
