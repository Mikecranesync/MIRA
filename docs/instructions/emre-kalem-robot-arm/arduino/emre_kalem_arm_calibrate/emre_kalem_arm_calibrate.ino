/*
  Emre Kalem 6-axis robot arm - one-servo calibration sketch

  Purpose:
  - Attach only one servo channel at a time.
  - Center the servo at 90 degrees before installing/tightening horns.
  - Nudge each channel to learn safe physical limits on your print.

  Wiring:
  - Servo signal wires: D3, D4, D5, D6, D9, D10, D11.
  - Servo red wires: external switched 5V supply.
  - Servo brown/black wires: external supply ground.
  - Arduino GND: tied to the servo ground bus.
  - Do not power the servo red wires from the Arduino 5V pin.
*/

#include <Servo.h>

const long SERIAL_BAUD = 115200;
const byte SERVO_COUNT = 7;

const byte SERVO_PINS[SERVO_COUNT] = {3, 4, 5, 6, 9, 10, 11};
const char* SERVO_LABELS[SERVO_COUNT] = {
  "0 base MG996R",
  "1 arm_a_left MG996R",
  "2 arm_a_right MG996R mirrored",
  "3 arm_b MG996R",
  "4 wrist_a MG90S",
  "5 wrist_b MG90S",
  "6 gripper MG90S"
};

Servo servos[SERVO_COUNT];
bool isAttached[SERVO_COUNT] = {false, false, false, false, false, false, false};
int servoAngle[SERVO_COUNT] = {90, 90, 90, 90, 90, 90, 90};
byte selected = 0;

int clampAngle(int value) {
  if (value < 0) return 0;
  if (value > 180) return 180;
  return value;
}

void attachSelected() {
  if (!isAttached[selected]) {
    servos[selected].attach(SERVO_PINS[selected]);
    isAttached[selected] = true;
    delay(30);
  }
  servos[selected].write(servoAngle[selected]);
  Serial.print(F("Attached "));
  Serial.print(SERVO_LABELS[selected]);
  Serial.print(F(" on D"));
  Serial.print(SERVO_PINS[selected]);
  Serial.print(F(" at "));
  Serial.println(servoAngle[selected]);
}

void detachSelected() {
  if (isAttached[selected]) {
    servos[selected].detach();
    isAttached[selected] = false;
  }
  Serial.print(F("Detached "));
  Serial.println(SERVO_LABELS[selected]);
}

void writeSelected(int nextAngle) {
  servoAngle[selected] = clampAngle(nextAngle);
  if (isAttached[selected]) {
    servos[selected].write(servoAngle[selected]);
  }
  Serial.print(SERVO_LABELS[selected]);
  Serial.print(F(" -> "));
  Serial.println(servoAngle[selected]);
}

void printStatus() {
  Serial.println();
  Serial.println(F("Servo calibration status"));
  for (byte i = 0; i < SERVO_COUNT; i++) {
    Serial.print(i);
    Serial.print(F(": D"));
    Serial.print(SERVO_PINS[i]);
    Serial.print(F(" angle="));
    Serial.print(servoAngle[i]);
    Serial.print(F(" attached="));
    Serial.print(isAttached[i] ? F("yes") : F("no"));
    Serial.print(F("  "));
    Serial.println(SERVO_LABELS[i]);
  }
  Serial.print(F("Selected: "));
  Serial.println(SERVO_LABELS[selected]);
  Serial.println();
}

void printHelp() {
  Serial.println();
  Serial.println(F("Emre Kalem arm calibration"));
  Serial.println(F("Commands:"));
  Serial.println(F("  0..6   select servo channel"));
  Serial.println(F("  a      attach selected servo and write current angle"));
  Serial.println(F("  d      detach selected servo"));
  Serial.println(F("  c      center selected servo at 90 degrees"));
  Serial.println(F("  + / -  nudge selected servo by 1 degree"));
  Serial.println(F("  ] / [  nudge selected servo by 5 degrees"));
  Serial.println(F("  p      print status"));
  Serial.println(F("  h      help"));
  Serial.println(F("Power reminder: servo red wires use external 5V. Arduino GND must share servo ground."));
  Serial.println();
  printStatus();
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  while (!Serial) {
    ; // Wait for serial on boards that need it. Uno continues immediately.
  }
  printHelp();
}

void loop() {
  if (!Serial.available()) {
    return;
  }

  char c = Serial.read();
  if (c == '\r' || c == '\n' || c == ' ') {
    return;
  }

  if (c >= '0' && c <= '6') {
    selected = c - '0';
    Serial.print(F("Selected "));
    Serial.println(SERVO_LABELS[selected]);
    return;
  }

  switch (c) {
    case 'a':
    case 'A':
      attachSelected();
      break;
    case 'd':
    case 'D':
      detachSelected();
      break;
    case 'c':
    case 'C':
      writeSelected(90);
      break;
    case '+':
      writeSelected(servoAngle[selected] + 1);
      break;
    case '-':
      writeSelected(servoAngle[selected] - 1);
      break;
    case ']':
      writeSelected(servoAngle[selected] + 5);
      break;
    case '[':
      writeSelected(servoAngle[selected] - 5);
      break;
    case 'p':
    case 'P':
      printStatus();
      break;
    case 'h':
    case 'H':
    case '?':
      printHelp();
      break;
    default:
      Serial.print(F("Unknown command: "));
      Serial.println(c);
      Serial.println(F("Type h for help."));
      break;
  }
}
