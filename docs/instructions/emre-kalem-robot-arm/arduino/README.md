# Arduino Sketches

Use Arduino IDE 2.x or Arduino Cloud Editor with board set to **Arduino Uno**.
The standard Arduino `Servo` library is bundled with the IDE.

## Upload order

1. Open `emre_kalem_arm_calibrate/emre_kalem_arm_calibrate.ino`.
2. Upload it to the Uno.
3. Open Serial Monitor at `115200` baud.
4. Center and test each servo one at a time.
5. Open `emre_kalem_arm_uno_controller/emre_kalem_arm_uno_controller.ino`.
6. Upload it after mechanical centers and first-pass limits are known.

## Main controller serial commands

- `help` - show commands.
- `status` - print current logical joint angles.
- `home` - move all joints slowly to the configured home pose.
- `detach` - stop sending servo pulses. The arm may sag under gravity.
- `attach` - reattach servos and write current setpoints.
- `b+` / `b-` - base nudge.
- `a+` / `a-` - shoulder / Arm A nudge.
- `e+` / `e-` - elbow / Arm B nudge.
- `p+` / `p-` - wrist pitch nudge.
- `r+` / `r-` - wrist roll nudge.
- `g+` / `g-` - gripper nudge.
- `set base 90` - set a named joint to an angle.
- `speed 25` - set move delay in milliseconds per degree.
- `step 2` - set serial nudge size in degrees.
- `demo` - plays conveyor waypoints only after `ALLOW_DEMO_PROGRAM` is changed
  to `true` in the sketch.

## Pin map

The main sketch follows Emre's original Arduino sketch pin map:

- D3 - base
- D4 - Arm A left
- D5 - Arm A right, mirrored in code
- D6 - Arm B
- D9 - wrist A
- D10 - wrist B
- D11 - gripper

It keeps D0 and D1 free for the USB serial connection. If you wire a different
signal map, update `SERVO_PINS` in both sketches before uploading.
