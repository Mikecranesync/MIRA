# Poll scheduler, write-buffer, and commissioning patterns

These are the reusable ST building blocks for a Micro800 ↔ VFD comms POU. They've stabilized
across every working version of the Conv_Simple VFD program; the reasoning matters more than
the exact constants.

## 1. Self-retriggering heartbeat (the master clock)

```structured-text
(* poll_timer : TON  — declared in Global Variables *)
poll_timer(IN := NOT poll_timer.Q, PT := T#500ms);
poll_tick := poll_timer.Q;          (* one-scan TRUE every 500 ms *)
```

Feeding the timer's **inverted output back into its input** makes it self-reset the scan after
it fires, producing a clean one-scan pulse train. Don't hold `IN := TRUE` — that's a level,
not a tick. 500 ms is the bench default; tune *after* comms are proven, not before.

## 2. Round-robin step scheduler

```structured-text
IF poll_tick THEN
  poll_step := poll_step + 1;
  IF poll_step > N THEN poll_step := 1; END_IF;   (* wrap *)
  poll_count := poll_count + 1;

  (* skip optional steps when nothing is pending *)
  IF poll_step = STEP_FAULT_RESET AND NOT fault_reset_pending THEN
    poll_step := 1;
  END_IF;

  (* commissioning gate: mask every write step (see §5) *)
  IF commissioning_mode AND poll_step IN {write steps} THEN
    poll_step := <next read step>;
  END_IF;
END_IF;

step_read_active  := (poll_step = STEP_READ)  AND poll_tick;
step_write_active := (poll_step = STEP_WRITE) AND poll_tick;
```

A 2-step loop (read / write-cmd) is the minimum; the fuller lineage uses up to 5 steps:
`read-monitor → write-cmd → write-freq → [fault-reset] → [read-status-word]`. Each
`step_*_active` is a **one-scan** boolean that gates exactly one MSG instance's `IN`.

## 3. Edge-triggered MSG firing

All MSG instances exist every scan; only the active one gets a rising edge:

```structured-text
MB_READ(IN := step_read_active,  LOCALCFG := read_local_cfg,  TARGETCFG := read_target_cfg,  LOCALADDR := read_data);
MB_WCMD(IN := step_write_active, LOCALCFG := wcmd_local_cfg,   TARGETCFG := wcmd_target_cfg,   LOCALADDR := write_cmd_data);
```

With `TriggerType := 0`, the FB latches the request on the FALSE→TRUE edge of `IN` and runs
its internal state machine over the next several scans. The result (`.Q`/`.Error`) arrives
asynchronously while `IN` is already back to FALSE — which is fine, because you check the
outputs every scan (§6), not gated on the tick.

## 4. COP into the write buffer

Modbus writes read from an `ARRAY[1..n] OF WORD`, never a scalar. Marshal the scalar command
into the buffer with `COP` / `COP_FILE`:

```structured-text
(* COP signature on Micro820: Enable, Src, SrcOffset, Dest, DestOffset, Length, Swap *)
COP_CMD(Enable := TRUE,
        Src        := vfd_cmd_word,    (* scalar WORD *)
        SrcOffset  := 0,
        Dest       := write_cmd_data,  (* ARRAY[1..1] OF WORD *)
        DestOffset := 0,
        Length     := 1,
        Swap       := FALSE);
```

`COP` runs **every scan when `Enable := TRUE`** (it is not edge-gated). Keep it unconditional
so the buffer always holds the latest value; the *write FB* is what's gated by the step logic,
so it sends fresh data. Direct array-element assignment (`write_cmd_data[1] := vfd_cmd_word;`)
is less reliable for buffer population in the same scan — prefer COP.

## 5. `commissioning_mode` — the write-disable safety gate

```structured-text
(* When TRUE, only read steps fire — proves bidirectional comms BEFORE
   the program is ever allowed to command the drive to move. Default FALSE. *)
IF commissioning_mode AND (poll_step = STEP_WRITE_CMD
                        OR poll_step = STEP_WRITE_FREQ
                        OR poll_step = STEP_FAULT_RESET) THEN
  poll_step := STEP_READ;     (* jump to a read step instead *)
END_IF;
```

This is a **commissioning safety gate**, not a debug convenience. Bring up a drive read-only
first: confirm `comm_ok` and that the status word reads sane values. Only then set
`commissioning_mode := FALSE` and allow the command word onto the bus. Expose it as a coil in
the Modbus/TCP map so a monitor can see/flip it.

## 6. Capture results + comm watchdog

```structured-text
IF MB_READ.Q THEN
  (* map read_data[...] into named vars — VERIFY the address→label mapping! *)
  comm_ok  := TRUE;  comm_err := FALSE;  last_ok_tick := poll_count;
END_IF;
IF MB_READ.Error THEN
  comm_ok  := FALSE; comm_err := TRUE;   read_err_count := read_err_count + 1;
END_IF;

(* latch a system fault after a sustained comm loss *)
comm_err_timer(IN := comm_err, PT := T#5000ms);
IF comm_err_timer.Q THEN
  fault_alarm := TRUE;
  error_code  := 9;        (* VFD_COMM in the conv_state error enum *)
END_IF;
```

Per-step instrumentation pays for itself on this hardware (where `.ErrorID` isn't readable in
ST): keep `read_err_count` / `write_cmd_err_count` / `last_err_step` / `last_ok_at_uptime` so
the next debug session is driven by data, not guesses.

## 7. Safety interlock is upstream of the write

The command word is decided from **E-stop, wiring-fault, and contactor (MLC) state** before it
is ever marshaled to the bus — never gate safety inside the Modbus layer:

```structured-text
IF e_stop_active OR estop_wiring_fault OR NOT mlc_coil THEN
  vfd_cmd_word := 1;                 (* STOP *)
ELSIF dir_fwd_sw AND NOT dir_rev_sw THEN
  vfd_cmd_word := 18;                (* FWD+RUN *)
ELSIF dir_rev_sw AND NOT dir_fwd_sw THEN
  vfd_cmd_word := 20;                (* REV+RUN *)
ELSE
  vfd_cmd_word := 1;
END_IF;
```

E-stop is dual-channel: a healthy state needs the NC and NO contacts in *opposite* states;
both-same is a wiring fault and must de-energize the contactor. The Modbus write only ever
relays the already-safe command word onto the wire.
