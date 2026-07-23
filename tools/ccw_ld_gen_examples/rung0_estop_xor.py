"""Rung 0 from Mira/plc/MIRA_Ladder_Program.md — E-stop dual-channel XOR.

This is the *input* representation the (not-yet-built) LD generator will consume.
The output format (the `.isaxch` body shape) is unknown until Step 2-3 of the
experiment populates wiki/references/ccw-ld-isaxch-schema.md.

The exact field names below are placeholders and will be revised once the LD
schema is captured. Treat this as a sketch of the abstraction, not a contract.
"""

# Source spec from MIRA_Ladder_Program.md:
#
#      _IO_EM_DI_02    _IO_EM_DI_03              xor_ok
#   +--[ ]-------------[/]------------+--( )--
#   |                                 |
#   +--[/]-------------[ ]------------+
#      _IO_EM_DI_02    _IO_EM_DI_03
#
# Branch 1: XIC _IO_EM_DI_02, XIO _IO_EM_DI_03
# Branch 2: XIO _IO_EM_DI_02, XIC _IO_EM_DI_03
# Output:   OTE xor_ok

rung0_estop_xor = {
    "comment": "E-stop dual-channel XOR: TRUE when contacts are complementary (wiring OK)",
    "elements": [
        {
            "type": "parallel",
            "branches": [
                [
                    {"type": "XIC", "variable": "_IO_EM_DI_02"},
                    {"type": "XIO", "variable": "_IO_EM_DI_03"},
                ],
                [
                    {"type": "XIO", "variable": "_IO_EM_DI_02"},
                    {"type": "XIC", "variable": "_IO_EM_DI_03"},
                ],
            ],
        },
        {"type": "OTE", "variable": "xor_ok"},
    ],
}
