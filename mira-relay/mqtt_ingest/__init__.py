"""Lane 3 MQTT/Sparkplug ingest — a second transport into the ONE ingest pipeline.

A read-only MQTT subscriber that decodes Sparkplug B and lands tags into
``tag_events`` + ``live_signal_cache`` through ``tag_ingest.ingest_batch`` — the
exact pipeline the HTTP relay route uses. The custom HTTP relay remains the
bench/dev fallback; this is the preferred industrial path.

See docs/design/2026-06-23-lane3-mqtt-subscriber-design.md and
docs/runbooks/2026-06-28-sparkplug-mqtt-consumer.md.
"""
