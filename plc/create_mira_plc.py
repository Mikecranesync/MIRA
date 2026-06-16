#!/usr/bin/env python3
"""
Generate a clean MIRA_PLC CCW project for Allen-Bradley Micro820.

Creates the complete directory structure and all text/XML config files.
CCW auto-generates the binary files (PrjLibrary.accdb, .rtc, symbols)
on first open.

Usage:
    python plc/create_mira_plc.py
"""

import os
import shutil
import uuid
from pathlib import Path

# === Configuration ===
CCW_DIR = Path(r"C:\Users\hharp\Documents\CCW\MIRA_PLC")
REPO_DIR = Path(r"C:\Users\hharp\Documents\GitHub\MIRA")
PLC_IP = "169.254.227.240"  # Current APIPA address; change to 192.168.1.100 after static IP set
HOSTNAME = "LAPTOP-0KA3C70H"
PROJECT_GUID = str(uuid.uuid4()).upper()
# ISaGRAF engine GUIDs (fixed, copied from working CCW installations)
ELEM_GUID_1 = "2aa7fd59-0cca-47ba-9b52-d3f1a83799cb"
ELEM_GUID_2 = "994e29cf-3890-4089-ad54-8a046fefa294"
ELEM_GUID_3 = "a11d74f7-87f8-426c-b308-f188827d4ea8"
ELEM_GUID_4 = "d94155e1-02c1-4bf1-b360-b10552cab604"
# CCW project type GUID (fixed for all Micro800 projects)
PROJECT_TYPE_GUID = "A6F45E2C-46AC-4E2B-9F75-4E058226B5AB"


def write_utf16le(path: Path, content: str):
    """Write a file in UTF-16LE with BOM, CRLF line endings."""
    data = b"\xff\xfe" + content.encode("utf-16-le")
    path.write_bytes(data)


def write_utf8(path: Path, content: str):
    """Write a file in UTF-8."""
    path.write_text(content, encoding="utf-8")


def write_empty(path: Path):
    """Create an empty file."""
    path.write_bytes(b"")


def main():
    if CCW_DIR.exists():
        print(f"[!] {CCW_DIR} already exists. Delete it first or choose a different name.")
        return

    print(f"Creating MIRA_PLC project at {CCW_DIR}")
    print(f"Project GUID: {{{PROJECT_GUID}}}")
    print(f"PLC IP: {PLC_IP}")
    print()

    # === Create directory tree ===
    dirs = [
        CCW_DIR,
        CCW_DIR / "Controller",
        CCW_DIR / "Controller" / "Embedded",
        CCW_DIR / "Controller" / "LogicalValues",
        CCW_DIR / "Controller" / "MLGE",
        CCW_DIR / "Controller" / "Controller",
        CCW_DIR / "Controller" / "Controller" / "Micro820",
        CCW_DIR / "Controller" / "Controller" / "Micro820" / "Micro820",
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        print(f"  mkdir {d.relative_to(CCW_DIR)}")

    # === 1. MIRA_PLC.ccwsln (UTF-16LE with BOM) ===
    guid_lower = PROJECT_GUID
    sln_content = (
        "\r\n"
        "Microsoft Visual Studio Solution File, Format Version 12.00\r\n"
        "# CCW Solution File, CCW Software 22.0\r\n"
        "VisualStudioVersion = 14.0.23107.0\r\n"
        "MinimumVisualStudioVersion = 10.0.40219.1\r\n"
        f'Project("{{{PROJECT_TYPE_GUID}}}") = "Controller", '
        f'"controller\\Controller.acfproj", "{{{guid_lower}}}"\r\n'
        "EndProject\r\n"
        "Global\r\n"
        "\tGlobalSection(SolutionConfigurationPlatforms) = preSolution\r\n"
        "\t\tOnline|Any CPU = Online|Any CPU\r\n"
        "\tEndGlobalSection\r\n"
        "\tGlobalSection(ProjectConfigurationPlatforms) = postSolution\r\n"
        f"\t\t{{{guid_lower}}}.Online|Any CPU.ActiveCfg = Online|Any CPU\r\n"
        f"\t\t{{{guid_lower}}}.Online|Any CPU.Build.0 = Online|Any CPU\r\n"
        "\tEndGlobalSection\r\n"
        "\tGlobalSection(SolutionProperties) = preSolution\r\n"
        "\t\tHideSolutionNode = FALSE\r\n"
        "\tEndGlobalSection\r\n"
        "EndGlobal\r\n"
    )
    write_utf16le(CCW_DIR / "MIRA_PLC.ccwsln", sln_content)
    print("  wrote MIRA_PLC.ccwsln (UTF-16LE)")

    # === 2. Controller.acfproj ===
    guid_lc = PROJECT_GUID.lower()
    acfproj = f"""\
<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <Configuration Condition=" '$(Configuration)' == '' ">Debug</Configuration>
    <SchemaVersion>2.0</SchemaVersion>
    <ProjectGuid>{{{guid_lc}}}</ProjectGuid>
    <OutputType>Exe</OutputType>
    <RootNamespace>MyRootNamespace</RootNamespace>
    <AssemblyName>MyAssemblyName</AssemblyName>
    <EnableUnmanagedDebugging>false</EnableUnmanagedDebugging>
    <CAMProjectFile>Controller\\PrjLibrary.accdb</CAMProjectFile>
    <CAMProjectVersion>5.50.12</CAMProjectVersion>
    <UniqueProjectId>{{{guid_lc}}}</UniqueProjectId>
  </PropertyGroup>
  <PropertyGroup Condition=" '$(Configuration)' == 'Online' ">
    <OutputPath>bin\\Online\\</OutputPath>
  </PropertyGroup>
  <Import Project="$(DevEnvDir)\\PackagesToLoad\\Targets\\ISaGRAF.ISaGRAF5.targets" />
  <Import Project="$(DevEnvDir)\\PackagesToLoad\\Targets\\ISaGRAF.CCW.targets" />
</Project>"""
    write_utf8(CCW_DIR / "Controller" / "Controller.acfproj", acfproj)
    print("  wrote Controller.acfproj")

    # === 3. DevicePref.xml ===
    device_pref = f"""\
<?xml version="1.0" encoding="utf-8"?>
<DevicePreferences xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Micro800ConnectionPath>{HOSTNAME}!AB_ETHIP-1\\{PLC_IP}</Micro800ConnectionPath>
  <RSLCPath>{HOSTNAME}!AB_ETHIP-1\\{PLC_IP}</RSLCPath>
  <FTLPath />
</DevicePreferences>"""
    ctrl = CCW_DIR / "Controller" / "Controller"
    write_utf8(ctrl / "DevicePref.xml", device_pref)
    print(f"  wrote DevicePref.xml -> {PLC_IP}")

    # === 4. DlgCfg.xml ===
    dlg_cfg = """\
<?xml version="1.0"?>
<DLGRCP_Config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <MajorVersion>0</MajorVersion>
  <MinorVersion>0</MinorVersion>
  <DLGRCP_Set />
</DLGRCP_Config>"""
    write_utf8(ctrl / "DlgCfg.xml", dlg_cfg)

    # === 5. LogicView.xml ===
    logic_view = """\
<?xml version="1.0" encoding="utf-8"?>
<ProgramItemsData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <ProgramItems>
    <ProgramItem>
      <ProgramName>Program2</ProgramName>
      <RoutingName>Prog2</RoutingName>
      <SubRoutings />
    </ProgramItem>
  </ProgramItems>
</ProgramItemsData>"""
    write_utf8(ctrl / "LogicView.xml", logic_view)

    # === 6. RcpCfg.xml ===
    write_utf8(ctrl / "RcpCfg.xml", dlg_cfg)  # Same as DlgCfg

    # === 7. MbSrvConf.xml (copy from repo) ===
    src_mbsrv = REPO_DIR / "plc" / "MbSrvConf_v3.xml"
    shutil.copy2(src_mbsrv, ctrl / "MbSrvConf.xml")
    print("  copied MbSrvConf.xml from plc/MbSrvConf_v3.xml")

    # === 8. Conf.mtc ===
    conf_mtc = """\
[MAIN]
NET=1
CONF=1
RES=1


[NET]
N1=CIPNetwork_1, CIPNetwork


[CONF]
C1=Micro820, 1
I1=1, ""


[RES]
R1=1, Micro820, 1
"""
    write_utf8(ctrl / "Conf.mtc", conf_mtc)

    # === 9. project.gpm ===
    project_gpm = """\
Configuration:Device1
50.00;50.00;1;1;160.00;85.00
Resource:1
1;42.00;196.00;287.00;208.00;230.00;220.00;0.00;0.00
0;1;1;1;1;
"""
    write_utf8(ctrl / "project.gpm", project_gpm)

    # === 10. RMD.info ===
    write_utf8(ctrl / "RMD.info", "[RMDManager]\nTASK=REBUILD\n")

    # === 11. Compile.ic ===
    write_utf8(ctrl / "Compile.ic", "TO RELINK\n")

    # === 12. Empty files ===
    write_empty(ctrl / "Breakpoints.lst")
    write_empty(ctrl / "CONTROLLER.err")

    # === 13. Prog2.stf (copy from repo) ===
    src_prog = REPO_DIR / "plc" / "Micro820_v3_Program.st"
    dst_prog = ctrl / "Micro820" / "Micro820" / "Prog2.stf"
    shutil.copy2(src_prog, dst_prog)
    print("  copied Prog2.stf from plc/Micro820_v3_Program.st")

    # === 14. Prog2.AcfMlge ===
    acf_mlge = """\
<?xml version="1.0" encoding="utf-8"?>
<Root Version="7">
  <LanguageContainerStyle CommentTextColor="Green" CommentFont="Courier New, 10pt" PonctuationTextColor="Black" PonctuationFont="Courier New, 10pt" IdentifierTextColor="Black" IdentifierFont="Courier New, 10pt" OperatorTextColor="Black" OperatorFont="Courier New, 10pt" ReservedWordTextColor="Fuchsia" ReservedWordFont="Courier New, 10pt" PouTextColor="BlueViolet" PouFont="Courier New, 10pt" NumberTextColor="Firebrick" NumberFont="Courier New, 10pt" StringTextColor="Gray" StringFont="Courier New, 10pt" EditorTextAreaBackgroundColor="White" EditorFont="Courier New, 10pt" Index="0" />
</Root>"""
    write_utf8(ctrl / "Micro820" / "Micro820" / "Prog2.AcfMlge", acf_mlge)

    # === 15. ExtendedInfo.xml files ===
    embedded_info = f"""\
<?xml version="1.0" encoding="utf-8"?>
<ProjectElements>
  <AcfElementGuid Guid="{ELEM_GUID_1}" />
  <AcfElementGuid Guid="{ELEM_GUID_2}" />
  <AcfElementGuid Guid="{ELEM_GUID_3}" />
  <AcfElementGuid Guid="{ELEM_GUID_4}" />
</ProjectElements>"""
    write_utf8(CCW_DIR / "Controller" / "Embedded" / "ExtendedInfo.xml", embedded_info)

    logval_info = f"""\
<?xml version="1.0" encoding="utf-8"?>
<ProjectElements>
  <AcfElementGuid Guid="{ELEM_GUID_2}" />
  <AcfElementGuid Guid="{ELEM_GUID_3}" />
</ProjectElements>"""
    write_utf8(CCW_DIR / "Controller" / "LogicalValues" / "ExtendedInfo.xml", logval_info)

    mlge_info = f"""\
<?xml version="1.0" encoding="utf-8"?>
<ProjectElements>
  <AcfElementGuid Guid="{ELEM_GUID_2}">
    <File>Prog2.AcfMlge</File>
  </AcfElementGuid>
</ProjectElements>"""
    write_utf8(CCW_DIR / "Controller" / "MLGE" / "ExtendedInfo.xml", mlge_info)

    # === Done ===
    print()
    print("=" * 60)
    print("MIRA_PLC project created successfully!")
    print("=" * 60)
    print()
    print("NEXT STEPS:")
    print("  1. Open CCW -> File -> Open ->")
    print(f"     {CCW_DIR / 'MIRA_PLC.ccwsln'}")
    print()
    print("  2. Add global variables (see list below)")
    print()
    print("  3. Verify serial port: Modbus RTU Master, 9600/8N2")
    print()
    print("  4. Ctrl+Shift+B to compile")
    print()
    print(f"  5. Go Online -> Browse -> {PLC_IP}")
    print("     PROGRAM mode -> Download -> RUN mode")
    print()
    print("=" * 60)
    print("GLOBAL VARIABLES TO ADD IN CCW")
    print("=" * 60)
    print()
    print("--- BOOLs (23) — all default FALSE ---")
    bools = [
        "motor_running", "motor_stopped", "conveyor_running", "fault_alarm",
        "sensor_1_active", "sensor_2_active", "e_stop_active", "button_rising",
        "SensorEnd_Prev", "ALL_LEDS_ON", "vfd_comm_ok", "vfd_comm_err",
        "vfd_msg_done", "vfd_write_trig", "dir_fwd", "dir_rev", "dir_off",
        "dir_fault", "estop_wiring_fault", "prev_button", "vfd_poll_active",
        "system_ready", "heartbeat",
    ]
    for b in bools:
        print(f"  {b:30s} BOOL    FALSE")
    print()

    print("--- INTs (19) — all default 0 except vfd_cmd_word ---")
    ints = [
        ("motor_speed", 0), ("motor_current", 0), ("temperature", 0),
        ("pressure", 0), ("conveyor_speed", 0), ("error_code", 0),
        ("vfd_frequency", 0), ("vfd_current", 0), ("vfd_dc_bus", 0),
        ("vfd_voltage", 0), ("vfd_fault_code", 0), ("conv_state", 0),
        ("cycle_count", 0), ("uptime_seconds", 0), ("item_count", 0),
        ("conveyor_speed_cmd", 0), ("vfd_poll_step", 0),
        ("vfd_freq_setpoint", 0), ("vfd_cmd_word", 5),
    ]
    for name, val in ints:
        print(f"  {name:30s} INT     {val}")
    print()

    print("--- TON timers (5) ---")
    for t in ["start_timer", "stop_timer", "uptime_timer", "vfd_err_timer", "vfd_poll_timer"]:
        print(f"  {t:30s} TON")
    print()

    print("--- MSG instances (3) ---")
    for m in ["mb_read_status", "mb_write_cmd", "mb_write_freq"]:
        print(f"  {m:30s} MSG")
    print()

    print("--- MSG_MODBUS_LOCAL (3) ---")
    for m in ["read_local_cfg", "write_cmd_local_cfg", "write_freq_local_cfg"]:
        print(f"  {m:30s} MSG_MODBUS_LOCAL")
    print()

    print("--- MSG_MODBUS_TARGET (3) ---")
    for m in ["read_target_cfg", "write_cmd_target_cfg", "write_freq_target_cfg"]:
        print(f"  {m:30s} MSG_MODBUS_TARGET")
    print()

    print("--- INT arrays (3) ---")
    for a in ["read_data", "write_cmd_data", "write_freq_data"]:
        print(f"  {a:30s} INT[1..10]")
    print()
    print("=" * 60)
    print(f"Total: {len(bools)} BOOLs + {len(ints)} INTs + 5 TON + 3 MSG")
    print(f"       + 3 MSG_MODBUS_LOCAL + 3 MSG_MODBUS_TARGET + 3 arrays")
    print(f"       = 56 variables to add")
    print("=" * 60)


if __name__ == "__main__":
    main()
