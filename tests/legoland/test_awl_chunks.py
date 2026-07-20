"""Tests for tools/legoland/awl_chunks.py — Siemens AWL exports -> citable knowledge chunks.

Fixtures are SYNTHETIC (shaped like the real Technic/Chima exports, invented content). The
proprietary ride corpus never enters the repo — same law as tests/proveit/.
"""

import awl_chunks as ac

# --- synthetic fixtures ------------------------------------------------------------------------

# Technic-style comment-rich alarm data block (the crown-jewel maintenance text shape).
ALARM_DB = """\
//Global Datenbaustein DB_FAULTS *******************************
DATA_BLOCK DB_FAULTS
TITLE = DB_FAULTS
AUTHOR:LEI
FAMILY:W9999
NAME:DB_FAULTS
VERSION:1.0

STRUCT
Alarm0000\t:BOOL:=0;\t//\t#0 Fault Block 1 -F2 24VDC NORMAL-BUS TRIPPED
Alarm0001\t:BOOL:=0;\t//\t#1 Fault Block 1 -S40 DISAGREEMENT/$NTOO LONG ACTIVATED
Alarm0059\t:BOOL:=0;\t//\t#59 Fault Block 1 -A1 VFD FAULT
END_STRUCT ;
BEGIN
END_DATA_BLOCK
"""


def test_fault_glossary_chunk_carries_alarm_text_and_block():
    chunks = ac.build_fault_glossary_chunks(ALARM_DB, source_file="00000001.AWL", uns_prefix="x.y")
    assert len(chunks) == 1
    ch = chunks[0]
    assert ch.chunk_type == "plc_fault_glossary"
    assert "DB_FAULTS" in ch.content
    assert "Alarm0059" in ch.content
    assert "A1 VFD FAULT" in ch.content
    # $N is an HMI line break, not maintenance text
    assert "$N" not in ch.content
    assert ch.source_file == "00000001.AWL"
    assert ch.uns_path == "x.y"
    assert ch.metadata["block"] == "DB_FAULTS"
    assert ch.metadata["alarm_count"] == 3


def test_fault_glossary_batches_large_blocks():
    chunks = ac.build_fault_glossary_chunks(
        ALARM_DB, source_file="00000001.AWL", uns_prefix="", batch_size=2
    )
    assert len(chunks) == 2
    assert "Alarm0000" in chunks[0].content and "Alarm0059" not in chunks[0].content
    assert "Alarm0059" in chunks[1].content


def test_fault_glossary_empty_on_non_alarm_source():
    assert ac.build_fault_glossary_chunks('FUNCTION_BLOCK "X"\nBEGIN\n', source_file="f.AWL") == []


# Chima-style logic block: NETWORK sections with titles, comments, cabinet-sheet-device symbols.
LOGIC_FB = """\
FUNCTION_BLOCK "GEN_VISU"
TITLE =Modus
AUTHOR : 'FLG/GEB'
NAME : VISU
VERSION : 0.1


VAR
  ToDoLine : INT ;\t
END_VAR
BEGIN
NETWORK
TITLE =Mode "Automatic"

      U     "FB20B_Automatic";
      SPBNB _001;
      L     4;
      T     #DisplayModus;
_001: NOP   0;
NETWORK
TITLE =ToDo_INT
//
//"CONTROL VOLTAGE ON"
//
      UN    "I_GEN_08_S51";
      SPBNB _004;
      L     1;
      T     #ToDoLine;
END_FUNCTION_BLOCK
"""


def test_network_chunks_carry_title_comments_and_symbols():
    chunks = ac.build_network_chunks(LOGIC_FB, source_file="00000002.AWL", uns_prefix="x.y")
    assert len(chunks) == 2
    first, second = chunks
    assert first.chunk_type == "plc_block_network"
    assert "GEN_VISU" in first.content
    assert 'Mode "Automatic"' in first.content
    assert "FB20B_Automatic" in first.content
    assert first.uns_path == "x.y"
    assert first.source_file == "00000002.AWL"
    assert first.metadata["block"] == "GEN_VISU"
    assert first.metadata["network"] == 1
    # the second network's comment + referenced cabinet-sheet-device symbol survive
    assert "CONTROL VOLTAGE ON" in second.content
    assert "I_GEN_08_S51" in second.content
    assert second.metadata["network"] == 2


def test_network_chunks_empty_on_data_block_source():
    assert ac.build_network_chunks(ALARM_DB, source_file="00000001.AWL") == []


# Aquazone-style German fault DB: FltNN members, no initializer, some members uncommented.
FLT_DB = """\
DATA_BLOCK "DB_Störmeldungen"
TITLE =
VERSION : 0.1


  STRUCT \t
   Flt00 : BOOL ;\t//emergency stop Jet-Ski
   Flt06 : BOOL ;\t
   Flt10 : BOOL ;\t//fault Bridge Sensor 1
  END_STRUCT ;
BEGIN
END_DATA_BLOCK
"""


def test_fault_glossary_handles_non_alarm_named_fault_dbs():
    chunks = ac.build_fault_glossary_chunks(FLT_DB, source_file="00000001.AWL")
    assert len(chunks) == 1
    ch = chunks[0]
    assert "emergency stop Jet-Ski" in ch.content
    assert "fault Bridge Sensor 1" in ch.content
    assert "Flt06" not in ch.content  # uncommented member carries no maintenance text
    assert ch.metadata["block"] == "DB_Störmeldungen"
    assert ch.metadata["alarm_count"] == 2


# Technic-style timer/setpoint DB: commented non-BOOL members whose initializer IS the setpoint.
TIMER_DB = """\
//Global Datenbaustein DB_ZEITEN *******************************
DATA_BLOCK DB_ZEITEN
TITLE = DB_ZEITEN
NAME:DB_ZEITEN
VERSION:1.0

STRUCT
T_0_A1_FAULT\t:   S5TIME:=S5T#2000MS;\t//\tT Block 0 delay monitoring FS friction drive VFD Fault
Spare1\t:   INT;\t
END_STRUCT ;
BEGIN
END_DATA_BLOCK
"""


def test_fault_glossary_covers_commented_setpoint_members():
    chunks = ac.build_fault_glossary_chunks(TIMER_DB, source_file="00000002.AWL")
    assert len(chunks) == 1
    ch = chunks[0]
    assert "T_0_A1_FAULT" in ch.content
    assert "S5T#2000MS" in ch.content  # the setpoint value is the answer to "what's the delay"
    assert "delay monitoring FS friction drive VFD Fault" in ch.content
    assert "Spare1" not in ch.content  # uncommented member carries no maintenance text
    assert ch.metadata["block"] == "DB_ZEITEN"


def test_dispatch_routes_by_block_kind():
    # a logic FB with a commented BOOL VAR must still produce network chunks, not a glossary
    fb = LOGIC_FB.replace(
        "  ToDoLine : INT ;\t", "  ToDoLine : INT ;\t\n  Flag : BOOL ;\t// helper"
    )
    chunks = ac.build_chunks_for_file(fb, ride="Chima", station="2400wk00", source_file="f.AWL")
    assert chunks and all(c.chunk_type == "plc_block_network" for c in chunks)
    db = ac.build_chunks_for_file(FLT_DB, ride="Aquazone", station="206012_8", source_file="d.AWL")
    assert db and all(c.chunk_type == "plc_fault_glossary" for c in db)


# --- UNS paths (canonical builders only — .claude/rules/uns-compliance.md) ----------------------


def test_ride_uns_paths_come_from_canonical_builders():
    eq = ac.ride_uns_path("Technic Test Track", "2400WK0352")
    assert eq == "enterprise.legoland.site.florida.area.technic_test_track.equipment.2400wk0352"
    blk = ac.block_uns_path("Chima", "2400wk00", "DB_FAULTS")
    assert (
        blk == "enterprise.legoland.site.florida.area.chima.equipment.2400wk00.plc_block.db_faults"
    )


# --- knowledge_entries row shaping ---------------------------------------------------------------


def test_rows_are_private_deterministic_and_provenanced():
    chunks = ac.build_fault_glossary_chunks(ALARM_DB, source_file="00000001.AWL", uns_prefix="x.y")
    rows = ac.to_knowledge_entry_rows(chunks, tenant_id="11111111-1111-1111-1111-111111111111")
    assert len(rows) == 1
    row = rows[0]
    # tenant-scoping law: per-tenant upload rows MUST be private
    assert row["is_private"] is True
    assert row["tenant_id"] == "11111111-1111-1111-1111-111111111111"
    assert row["id"].startswith("awl_")
    assert row["embedding"] is None  # filled by the infra-gated embed step
    assert row["source_type"] == "legoland_awl"
    assert row["isa95_path"] == "x.y"
    assert row["source_url"] == "awl:00000001.AWL"
    assert "A1 VFD FAULT" in row["content"]
    # deterministic id: re-runs de-duplicate instead of duplicating
    rows2 = ac.to_knowledge_entry_rows(chunks, tenant_id="11111111-1111-1111-1111-111111111111")
    assert rows2[0]["id"] == row["id"]


# --- corpus tree walk ----------------------------------------------------------------------------


def _make_tree(tmp_path):
    """Synthetic corpus mirroring the T7 layout: <root>/<ride dir>/<station>/s7asrcom/<n>/<f>.AWL"""
    chima = tmp_path / "CHIMA_LEGOLAND_FLORIDA_2013_07_01" / "2400wk00" / "s7asrcom" / "00000003"
    chima.mkdir(parents=True)
    (chima / "00000001.AWL").write_text(ALARM_DB)
    (chima / "00000002.AWL").write_text(LOGIC_FB)
    # a second identical copy of the alarm DB, like the duplicated Aquazone export on the drive
    dup = tmp_path / "Aquazone" / "206012_8" / "s7asrcom" / "00000002"
    dup.mkdir(parents=True)
    (dup / "00000001.AWL").write_text(ALARM_DB)
    return tmp_path


def test_corpus_walk_grounds_chunks_to_ride_station_block(tmp_path):
    chunks = ac.build_corpus_chunks(_make_tree(tmp_path))
    glossary = [c for c in chunks if c.chunk_type == "plc_fault_glossary"]
    networks = [c for c in chunks if c.chunk_type == "plc_block_network"]
    assert len(glossary) == 2  # chima copy + aquazone duplicate (dedup happens at row ids)
    assert len(networks) == 2
    chima_glossary = next(c for c in glossary if "chima" in c.uns_path)
    assert chima_glossary.uns_path == (
        "enterprise.legoland.site.florida.area.chima.equipment.2400wk00.plc_block.db_faults"
    )
    # provenance: path relative to the corpus root
    assert chima_glossary.source_file.startswith("CHIMA_LEGOLAND_FLORIDA_2013_07_01/")
    aqua_glossary = next(c for c in glossary if "aquazone" in c.uns_path)
    assert ".area.aquazone.equipment.206012_8." in aqua_glossary.uns_path


def test_duplicate_content_dedups_at_row_level(tmp_path):
    chunks = ac.build_corpus_chunks(_make_tree(tmp_path))
    rows = ac.to_knowledge_entry_rows(chunks, tenant_id="t")
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids))
    # the two identical alarm DBs differ only by ride path -> DIFFERENT rows (uns is in the id),
    # but re-running the same tree adds nothing new
    assert len(rows) == len(ac.to_knowledge_entry_rows(chunks, tenant_id="t"))


def test_report_counts_and_names_empty_files(tmp_path):
    root = _make_tree(tmp_path)
    # a source that yields nothing (uncommented DB) must be REPORTED, not silently dropped
    (root / "Aquazone" / "206012_8" / "s7asrcom" / "00000002" / "00000009.AWL").write_text(
        'DATA_BLOCK "DB_EMPTY"\n  STRUCT\n   W0 : WORD ;\n  END_STRUCT ;\nBEGIN\nEND_DATA_BLOCK\n'
    )
    report = ac.build_report(root, tenant_id="t")
    assert report["files_scanned"] == 4
    assert report["chunks"]["plc_fault_glossary"] == 2
    assert report["chunks"]["plc_block_network"] == 2
    assert report["rows"] == 4
    assert set(report["rides"]) == {"chima", "aquazone"}
    assert report["files_empty"] == ["Aquazone/206012_8/s7asrcom/00000002/00000009.AWL"]
    assert report["sample"]  # a sample chunk content for eyeballing
