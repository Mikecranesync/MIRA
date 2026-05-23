# UNS Location Confirmation Gate

Before MIRA gives asset-specific troubleshooting guidance, live-signal interpretation, reset advice, wiring references, component recommendations, or fault reasoning, it MUST resolve and confirm the technician's current asset/component/fault context in the customer's asset/UNS namespace.

## Hard Rule
No confirmed namespace context, no troubleshooting.

## What requires the gate (asset-specific):
- "Why is this conveyor stopped?"
- "Is the PLC seeing this sensor?"
- "How many times did I flag it?"
- "Can I reset this fault?"
- "Where is this sensor wired?"
- Any question referencing a specific asset, component, fault, PLC tag, or live signal

## What does NOT require the gate (general/educational):
- "What is MQTT?"
- "What is a proximity switch?"
- "What does PNP mean?"
- "How does a VFD work?"

## Flow:
1. Detect asset-specific troubleshooting intent
2. Resolve candidate asset/component from context (QR, channel, thread, message text, photo, fault code)
3. Send confirmation message with proposed context
4. Wait for technician confirmation
5. Only after confirmation: create Troubleshooting Session and begin answering

## Even at high confidence, always confirm before troubleshooting.
