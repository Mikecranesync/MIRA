/*
  Emre Kalem 6-axis robot arm - Arduino Uno controller

  This sketch gives you:
  - Serial keyboard jogging for the built arm.
  - Shared logical shoulder joint with two mirrored physical servos.
  - Conservative per-joint software limits.
  - Optional conveyor load/unload waypoint playback after calibration.

  Wiring:
  - Servo signal wires: D3, D4, D5, D6, D9, D10, D11.
  - Servo red wires: external switched 5V supply.
  - Servo brown/black wires: external supply ground.
  - Arduino GND: tied to the servo ground bus.
  - Do not power the servo red wires from the Arduino 5V pin.
*/

#include <Servo.h>

const long SERIAL_BAUD = 115200;
const byte JOINT_COUNT = 6;
const byte SERVO_COUNT = 7;

// Keep demo playback locked until you have calibrated physical limits and
// replaced the placeholder waypoint angles with verified safe poses.
const bool ALLOW_DEMO_PROGRAM = false;

// Default motion settings. You can change these over serial with "speed N"
// and "step N".
int moveDelayMs = 20;
int nudgeStepDeg = 2;

enum JointId {
  BASE = 0,
  ARM_A = 1,
  ARM_B = 2,
  WRIST_A = 3,
  WRIST_B = 4,
  GRIPPER = 5
};

const char* JOINT_ID[JOINT_COUNT] = {
  "base", "arm_a", "arm_b", "wrist_a", "wrist_b", "gripper"
};

const char* JOINT_LABEL[JOINT_COUNT] = {
  "Base rotation",
  "Shoulder / Arm A",
  "Elbow / Arm B",
  "Wrist pitch",
  "Wrist roll",
  "Gripper"
};

// First-pass logical limits. These are intentionally conservative. Tune these
// for your printed parts before running automatic waypoints.
int jointMin[JOINT_COUNT] = {10, 45, 30, 25, 10, 35};
int jointHome[JOINT_COUNT] = {90, 90, 90, 90, 90, 70};
int jointMax[JOINT_COUNT] = {170, 135, 150, 155, 170, 110};
int jointCurrent[JOINT_COUNT] = {90, 90, 90, 90, 90, 70};

Servo servos[SERVO_COUNT];

const byte SERVO_PINS[SERVO_COUNT] = {3, 4, 5, 6, 9, 10, 11};
const byte SERVO_TO_JOINT[SERVO_COUNT] = {
  BASE, ARM_A, ARM_A, ARM_B, WRIST_A, WRIST_B, GRIPPER
};

// arm_a_right is mirrored because the shoulder uses two opposed servos.
// If your physical build moves the wrong way, flip the matching true/false.
const bool SERVO_MIRRORED[SERVO_COUNT] = {
  false, false, true, false, false, false, false
};

// Fine mechanical trim after horns are installed. Positive values add degrees
// to the physical servo command after mirroring.
int servoTrim[SERVO_COUNT] = {0, 0, 0, 0, 0, 0, 0};

const char* SERVO_LABEL[SERVO_COUNT] = {
  "base MG996R",
  "arm_a_left MG996R",
  "arm_a_right MG996R mirrored",
  "arm_b MG996R",
  "wrist_a MG90S",
  "wrist_b MG90S",
  "gripper MG90S"
};

// Placeholder conveyor cycle. Replace these with angles from
// conveyor-waypoints-template.csv before unlocking ALLOW_DEMO_PROGRAM.
const byte WAYPOINT_COUNT = 9;
const int WAYPOINTS[WAYPOINT_COUNT][JOINT_COUNT] = {
  {90, 90, 90, 90, 90, 70},  // home
  {75, 92, 105, 92, 90, 90}, // pre_pick
  {75, 112, 125, 88, 90, 90},// pick
  {75, 112, 125, 88, 90, 55},// grip
  {75, 82, 105, 92, 90, 55}, // lift
  {118, 82, 105, 92, 90, 55},// pre_drop
  {118, 108, 128, 88, 90, 55},// drop
  {118, 108, 128, 88, 90, 95},// release
  {90, 90, 90, 90, 90, 70}   // retreat/home
};

const unsigned long WAYPOINT_MS[WAYPOINT_COUNT] = {
  1500, 1500, 1500, 700, 1400, 1800, 1500, 800, 1800
};

int clampInt(int value, int low, int high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

int physicalAngleForServo(byte servoIndex) {
  byte joint = SERVO_TO_JOINT[servoIndex];
  int logical = jointCurrent[joint];
  int physical = SERVO_MIRRORED[servoIndex] ? 180 - logical : logical;
  physical += servoTrim[servoIndex];
  return clampInt(physical, 0, 180);
}

void writeAllServos() {
  for (byte i = 0; i < SERVO_COUNT; i++) {
    servos[i].write(physicalAngleForServo(i));
  }
}

void writeJoint(byte joint, int angle) {
  jointCurrent[joint] = clampInt(angle, jointMin[joint], jointMax[joint]);
  writeAllServos();
}

void moveJointTo(byte joint, int target) {
  target = clampInt(target, jointMin[joint], jointMax[joint]);
  while (jointCurrent[joint] != target) {
    int direction = target > jointCurrent[joint] ? 1 : -1;
    jointCurrent[joint] += direction;
    writeAllServos();
    delay(moveDelayMs);
  }
}

void moveAllTo(const int targetPose[JOINT_COUNT], unsigned long durationMs) {
  int start[JOINT_COUNT];
  int target[JOINT_COUNT];
  for (byte j = 0; j < JOINT_COUNT; j++) {
    start[j] = jointCurrent[j];
    target[j] = clampInt(targetPose[j], jointMin[j], jointMax[j]);
  }

  int steps = durationMs / 20;
  if (steps < 1) steps = 1;

  for (int s = 1; s <= steps; s++) {
    for (byte j = 0; j < JOINT_COUNT; j++) {
      long delta = (long)(target[j] - start[j]) * s;
      jointCurrent[j] = start[j] + (int)(delta / steps);
    }
    writeAllServos();
    delay(20);
  }

  for (byte j = 0; j < JOINT_COUNT; j++) {
    jointCurrent[j] = target[j];
  }
  writeAllServos();
}

void attachAllServos() {
  for (byte i = 0; i < SERVO_COUNT; i++) {
    if (!servos[i].attached()) {
      servos[i].attach(SERVO_PINS[i]);
      delay(30);
    }
  }
  writeAllServos();
}

void detachAllServos() {
  for (byte i = 0; i < SERVO_COUNT; i++) {
    servos[i].detach();
  }
}

void homeArm() {
  int homePose[JOINT_COUNT];
  for (byte j = 0; j < JOINT_COUNT; j++) {
    homePose[j] = jointHome[j];
  }
  moveAllTo(homePose, 1800);
}

void printStatus() {
  Serial.println();
  Serial.println(F("Logical joints"));
  for (byte j = 0; j < JOINT_COUNT; j++) {
    Serial.print(F("  "));
    Serial.print(JOINT_ID[j]);
    Serial.print(F(" = "));
    Serial.print(jointCurrent[j]);
    Serial.print(F("  limits "));
    Serial.print(jointMin[j]);
    Serial.print(F("-"));
    Serial.print(jointMax[j]);
    Serial.print(F("  home "));
    Serial.println(jointHome[j]);
  }

  Serial.println(F("Physical servos"));
  for (byte i = 0; i < SERVO_COUNT; i++) {
    Serial.print(F("  D"));
    Serial.print(SERVO_PINS[i]);
    Serial.print(F(" "));
    Serial.print(SERVO_LABEL[i]);
    Serial.print(F(" -> "));
    Serial.print(physicalAngleForServo(i));
    Serial.print(F(" attached="));
    Serial.println(servos[i].attached() ? F("yes") : F("no"));
  }
  Serial.println();
}

byte jointFromToken(String token) {
  token.trim();
  token.toLowerCase();

  if (token == "b" || token == "base") return BASE;
  if (token == "a" || token == "arm" || token == "arm_a" || token == "shoulder") return ARM_A;
  if (token == "e" || token == "elbow" || token == "arm_b") return ARM_B;
  if (token == "p" || token == "pitch" || token == "wrist_a") return WRIST_A;
  if (token == "r" || token == "roll" || token == "wrist_b") return WRIST_B;
  if (token == "g" || token == "grip" || token == "gripper") return GRIPPER;

  return 255;
}

void printHelp() {
  Serial.println();
  Serial.println(F("Emre Kalem arm Uno controller"));
  Serial.println(F("Serial Monitor: 115200 baud. Newline or no-line-ending both work."));
  Serial.println(F("Commands:"));
  Serial.println(F("  help, status, home, attach, detach"));
  Serial.println(F("  b+ b-   base"));
  Serial.println(F("  a+ a-   shoulder / Arm A"));
  Serial.println(F("  e+ e-   elbow / Arm B"));
  Serial.println(F("  p+ p-   wrist pitch"));
  Serial.println(F("  r+ r-   wrist roll"));
  Serial.println(F("  g+ g-   gripper"));
  Serial.println(F("  set base 90"));
  Serial.println(F("  speed 25     milliseconds per degree for manual moves"));
  Serial.println(F("  step 2       serial nudge size in degrees"));
  Serial.println(F("  demo         locked until ALLOW_DEMO_PROGRAM is true"));
  Serial.println(F("Power reminder: servo red wires are external 5V. Arduino GND shares servo ground."));
  Serial.println();
}

void playDemo() {
  if (!ALLOW_DEMO_PROGRAM) {
    Serial.println(F("Demo is locked. Calibrate limits, replace waypoint angles, then set ALLOW_DEMO_PROGRAM=true."));
    return;
  }

  Serial.println(F("Playing conveyor waypoint program."));
  for (byte w = 0; w < WAYPOINT_COUNT; w++) {
    Serial.print(F("Waypoint "));
    Serial.println(w);
    moveAllTo(WAYPOINTS[w], WAYPOINT_MS[w]);
  }
  Serial.println(F("Demo complete."));
}

void handleLine(String line) {
  line.trim();
  line.toLowerCase();
  if (line.length() == 0) return;

  if (line == "help" || line == "?") {
    printHelp();
    return;
  }
  if (line == "status" || line == "p") {
    printStatus();
    return;
  }
  if (line == "home" || line == "h") {
    Serial.println(F("Moving home."));
    homeArm();
    printStatus();
    return;
  }
  if (line == "attach") {
    attachAllServos();
    Serial.println(F("Attached all servos."));
    return;
  }
  if (line == "detach") {
    detachAllServos();
    Serial.println(F("Detached all servos. Arm may sag under gravity."));
    return;
  }
  if (line == "demo") {
    playDemo();
    return;
  }

  if (line.startsWith("speed ")) {
    int value = line.substring(6).toInt();
    moveDelayMs = clampInt(value, 5, 100);
    Serial.print(F("moveDelayMs = "));
    Serial.println(moveDelayMs);
    return;
  }

  if (line.startsWith("step ")) {
    int value = line.substring(5).toInt();
    nudgeStepDeg = clampInt(value, 1, 10);
    Serial.print(F("nudgeStepDeg = "));
    Serial.println(nudgeStepDeg);
    return;
  }

  if (line.startsWith("set ")) {
    int firstSpace = line.indexOf(' ', 4);
    if (firstSpace < 0) {
      Serial.println(F("Use: set base 90"));
      return;
    }
    String token = line.substring(4, firstSpace);
    int value = line.substring(firstSpace + 1).toInt();
    byte joint = jointFromToken(token);
    if (joint == 255) {
      Serial.println(F("Unknown joint."));
      return;
    }
    moveJointTo(joint, value);
    printStatus();
    return;
  }

  char last = line.charAt(line.length() - 1);
  if (last == '+' || last == '-') {
    String token = line.substring(0, line.length() - 1);
    byte joint = jointFromToken(token);
    if (joint == 255) {
      Serial.println(F("Unknown joint."));
      return;
    }
    int delta = (last == '+') ? nudgeStepDeg : -nudgeStepDeg;
    moveJointTo(joint, jointCurrent[joint] + delta);
    Serial.print(JOINT_ID[joint]);
    Serial.print(F(" = "));
    Serial.println(jointCurrent[joint]);
    return;
  }

  Serial.print(F("Unknown command: "));
  Serial.println(line);
  Serial.println(F("Type help for commands."));
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  while (!Serial) {
    ; // Uno continues immediately; native-USB boards may wait.
  }

  attachAllServos();
  delay(300);
  printHelp();
  printStatus();
}

void loop() {
  static String line;

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r' || c == '\n') {
      handleLine(line);
      line = "";
    } else {
      line += c;
      if (line.length() > 40) {
        handleLine(line);
        line = "";
      }
    }
  }
}
