# Registering MIRA Tools in Open WebUI

## Steps

1. Open Open WebUI → Admin Panel → Settings → Tools
2. Click **Add Tool**
3. Set URL: `http://mira-mcpo:8000/mira-mcp`
4. Set API Key: `mira-mcpo-2026`
5. Click Save — you should see 4 tools discovered

## ⚠️ Important: Tool Calling Mode

In Admin Panel → Settings → Models → mira:
- Set tool calling to **Default Mode**
- Do NOT use Native Mode — qwen2.5 does not support native tool calling format

## Test Prompt

After registering, open a new chat with the MIRA model and send:

> What's wrong with the air compressor?

MIRA should call `list_active_faults` and `get_equipment_status` automatically and return real data from mira.db.
