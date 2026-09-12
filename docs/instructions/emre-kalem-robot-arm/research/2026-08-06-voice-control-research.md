# Natural-Language + Voice Control of the Emre Kalem 6-Axis Arm — Research Report

**Context:** Emre Kalem 3D-printed 6-axis arm ([MakerWorld model](https://makerworld.com/en/models/1134925-robotic-arm-with-servo-arduino)) — Arduino Uno, 7 hobby servos (MG995/MG996R + MG90S gripper, shoulder doubled), standard Arduino `Servo` library, USB serial @115200 with text commands (`set gripper 40`, `b+`, `home`, `status`). Goal: "pick up the thing on the table" via voice, with one fixed webcam, driven from a Windows laptop running Claude Code.
**Date:** 2026-08-06 (deep-research agent, this repo's session be9b0a0a).

---

## 1. Voice-commanded hobby arms — prior art

### 1.1 Whisper → Python → Arduino serial (the dominant DIY shape)

The most common working architecture is exactly the one this arm already half-implements: **mic → local/API Whisper STT → keyword or LLM parse → serial text command → Arduino sketch moves servos.**

- [Awaiz-Malik/Speech-to-Text_Robot_Control_with_Whisper_and_Arduino](https://github.com/Awaiz-Malik/Speech-to-Text_Robot_Control_with_Whisper_and_Arduino) — Python `whisper` STT, wake-word ("robo"), pyttsx3 spoken feedback, Arduino Nano over serial. Works; command vocabulary hardcoded.
- [RobJMal/Audio_Arm](https://github.com/RobJMal/Audio_Arm) — minimal: listen 5 s, match a command-word list, send a byte code. The floor: speech → enum → serial.
- [HimuCodes/Voice-Control-Robot-With-Chat-GPT](https://github.com/HimuCodes/Voice-Control-Robot-With-Chat-GPT) — adds an LLM between STT and robot so free-form phrasing maps to actions. The key upgrade over keyword matching; the shape to copy.
- [JithendraHS/Robotic-Arm](https://github.com/JithendraHS/Robotic-Arm) — OpenCV + voice on a 3-DOF hobby arm; proof the combination is tractable at this scale.

### 1.2 LeRobot / SO-ARM100 / SO-101 community

[SO-ARM100/SO-101](https://github.com/TheRobotStudio/SO-ARM100) + [huggingface/lerobot](https://github.com/huggingface/lerobot) is the reference community for cheap-arm autonomy ([HF SO-101 docs](https://huggingface.co/docs/lerobot/so101)). Caveats for this project:

- LeRobot assumes **feedback servos** (Feetech STS3215 with position readback) and a leader/follower teleop pair. Voice demos there are mostly STT in front of named behaviors or a trained policy; middleware like [phospho-app/phosphobot](https://github.com/phospho-app/phosphobot) exposes an HTTP API people front with STT.
- [Seeed-Projects/reBot-DevArm](https://github.com/Seeed-Projects/reBot-DevArm) lists LeRobot + reSpeaker voice integration — closest packaged "voice + hobby arm" example.
- **Applicability to this arm: limited.** No position readback, no leader arm, no torque control — LeRobot's imitation-learning path doesn't bolt on. The transferable pattern: voice → intent → named behavior.

### 1.3 Browser Web Speech API + WebSerial

Chrome Web Speech API + [WebSerial](https://webserial.io/) can do the loop in one tab (speech → JS → `SerialPort.write("set gripper 40\n")`). Fine for demos; weaker as an agent substrate than a Python bridge.

### 1.4 Alexa / Google Home hacks

Assistant → IFTTT → HTTP → ESP mimicking a WeMo ([Hackster example](https://www.hackster.io/igorF2/wi-fi-voice-controlled-robot-using-google-assistant-79802c), [Instructables Alexa servo](https://www.instructables.com/Alexa-Controlled-Servo/)). **Not recommended**: cloud dependency, multi-second latency, phrase rigidity. Superseded by local Whisper + LLM.

### 1.5 Claude/MCP → serial (directly relevant)

Working prior art for "Claude drives an Arduino":

- [vishalmysore/choturobo](https://github.com/vishalmysore/choturobo) — MCP server bridging Claude to Arduino robots over serial ([writeup](https://dev.to/vishalmysore/arduino-robot-controlled-by-claude-ai-mcp-2fja)).
- [bmdragos/serial-mcp](https://github.com/bmdragos/serial-mcp) — minimal non-blocking serial MCP server.
- [es617/serial-mcp-server](https://github.com/es617/serial-mcp-server) — fuller serial toolset for Claude Code (list/open ports, line-oriented IO, device plugins).

Since this arm already speaks a line-oriented text protocol, any of these (or a 50-line pyserial CLI Claude drives via Bash) makes the arm agent-controllable immediately.

---

## 2. LLM-driven arm control patterns — which pipeline fits

### Pattern A — STT → LLM function-calling → serial (RECOMMENDED for this hardware)

```
mic → faster-whisper (local) → LLM with tools:
      move_joint(name, delta), goto_pose(name), set_gripper(pct),
      look() → camera frame, sequence([...])
   → host-side safety clamp → pyserial → Uno → Servo.write()
```

- Same shape as [tiago_gpt_control](https://github.com/federicobiagi/tiago_gpt_control), the [Wolfram LLM arm demo](https://www.wolframcloud.com/obj/564e19b4-fce9-44c1-ac53-df860bef203e), and [Acrome's LLM robot-control guide](https://acrome.net/post/controlling-robots-with-llms-large-language-models).
- Research variants add waypoint generation from 3D scenes ([arXiv:2403.09308](https://arxiv.org/html/2403.09308v1), [arXiv:2510.27558](https://arxiv.org/html/2510.27558)) — confirms the "LLM emits waypoints, classical control executes" split.
- **Key adaptation for a no-encoder arm: the LLM never emits raw joint angles for reaching tasks.** It calls *named, pre-taught waypoints* and small relative jogs. The tool schema is the safety and competence boundary.

### Pattern B — VLM/policy in the loop (LeRobot ACT / SmolVLA / pi0)

- ACT needs teleoperated demonstrations: ~50–250 episodes/task, ~100k training steps, for 70–90% success on cube pick-place ([LeRobot IL tutorial](https://huggingface-lerobot.mintlify.app/tutorials/imitation-learning), [ML6 field report](https://www.ml6.eu/en/blog/ai-robotics-a-field-report-on-imitation-learning-with-lerobot)).
- [SmolVLA (450M)](https://huggingface.co/blog/smolvla) runs on consumer GPUs and beats ACT on SO-10x tasks.
- **Verdict for this arm: not now.** Requires joint-state observations (Uno positional servos report nothing), a teleop rig, and 25–60 fps synchronized obs/action logging a 115200-baud text protocol can't sustain. Future upgrade path: swap to Feetech STS3215 bus servos → the whole LeRobot stack applies.

### Pattern C — VLM as perception oracle only (the pragmatic hybrid)

Use the VLM per *decision*, not per *timestep*: grab frame → "where is the red block?" → pick nearest taught waypoint → execute open-loop → grab frame → verify → correct once or twice. This perceive→act→re-perceive loop at ~0.2 Hz matches an Uno, and is exactly the agentic tool-use loop Claude Code performs naturally.

---

## 3. Camera → action correlation with no kinematic feedback

Positional hobby servos are open-loop; printed linkages + MG996R deadband mean real pose drifts from commanded. Mitigations, cheapest first:

1. **Waypoint teaching (jog + record named poses) — the backbone.** Jog over serial, save the full servo tuple under a name (`above_block_A`, `grasp_low`, `drop_zone`). Replay is deterministic to within a few degrees. Classic pattern: [Adafruit Trainable Arm](https://learn.adafruit.com/trainable-robotic-arm/sketch), [Instructables record-and-repeat](https://www.instructables.com/Arduino-Programmable-Robotic-Arm-Record-and-Repeat/), [CircuitDigest record-and-play](https://circuitdigest.com/microcontroller-projects/record-and-play-3d-printed-robotic-arm-using-arduino). Store the pose table on the HOST (JSON) so the LLM can read/extend it.
2. **2D homography for tabletop targets.** Fixed cam + flat table = plane-to-plane map. Calibrate once by jogging the gripper to 4–8 known points and clicking pixels (`cv2.findHomography`); thereafter pixel → table-mm ([OpenCV forum worked example](https://forum.opencv.org/t/computer-vision-robot-arm-using-homography-calibration/18684)). Combine with a coarse taught-waypoint grid (3×3 table cells, interpolate) for "pick from anywhere".
3. **Color blob / VLM detection for targets.** HSV+contour is the hobby workhorse ([himadripoddar 3-DOF](https://github.com/himadripoddar/Pick-and-Place-3-DOF-Robotic-Arm), [4-DOF color sorter](https://www.instructables.com/4-DoF-Robot-Arm-Pick-Place-Color-Sorter-With-Inver/)); with Claude in the loop, skip HSV tuning — the VLM returns a pixel box.
4. **AprilTag on the gripper = poor-man's encoder.** A 25–36 mm tag36h11 (`pupil-apriltags`) on the wrist gives a live 6-DOF end-effector pose — visual feedback the servos can't provide. Enables verify-after-move and bounded visual-servo corrections; AprilTag hand-eye methods explicitly work without joint encoders ([DLR method](https://elib.dlr.de/116772/1/nissler_iros17_accpeted.pdf), [ViSP tutorial](https://visp-doc.inria.fr/doxygen/visp-daily/tutorial-calibration-extrinsic-eye-to-hand.html)). A second tag on the table anchors the world frame.
5. **Full analytic IK — skip initially.** DH params for a printed arm with ±3° servo error yield cm-level tip error anyway. Waypoints + homography + visual verify delivers the outcome with a fraction of the math.

---

## 4. Safety patterns for LLM-driven motion

Layered, firmware-first:

1. **Firmware clamp (already present in this sketch)** — per-joint min/max, every command clamped before `Servo.write()`. Add per-tick slew limiting (2–3°/20 ms) so a command can never slam full servo speed (MG996Rs at full slew snap printed parts / brown out supplies — [MG996R failure diagnosis](https://industrialmonitordirect.com/blogs/knowledgebase/mg996r-servo-failure-voltage-battery-and-pwm-diagnosis)). *"Never trust the host for safety-critical clamping"* ([servo build guide](https://industrialmonitordirect.com/blogs/knowledgebase/building-a-diy-humanoid-robot-servo-wiring-and-control-guide)).
2. **Firmware watchdog/heartbeat** — host silence mid-motion → hold position (do NOT detach; gravity drops the arm). AVR `wdt_enable` so a hung sketch resets rather than stalling a servo at 2.5 A.
3. **Host-side validation shim between LLM and serial** — the LLM gets tools, never raw serial; the bridge re-validates limits + workspace rules, caps step size, logs everything. Mirrors **RoboGuard** ([arXiv:2503.07885](https://arxiv.org/abs/2503.07885)): safety specs enforced outside the prompt-injectable channel.
4. **Deadman/arming for voice** — motion tools disabled until explicit arming; any utterance containing "stop" bypasses the LLM (string match in STT stream) → immediate hold; auto-disarm on idle. Physical: servo-power rocker separate from Uno USB = hardware e-stop that kills torque but keeps the brain ([AutoRT rules](https://arxiv.org/pdf/2401.12963): human in line of sight, e-stop reachable).
5. **Mechanical reality** — keep taught waypoints away from hard stops; no stall-prone poses (full extension under load) as teachable waypoints.
6. **LLM-specific caps in the tool layer, not the prompt** — max N motion calls per utterance without re-confirmation; sequence length cap; no motion while the camera sees a hand in frame.

---

## 5. Recommendation — shortest credible path on THIS hardware

**Architecture: Pattern A + Pattern C.** Local STT → Claude Code as the agent → Python safety bridge → existing serial protocol; camera as per-step perception oracle with homography + taught waypoints; AprilTag verify as the closer. All local/free except Claude.

| # | Component | What exactly | Effort |
|---|---|---|---|
| 1 | Firmware hardening | Per-tick slew limit, heartbeat→hold, `status` (limits already clamped; already prints limits). AVR watchdog. | 0.5–1 day |
| 2 | `arm.py` host bridge (pyserial CLI) | `jog/goto/grip/home/stop/teach/list-poses`; re-validates limits; JSON pose store; full log. Claude drives via Bash — no MCP needed day one. | 0.5 day |
| 3 | Waypoint library | Teach ~10 poses by jogging (`home`, `above_grid_A1..C3`, `grasp_low`, `lift`, `drop_zone`). First "pick up the block" (known cell) works here. | 0.5 day |
| 4 | Camera in the loop | Frame grab + one-time 6–8-point click-to-jog homography; Claude vision finds the object box → nearest taught cell. Arbitrary placement, coarse. | 1 day |
| 5 | Voice front-end | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (small/base, int8 CPU) + sounddevice + VAD push-to-talk feeding Claude Code; hard-coded "stop" bypass. | 0.5–1 day |
| 6 | Verify/correct + AprilTag | `pupil-apriltags` tag on wrist + table anchor; ≤2 bounded corrective jogs after each goto. ~70% open-loop → demo-grade. | 1–2 days |

**Total: ~4–6 focused days** to reliable voice-commanded pick-and-place. Steps 1–3 (~2 days) give typed/voiced "pick up the block" from a known spot.

**Deferred:** LeRobot ACT/SmolVLA (blocked on servo feedback — upgrade path = Feetech STS3215 swap), full analytic IK, cloud assistants.
