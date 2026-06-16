# Open WebUI Model Routing Architecture

> **Version:** Open WebUI v0.8.10 | **Updated:** 2026-04-12

How Open WebUI decides which backend processes a chat message.

## Model Routing Priority

When a user sends a message, Open WebUI resolves the model ID and routes based on this priority:

```
1. Function (pipe)     — if model has "pipe" attribute → generate_function_chat_completion()
2. Ollama              — if model.owned_by == "ollama" → generate_ollama_chat_completion()
3. External OpenAI API — else → generate_openai_chat_completion() → OPENAI_API_BASE_URLS
```

**Key file:** `utils/chat.py:260-290`

```python
if model.get("pipe"):
    return await generate_function_chat_completion(request, form_data, user=user, models=models)
if model.get("owned_by") == "ollama":
    form_data = convert_payload_openai_to_ollama(form_data)
    response = await generate_ollama_chat_completion(...)
else:
    return await generate_openai_chat_completion(...)
```

## How Models Are Discovered

Three sources, merged in this order (`utils/models.py:77`):

```python
return function_models + openai_models + ollama_models
```

**Functions come first.** If a Function ID matches an external API model ID, the Function wins.

### 1. Functions (Pipe Type)

Python code stored in Open WebUI's SQLite database (`webui.db`, `function` table).
Active pipe functions are loaded at startup and registered as models with a `"pipe"` attribute.

**Key file:** `functions.py:78-155` (`get_function_models()`)

Check registered functions:
```bash
docker exec <container> python3 -c "
import sqlite3
db = sqlite3.connect('/app/backend/data/webui.db')
for r in db.execute('SELECT id, name, type, is_active FROM function').fetchall():
    print(r)
"
```

### 2. External OpenAI APIs

Configured via environment variables:

```yaml
OPENAI_API_BASE_URLS=http://mira-pipeline:9099/v1    # semicolon-separated for multiple
OPENAI_API_KEYS=${PIPELINE_API_KEY:-}                  # matching keys, semicolon-separated
```

Models discovered via `GET /v1/models` on each configured URL.
Each model gets a `urlIdx` that maps back to the correct base URL.

**Key file:** `routers/openai.py:936-1120` (`generate_chat_completion`)

### 3. Ollama

Configured via `OLLAMA_BASE_URL`. Models discovered via Ollama API.

## Image Processing Flow

When a user uploads an image in the browser:

```
1. Frontend uploads file      → POST /api/v1/files/?process=false → file stored in backend
2. Message sent with file ref → POST /api/chat/completions (with files array in message)
3. process_chat_payload()     → Loads messages from DB
                               → Injects image files as image_url parts (middleware.py:2165-2181)
                               → convert_url_images_to_base64() converts HTTP URLs to data: URIs
4. Payload sent to backend    → Images are data:image/...;base64,... format
```

**Key file:** `utils/middleware.py:2144` (`process_chat_payload`)

The `convert_url_images_to_base64` function (line 2062) fetches images from internal URLs
and converts them to `data:content_type;base64,encoded_string` format before the payload
reaches the model backend.

**Note:** `process_chat_payload` only runs when the request comes through the main
`/api/chat/completions` endpoint in `main.py`. Direct API calls to the OpenAI router
(`/openai/chat/completions`) bypass this processing.

## MIRA Pipeline Connection

Our `mira-pipeline` container exposes an OpenAI-compatible API on port 9099:
- `GET /v1/models` returns `mira-diagnostic`
- `POST /v1/chat/completions` processes through GSDEngine

Open WebUI connects via:
```yaml
OPENAI_API_BASE_URLS=http://mira-pipeline:9099/v1
OPENAI_API_KEYS=${PIPELINE_API_KEY:-}
DEFAULT_MODELS=mira-diagnostic
```

## Gotchas

### Function Name Collision
If a Function ID matches an external model ID, the Function wins (priority 1 vs 3).
**Always check the `function` table** in webui.db when debugging routing issues.

Disable a conflicting function:
```bash
docker exec <container> python3 -c "
import sqlite3
db = sqlite3.connect('/app/backend/data/webui.db')
db.execute('UPDATE function SET is_active = 0 WHERE id = ?', ('function_id',))
db.commit()
"
docker restart <container>
```

### OPENAI_API_CONFIGS Bug
`OPENAI_API_CONFIGS` env var is broken in v0.8.x (GitHub issue #19017).
Use `OPENAI_API_BASE_URLS` (legacy format) instead.

### User Field Not Set for External Models
Open WebUI only populates `payload["user"]` for models flagged as `pipeline: True`
(`routers/openai.py:1035-1041`). External API models discovered via `/v1/models`
don't get this flag, so `user` is always None.

Workaround: Accept `user` as `str | dict | None` and fall back to `metadata.chat_id`.

### Branding Suffix
Open WebUI appends `" (Open WebUI)"` to custom `WEBUI_NAME` values
(`env.py:136-137`). Patch with entrypoint script:
```bash
sed -i 's/WEBUI_NAME += " (Open WebUI)"/pass/' /app/backend/open_webui/env.py
```

### Settings Persistence
Environment variables like `ENABLE_SIGNUP`, `DEFAULT_USER_ROLE` are only defaults
on first startup. After that, the value in webui.db takes precedence. Use the
admin API to change at runtime:
```
POST /api/v1/auths/admin/config
```
