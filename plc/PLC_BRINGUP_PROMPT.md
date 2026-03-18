# PLC Micro820 Bringup — Paste This Into Claude Code on PLC Laptop

## Resume Status (from travel laptop session)

```
Resuming PLC Micro820 bringup. Phase 0 progress:
- 0a. Netgear SG605 switch powered: PASS
- 0b. Micro820 PLC powered (PWR LED blinking): PASS
- 0c. Ethernet cable routing: NOT YET CHECKED
- 0d. Switch port LED: NOT YET CHECKED

PLC files verified at: C:\Users\hharp\Documents\GitHub\MIRA\plc\
Git is at commit 83c053c, matches origin/main.
CCW project: C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0\
PLC laptop Ethernet IP: 192.168.1.10/24 (static)
PLC target IP: 192.168.1.100
```

## Full Checkpoint Prompt — Copy Everything Below This Line

```
We are treating this as a completely fresh PLC deployment from scratch.
The PLC may have bad config, wrong IP, or no program. Assume nothing works
until we verify it ourselves at each step.

You have programmatic access to this machine via terminal. I am physically
at the machine and will tell you what I see. Work together — you check what
you can see, I check what you cannot.

Project repo is at: C:\Users\hharp\Documents\GitHub\MIRA\
CCW project is at: C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0\
All reference files are inside the repo under plc/

RULES:
- Never skip a step
- After each step, tell me: PASS / FAIL / NEEDS PHYSICAL CHECK
- Do not proceed to the next step until I confirm the current one is PASS
- If you can verify something programmatically, do it — do not ask me to
  check something you can check yourself
- Keep a running checklist at the top of every response showing what is
  done, in progress, and pending

=== PHASE 0: PHYSICAL POWER CHECK (PARTIAL — from previous session) ===
0a. Netgear SG605 switch powered on: PASS (confirmed)
0b. 24VDC PSU / Micro820 PWR LED: PASS (blinking, confirmed)

Resume from here:
  0c. Is the Ethernet cable from THIS laptop plugged into the Netgear SG605?
      (NOT into the Eero router — should go to the gray industrial switch)
  0d. Does the switch port LED blink when you wiggle the cable?

Wait for me to answer before continuing.

=== PHASE 1: NETWORK VERIFY ===
Once Phase 0 is complete, run these in sequence and report each:

1a. ping -n 3 -w 1000 192.168.1.100    <- PLC
1b. ping -n 3 -w 1000 192.168.1.1      <- Switch/gateway
1c. Test-NetConnection -ComputerName 192.168.1.100 -Port 502

If 1a fails:
  - Run: arp -a | findstr 192.168.1
  - Run: Get-NetIPAddress -InterfaceAlias Ethernet
  - Tell me exactly what IP this laptop is on and what the ARP table shows
  - Ask me: "What IP does the PLC display show?"
    (some Micro820s show IP on the LCD panel during boot)

If the PLC has wrong IP or unknown IP, we will use RSLinx to discover it.

=== PHASE 2: PLC DISCOVERY (if Phase 1 fails) ===
If we cannot ping 192.168.1.100, we need to find the PLC another way.

2a. Check if RSLinx is running:
    Get-Process -Name RSLinx -ErrorAction SilentlyContinue
2b. Check RSLinx service:
    Get-Service -Name RSLinx -ErrorAction SilentlyContinue

Tell me: "Open RSLinx Classic on the desktop. Go to
Communications -> Configure Drivers -> add an Ethernet/IP driver
on 192.168.1.x subnet. Tell me what devices appear in the RSWho browser."

Wait for me to report what RSLinx finds before continuing.

=== PHASE 3: SET PLC IP (if needed) ===
If PLC is on wrong IP or has default factory IP (192.168.1.1 or DHCP):

Tell me to do this in CCW:
  - File -> Open Project -> Cosmos_Demo_v1.0
  - Controller Properties -> Ethernet -> set IP to 192.168.1.100
  - Subnet: 255.255.255.0, Gateway: 192.168.1.1
  - Download IP settings only (not full program yet)

Then re-run Phase 1 to confirm connectivity.

=== PHASE 4: CCW PROJECT VERIFY ===
Once PLC is reachable, check the project files:

4a. Verify all 4 program files exist:
    Test-Path "C:\Users\hharp\Documents\GitHub\MIRA\plc\Micro820_v3_Program.st"
    Test-Path "C:\Users\hharp\Documents\GitHub\MIRA\plc\MbSrvConf_v3.xml"
    Test-Path "C:\Users\hharp\Documents\GitHub\MIRA\plc\CCW_VARIABLES_v3.txt"
    Test-Path "C:\Users\hharp\Documents\GitHub\MIRA\plc\CCW_DEPLOY_v3.txt"

4b. Show first 15 lines of the ST program to confirm it is v3.1:
    Get-Content "C:\Users\hharp\Documents\GitHub\MIRA\plc\Micro820_v3_Program.st" | Select-Object -First 15

4c. Verify CCW project folder structure:
    Get-ChildItem "C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0" -Recurse -Name

Then tell me to open CCW and report what version it shows (Help -> About).
Ask me: "What does the program slot show — is there a Prog2 listed under
the Micro820 in the project tree, or is it empty?"

=== PHASE 5: LOAD VARIABLES INTO CCW ===
Read CCW_VARIABLES_v3.txt from the repo and walk me through adding them.

5a. Read and display the full contents of CCW_VARIABLES_v3.txt
5b. Group them by type (BOOL, INT, MSG, MSG_MODBUS_LOCAL, MSG_MODBUS_TARGET, INT arrays)
5c. Give me a step-by-step checklist:
    "In CCW: click Global Variables -> New Variable -> Name: [x], Type: [y]"
    One group at a time. Wait for me to confirm each group before continuing.

Variables to add:
  BOOL: dir_fwd, dir_rev, dir_off, dir_fault, estop_wiring_fault, prev_button, vfd_poll_active
  INT:  vfd_poll_step (init 0), vfd_freq_setpoint (init 0), vfd_cmd_word (init 5)
  MSG:  mb_write_cmd, mb_write_freq
  MSG_MODBUS_LOCAL:  write_cmd_local_cfg, write_freq_local_cfg
  MSG_MODBUS_TARGET: write_cmd_target_cfg, write_freq_target_cfg
  INT[1..10]: write_cmd_data, write_freq_data

=== PHASE 6: LOAD PROGRAM INTO CCW ===
6a. Tell me exactly:
    "Right-click Prog2 in the project tree -> Open.
     Select all (Ctrl+A), delete everything.
     Open C:\Users\hharp\Documents\GitHub\MIRA\plc\Micro820_v3_Program.st
     in Notepad, copy all, paste into CCW Prog2 editor."

6b. Tell me to load MbSrvConf_v3.xml:
    Copy from: C:\Users\hharp\Documents\GitHub\MIRA\plc\MbSrvConf_v3.xml
    To: C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0\Controller\Controller\MbSrvConf.xml
    (overwrite the existing one)

6c. Tell me to configure serial port:
    Controller -> Embedded Serial -> Protocol: Modbus RTU Master
    Baud: 9600, Data: 8, Parity: None, Stop: 2

6d. Tell me: Ctrl+Shift+B to rebuild.
    Ask me to report any compile errors exactly as shown.
    If errors appear, read the ST file and diagnose them.

=== PHASE 7: DOWNLOAD TO PLC ===
7a. Tell me: Go Online (Ctrl+W) -> Connect to 192.168.1.100
    Ask: "Does the status bar show ONLINE in green?"

7b. Tell me: Controller -> Mode -> PROGRAM mode
    Ask: "Does the mode show PROGRAM?"

7c. Tell me: Controller -> Download
    Ask: "Did the download complete with no errors?"

7d. Tell me: Controller -> Mode -> RUN mode

7e. Verify via TCP:
    Test-NetConnection -ComputerName 192.168.1.100 -Port 502
    This should now show TcpTestSucceeded: True

=== PHASE 8: FORCE OUTPUT TEST ===
Still in CCW Online Monitor, before touching 3-phase power:

Ask me to physically check and confirm each:
  8a. Force O-00 ON -> "Does the GREEN pilot light illuminate?"
  8b. Force O-01 ON -> "Does the RED pilot light illuminate?"
  8c. Force O-03 ON -> "Does the RUN pushbutton LED illuminate?"
  8d. Force O-02 ON -> "Do you hear the contactor Q1 click?"
  8e. Remove all forces when done

=== PHASE 9: INPUT VERIFY ===
In CCW Online Monitor, check all inputs:
  9a. E-stop released -> I-02=1, I-03=0 — ask me to confirm
  9b. E-stop pressed  -> I-02=0, I-03=1 — ask me to confirm
  9c. Selector FWD    -> I-00=1, I-01=0 — ask me to confirm
  9d. Selector OFF    -> I-00=0, I-01=0 — ask me to confirm
  9e. Selector REV    -> I-00=0, I-01=1 — ask me to confirm
  9f. RUN button held -> I-04=1 — ask me to confirm

After all 9 phases pass, tell me we are ready for VFD programming (Phase 10)
and first motor run (Phase 11). Do not proceed past Phase 9 today without
my explicit confirmation.

Start with Phase 0c and 0d (the two remaining physical checks).
```
