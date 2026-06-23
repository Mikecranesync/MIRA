====================================================================
IGNITION EXPORT INTERROGATION
source: discovery_corpus/fixtures/synthetic_factory_export.json
====================================================================
topology: 1 enterprise / 1 site / 2 area / 2 line / 3 asset / 25 signal
signals carrying an engineering unit: 10

hierarchy (area -> line -> assets):
  Bottling
    BottlingLine1: CapLoader01, Filler01
  Liquid Processing
    TankFarm1: Tank01

signal archetype histogram:
  static_metadata      7  ###########
  live_bool            6  #########
  live_counter         3  ####
  live_state           4  ######
  live_analog          5  ########
  unknown              0  

asset family verdict:
  CapLoader01              discrete_mes
  Filler01                 discrete_mes
  Tank01                   continuous_process
====================================================================

reproducible claims (each backed by an executable check):
  [PASS] C1: This data is MES/OEE-shaped, not PLC-control-shaped
        evidence: namespace_nodes=34, has_control_logic=False, assets_with_mes_markers=3, has_production_run=True, all_signal_data_types_empty=True
  [PASS] C2: This contains production counts and state fields
        evidence: live_counter_signals=3, live_state_signals=4, has_counts_names=True, has_state_names=True
  [PASS] C3: This implies an asset/line/cell hierarchy
        evidence: enterprise=1, site=1, area=2, line=2, asset=3
  [PASS] C4: This does NOT contain ladder/ST/control logic
        evidence: controllers=0, routines=0
  [PASS] C5: This can be used as upstream evidence to infer hidden maintenance/component causes
        evidence: exposes_blocked=True, exposes_starved=True, exposes_counts=True, exposes_state=True
