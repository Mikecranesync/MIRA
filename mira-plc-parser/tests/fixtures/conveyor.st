(* Conveyor cell logic - IEC 61131-3 Structured Text export.
   camelCase identifiers on purpose: this is how a lot of CODESYS/OpenPLC code reads, and it is
   exactly what the tokenizer must classify (MotorRun, ConvFault, EStopOK, ...). *)
PROGRAM ConveyorControl
VAR
    StartPB       : BOOL;        (* operator start pushbutton *)
    StopPB        : BOOL;        (* operator stop pushbutton *)
    EStopOK       : BOOL;        (* emergency-stop circuit healthy (safety) *)
    AutoMode      : BOOL;        (* line in automatic mode *)
    JamPhotoeye   : BOOL;        (* jam-detection photo-eye *)
    MotorRun      : BOOL;        (* conveyor VFD run command *)
    ConvFault     : BOOL;        (* conveyor fault latch *)
    VFD_Frequency : REAL;        (* drive output frequency Hz *)
    VFD_Current   : REAL;        (* drive output current amps *)
    VFD_FaultCode : DINT;        (* active drive fault code *)
    RunTimer      : TON;         (* conveyor run-time accumulator *)
END_VAR
VAR_GLOBAL
    LineSpeedSetpoint : REAL := 60.0;   (* freq setpoint, Hz *)
END_VAR

(* run the conveyor when started, in auto, e-stop healthy, no fault *)
IF StartPB AND EStopOK AND AutoMode AND NOT ConvFault THEN
    MotorRun := TRUE;
END_IF;

IF StopPB OR NOT EStopOK THEN
    MotorRun := FALSE;
END_IF;

(* latch a fault when the drive reports one or the photo-eye blocks while running *)
IF VFD_FaultCode > 0 OR (MotorRun AND JamPhotoeye) THEN
    ConvFault := TRUE;
END_IF;
END_PROGRAM
