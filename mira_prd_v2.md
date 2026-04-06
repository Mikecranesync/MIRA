# Mira HMI Co-Pilot — Product Requirements Document v2.0

**Project:** FactoryLM / Mira  
**Version:** 2.0 (Ignition-Native Architecture)  
**Author:** FactoryLM  
**Target Builder:** Claude Code CLI  
**Date:** 2026-03-31

---

## Executive Summary

Mira is an AI-powered industrial maintenance co-pilot that lives **natively inside Ignition Perspective** as a first-class project resource. It uses Ignition's own scripting engine, tag system, Web Dev module, and Gateway event scripts to monitor PLC state machines, detect deviations from normal operating patterns, and answer technician questions grounded in ingested maintenance documents — all without any external services visible to operators or IT.

A lightweight CPython sidecar (the RAG Engine) runs on the same machine as Ignition as a system service, handling the ML operations that Jython cannot perform. All user interaction happens through standard Perspective screens.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  IGNITION GATEWAY                        │
│                                                         │
│  Device Drivers (AB, Siemens, Modbus, OPC-UA, MQTT)     │
│  [configured by maintenance engineer — Mira reads all]  │
│            │                                            │
│     Tag Namespace [default]                             │
│     └── Mira_Monitored/                                 │
│         └── {asset_id}/   ← engineer puts tags here     │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │          WEB DEV MODULE (Mira App)           │       │
│  │  /system/webdev/FactoryLM/                   │       │
│  │  ├── mira/          → Chat UI (HTML/CSS/JS)  │       │
│  │  ├── api/chat       → doPost: RAG query      │       │
│  │  ├── api/alerts     → doGet:  recent anomalies│      │
│  │  ├── api/ingest     → doPost: document upload│       │
│  │  ├── api/status     → doGet:  system health  │       │
│  │  └── api/tags       → doGet:  tag browser    │       │
│  └──────────────────────────────────────────────┘       │
│                                                         │
│  Gateway Event Scripts                                  │
│  ├── Tag Change: [default]Mira_Monitored/*/State        │
│  │   → FSM transition checker → writes Mira_Alerts tags │
│  └── Timer (10s): FSM health + stuck-state checker      │
│                                                         │
│  Perspective Project                                    │
│  ├── Views/Mira/MiraPanel     → Chat + alert UI         │
│  ├── Views/Mira/MiraSettings  → Doc upload + config     │
│  └── Views/Mira/MiraAlerts    → Anomaly history         │
│                                                         │
└───────────────────┬─────────────────────────────────────┘
                    │ localhost:5000 (internal only)
                    │ urllib2 / http.client (Jython)
                    ▼
┌───────────────────────────────────────────┐
│         RAG SIDECAR (CPython 3.11)        │
│  Runs as Windows Service / systemd        │
│  Same machine as Ignition Gateway         │
│                                           │
│  POST /rag     → query ChromaDB + LLM     │
│  POST /ingest  → chunk + embed document   │
│  GET  /status  → health + doc count       │
└───────────────────────────────────────────┘
```

---

## 2. Reference Documentation

Claude Code CLI must read the following official references before building each component. All URLs are live Inductive Automation documentation.

### Ignition Scripting API (Jython — runs inside Gateway)

| Function | URL | Used In |
|----------|-----|---------|
| `system.tag.readBlocking()` | https://www.docs.inductiveautomation.com/docs/8.1/appendix/scripting-functions/system-tag/system-tag-readBlocking | All tag reads |
| `system.tag.writeBlocking()` | https://www.docs.inductiveautomation.com/docs/8.1/appendix/scripting-functions/system-tag/system-tag-writeBlocking | Alert tag writes |
| `system.tag.browseTags()` | https://www.docs.inductiveautomation.com/docs/8.1/appendix/scripting-functions/system-tag/system-tag-browseTags | Auto-discover tags in folder |
| `system.util.getLogger()` | https://www.docs.inductiveautomation.com/docs/8.1/appendix/scripting-functions/system-util/system-util-getLogger | All logging |
| `system.db.runQuery()` | https://www.docs.inductiveautomation.com/docs/8.1/appendix/scripting-functions/system-db/system-db-runQuery | FSM model persistence |
| `system.tag.queryTagHistory()` | https://www.docs.inductiveautomation.com/docs/8.1/appendix/scripting-functions/system-tag/system-tag-queryTagHistory | FSM baseline building |

### Web Dev Module

| Resource | URL |
|----------|-----|
| Web Dev overview + doGet/doPost reference | https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev |
| Building a simple web server (doGet + doPost examples) | https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/web-dev/simple-web-server |
| Web Dev (7.9 — additional doPost postData examples) | https://www.docs.inductiveautomation.com/docs/7.9/scripting/scripting-in-ignition/web-services-suds-and-rest/web-dev |

### Gateway Event Scripts

| Resource | URL |
|----------|-----|
| Gateway Event Scripts (Tag Change + Timer) | https://www.docs.inductiveautomation.com/docs/8.1/platform/scripting/scripting-in-ignition/gateway-event-scripts |
| Tag Change Script example | https://www.docs.inductiveautomation.com/docs/8.1/platform/scripting/scripting-examples/reading-and-writing-to-tags |

### Perspective Components

| Component | URL |
|-----------|-----|
| File Upload component + onFileReceived event | https://www.docs.inductiveautomation.com/docs/8.1/appendix/components/perspective-components/perspective-input-palette/perspective-file-upload-scripting |
| Download and Upload Files guide | https://www.docs.inductiveautomation.com/docs/8.1/appendix/components/perspective-components/perspective-input-palette/perspective-download-and-upload-files |
| Tag Providers reference | https://www.docs.inductiveautomation.com/docs/8.1/platform/tags/tag-providers |
| Types of Tags | https://www.docs.inductiveautomation.com/docs/8.1/platform/tags/types-of-tags |
| Tags overview (8.3) | https://www.docs.inductiveautomation.com/docs/8.3/platform/tags |

### IDE / Dev Tooling for Jython Scripts

| Resource | URL |
|----------|-----|
| ignition-api-8.1 (Python 2.7 stubs for IDE autocomplete) | https://github.com/ignition-devs/ignition-api-8.1 |
| Install: `python2 -m pip install ignition-api` | https://pypi.org/project/ignition-api-stubs/ |
| ignition-devs GitHub org (additional tools) | https://github.com/ignition-devs |

### SDK (for future .modl module — reference only, not required for v1)

| Resource | URL |
|----------|-----|
| Ignition SDK Programmer's Guide | https://www.sdk-docs.inductiveautomation.com/docs/intro |
| Create a Module guide | https://www.sdk-docs.inductiveautomation.com/docs/getting-started/create-a-module/ |
| SDK Example Modules (GitHub) | https://github.com/inductiveautomation/ignition-sdk-examples |
| SDK Training repo (Gradle) | https://github.com/inductiveautomation/ignition-sdk-training |
| Example Modules index | https://www.sdk-docs.inductiveautomation.com/docs/example-modules/ |
| Module signing guide | https://www.sdk-docs.inductiveautomation.com/docs/getting-started/create-a-module/module-signing |

### Version Control

| Resource | URL |
|----------|-----|
| Version and Source Control Guide (8.3) | https://www.docs.inductiveautomation.com/docs/8.3/tutorials/version-control-guide |

---

## 3. Developer Environment Setup

Before building, set up a local test environment:

1. **Install Ignition** (free trial — resets indefinitely for development):
   - Download: https://inductiveautomation.com/downloads
   - Runs at `http://localhost:8088`
   - Trial resets via: Gateway > Help > Licensing > Reset Trial

2. **Install Web Dev Module** in the Gateway:
   - Gateway > Config > Modules > Install or Upgrade a Module
   - Web Dev ships free with Ignition

3. **Install ignition-api stubs** for IDE autocomplete:
   ```bash
   python2 -m pip install ignition-api
   # OR for Python 3 IDE support:
   pip install ignition-api-stubs
   ```

4. **Connect Factory IO** for testing:
   - Factory IO: File > Drivers > OPC UA Client
   - URL: `opc.tcp://localhost:4096`
   - Discovery endpoint auto-finds Ignition tags

5. **RAG sidecar dependencies**:
   ```bash
   pip install fastapi uvicorn chromadb openai pypdf2 pdfplumber \
               python-docx pytesseract watchdog httpx
   ```

---

## 4. Jython Constraint Reference

Ignition's scripting environment is **Jython 2.7** (Python 2.7 running on the JVM). Claude Code CLI must follow these rules for all Web Dev and Gateway scripts:

| Constraint | Rule |
|-----------|------|
| Python version | 2.7 syntax only — no f-strings, no `async/await`, no walrus operator |
| String formatting | Use `%s` or `.format()` — NOT f-strings |
| HTTP client | Use `urllib2` for outbound HTTP — NOT `requests` or `httpx` |
| JSON | `import json` works — use `json.loads()` and `json.dumps()` |
| Type hints | Not supported — omit all type annotations |
| Print | Use `print "string"` or `print("string")` — both work in Jython 2.7 |
| ML libraries | NOT available — chromadb, sentence-transformers, openai SDK do NOT work in Jython |
| Available imports | `java.*`, `com.inductiveautomation.*`, standard Python 2.7 stdlib |
| Logging | Always use `system.util.getLogger("FactoryLM.Mira")` — never `print` in production |

All ML/RAG operations go through the CPython RAG Sidecar via `urllib2` HTTP calls.

---

## 5. Component Specifications

### 5.1 Web Dev Module — Mira App Resources

All resources created in Ignition Designer > Project Browser > Web Dev > FactoryLM.

#### `GET /system/webdev/FactoryLM/mira` — Chat UI

Returns the full Mira chat interface HTML page.

**`doGet` handler (Jython):**
```python
def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.UI")
    asset_id = request.get('params', {}).get('asset', '')
    alarm_msg = request.get('params', {}).get('alarm', '')
    # Read static HTML from Gateway file store or return inline
    html = buildMiraChatHTML(asset_id, alarm_msg)
    return {'html': html, 'headers': {'Content-Type': 'text/html'}}
```

**UI requirements (HTML/CSS/JS — returned inline or from file):**
- Dark industrial theme: `#0d0d0d` background, `#161616` surface, `#00b4a6` teal for Mira messages
- Chat history scrolls up, input fixed to bottom
- Each response shows answer + collapsible source citations (`[filename — page N]`)
- URL params `?asset=X&alarm=Y` auto-inject context into first message
- Right sidebar (collapsible): live alert feed, auto-refreshes every 10s via `fetch('/system/webdev/FactoryLM/api/alerts?asset=X')`
- `postMessage` listener for Perspective context injection:
  ```javascript
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'MIRA_CONTEXT') {
      injectContext(e.data.assetId, e.data.alarm, e.data.tagPath);
    }
  });
  ```
- No localStorage or sessionStorage (sandboxed)
- Mobile-responsive minimum 375px width (tablet use in plants)

#### `POST /system/webdev/FactoryLM/api/chat` — RAG Query Handler

**`doPost` handler (Jython):**
```python
def doPost(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Chat")
    data = request['postData']  # dict when Content-Type is application/json
    query = data.get('query', '')
    asset_id = data.get('asset_id', '')
    
    # Read live tag snapshot for this asset
    tag_folder = "[default]Mira_Monitored/" + asset_id + "/"
    tag_results = system.tag.browseTags(parentPath=tag_folder, tagType="OPC")
    tag_paths = [str(t.fullPath) for t in tag_results]
    tag_values = system.tag.readBlocking(tag_paths)
    
    snapshot = {}
    for i, path in enumerate(tag_paths):
        snapshot[path] = {
            'value': str(tag_values[i].value),
            'quality': str(tag_values[i].quality)
        }
    
    # Forward to RAG sidecar
    import urllib2, json
    payload = json.dumps({
        'query': query,
        'asset_id': asset_id,
        'tag_snapshot': snapshot,
        'context': data.get('context', '')
    })
    req = urllib2.Request(
        'http://localhost:5000/rag',
        payload,
        {'Content-Type': 'application/json'}
    )
    response = urllib2.urlopen(req, timeout=30)
    result = json.loads(response.read())
    
    logger.info("Chat query for asset %s: %s" % (asset_id, query[:80]))
    return {'json': result}
```

#### `POST /system/webdev/FactoryLM/api/ingest` — Document Upload Handler

**`doPost` handler (Jython):**
- Receives file bytes from Perspective File Upload component (called via Perspective script, not direct browser POST)
- Saves file to Gateway-accessible path: `{ignition_install}/data/factorylm/docs/{asset_id}/`
- Forwards to RAG sidecar: `POST http://localhost:5000/ingest`
- Returns `{'json': {'status': 'queued', 'filename': filename}}`

#### `GET /system/webdev/FactoryLM/api/alerts` — Recent Anomaly Feed

**`doGet` handler (Jython):**
- Query param: `?asset=conveyor_3&limit=20`
- Reads from Ignition internal database table `mira_anomalies` via `system.db.runQuery()`
- Returns `{'json': {'alerts': [...]}}`

#### `GET /system/webdev/FactoryLM/api/tags` — Tag Browser

**`doGet` handler (Jython):**
- Query param: `?folder=[default]Mira_Monitored/conveyor_3`
- Uses `system.tag.browseTags(parentPath=folder)` to return available tags
- Used by Mira Settings screen to show what's being monitored

#### `GET /system/webdev/FactoryLM/api/status` — Health Check

**`doGet` handler (Jython):**
- Checks RAG sidecar via `urllib2.urlopen('http://localhost:5000/status')`
- Returns: `{'json': {'gateway': 'ok', 'rag_sidecar': 'ok'|'error', 'doc_count': N, 'monitored_assets': [...]}}`

---

### 5.2 Gateway Tag Change Script — FSM Monitor

Configured in Designer > Gateway Event Scripts > Tag Change Scripts.

**Tag path to watch:** `[default]Mira_Monitored/*/State`  
(wildcard — watches State tag for every asset under Mira_Monitored)

```python
# Gateway Tag Change Script
# Fires on every change to any Mira_Monitored/{asset}/State tag
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/platform/scripting/scripting-in-ignition/gateway-event-scripts

logger = system.util.getLogger("FactoryLM.Mira.FSMMonitor")

def valueChanged(tag, tagPath, previousValue, currentValue, initialChange, missedEvents):
    if initialChange:
        return
    
    # Extract asset_id from tag path: [default]Mira_Monitored/conveyor_3/State
    parts = str(tagPath).replace('[default]', '').strip('/').split('/')
    if len(parts) < 2:
        return
    asset_id = parts[1]
    
    from_state = str(previousValue.value)
    to_state = str(currentValue.value)
    
    # Calculate transition time
    import sys
    prev_ts = previousValue.timestamp
    curr_ts = currentValue.timestamp
    delta_ms = (curr_ts.getTime() - prev_ts.getTime())
    
    # Load FSM model from database
    fsm_json = system.db.runScalarQuery(
        "SELECT model_json FROM mira_fsm_models WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1",
        [asset_id]
    )
    
    if not fsm_json:
        logger.debug("No FSM model for asset %s — skipping anomaly check" % asset_id)
        return
    
    import json
    fsm = json.loads(fsm_json)
    
    # Check transition validity
    anomaly = None
    transitions = fsm.get(from_state, {})
    
    if to_state not in transitions:
        anomaly = {
            'type': 'FORBIDDEN_TRANSITION',
            'severity': 'CRITICAL',
            'asset_id': asset_id,
            'from_state': from_state,
            'to_state': to_state,
            'message': 'Transition %s -> %s not in learned FSM model' % (from_state, to_state)
        }
    else:
        envelope = transitions[to_state]
        if not envelope.get('is_accepting', False):
            mean_ms = envelope.get('mean_ms', 0)
            stddev_ms = envelope.get('stddev_ms', 1)
            n_sigma = 2.5  # configurable
            if stddev_ms > 0:
                sigma = abs(delta_ms - mean_ms) / stddev_ms
                if sigma > n_sigma:
                    anomaly = {
                        'type': 'TIMING_DEVIATION',
                        'severity': 'CRITICAL' if sigma > 5.0 else 'WARNING',
                        'asset_id': asset_id,
                        'from_state': from_state,
                        'to_state': to_state,
                        'expected_ms': mean_ms,
                        'actual_ms': delta_ms,
                        'sigma': sigma,
                        'message': 'Transition time %.0fms vs expected %.0fms (%.1f sigma)' % (delta_ms, mean_ms, sigma)
                    }
    
    if anomaly:
        # Write to Memory tag for Perspective alert panel
        anomaly_tag = "[default]Mira_Alerts/%s/Latest" % asset_id
        system.tag.writeBlocking([anomaly_tag], [json.dumps(anomaly)])
        
        # Persist to database
        system.db.runPrepUpdate(
            """INSERT INTO mira_anomalies 
               (asset_id, detection_type, severity, from_state, to_state, 
                expected_ms, actual_ms, sigma, message, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())""",
            [asset_id, anomaly['type'], anomaly['severity'], from_state, to_state,
             anomaly.get('expected_ms', 0), anomaly.get('actual_ms', 0),
             anomaly.get('sigma', 0), anomaly['message']]
        )
        logger.warn("ANOMALY [%s] %s: %s" % (anomaly['severity'], asset_id, anomaly['message']))
```

---

### 5.3 Gateway Timer Script — Stuck State + FSM Builder Trigger

Configured in Designer > Gateway Event Scripts > Timer Scripts.

**Timer 1 — Stuck State Checker (every 10 seconds):**
```python
# Checks all monitored assets for stuck states
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/platform/scripting/scripting-in-ignition/gateway-event-scripts

logger = system.util.getLogger("FactoryLM.Mira.StuckState")
STUCK_MULTIPLIER = 3.0

def runScript():
    assets = system.tag.browseTags(parentPath="[default]Mira_Monitored", tagType="Folder")
    for asset in assets:
        asset_id = str(asset.name)
        state_path = "[default]Mira_Monitored/%s/State" % asset_id
        
        qv = system.tag.readBlocking([state_path])[0]
        if qv.quality.isGood():
            current_state = str(qv.value)
            state_since = qv.timestamp
            
            import java.util.Date as Date
            now_ms = Date().getTime()
            dwell_ms = now_ms - state_since.getTime()
            
            # Check against FSM model max dwell time
            import json, sys
            fsm_json = system.db.runScalarQuery(
                "SELECT model_json FROM mira_fsm_models WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1",
                [asset_id]
            )
            if fsm_json:
                fsm = json.loads(fsm_json)
                for next_state, envelope in fsm.get(current_state, {}).items():
                    max_ms = envelope.get('max_ms', 0)
                    if max_ms > 0 and dwell_ms > (max_ms * STUCK_MULTIPLIER):
                        anomaly_tag = "[default]Mira_Alerts/%s/Latest" % asset_id
                        msg = json.dumps({
                            'type': 'STUCK_STATE',
                            'severity': 'CRITICAL',
                            'asset_id': asset_id,
                            'current_state': current_state,
                            'dwell_ms': dwell_ms,
                            'max_ms': max_ms,
                            'message': 'Asset stuck in state %s for %.1fs (max %.1fs)' % (
                                current_state, dwell_ms/1000.0, max_ms/1000.0)
                        })
                        system.tag.writeBlocking([anomaly_tag], [msg])
                        logger.warn("STUCK STATE [%s]: %s" % (asset_id, msg))
                        break
```

**Timer 2 — FSM Baseline Builder (every hour, runs if < 50 cycles logged):**
- Check cycle count in `mira_fsm_models` table
- If asset has > 50 cycles and no model: call RAG sidecar `POST http://localhost:5000/build_fsm`
- RAG sidecar queries `system.tag.queryTagHistory()` equivalent via its own Ignition REST API call

---

### 5.4 Perspective Project Structure

Create in Designer > Perspective > Views:

```
Views/
└── Mira/
    ├── MiraPanel/          ← Main chat + alerts (add to any existing screen)
    │   ├── Embedded View   → URL: /system/webdev/FactoryLM/mira?asset={params.assetId}
    │   └── Alert Badge     → reads [default]Mira_Alerts/{assetId}/Latest
    │
    ├── MiraSettings/       ← Document upload + tag folder config
    │   ├── File Upload component (onFileReceived → Gateway script)
    │   ├── Tag browser list (reads /system/webdev/FactoryLM/api/tags)
    │   └── FSM status table
    │
    └── MiraAlertHistory/   ← Full anomaly log table
        └── Table component → reads /system/webdev/FactoryLM/api/alerts
```

**File Upload `onFileReceived` Perspective script:**
```python
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/appendix/components/perspective-components/perspective-input-palette/perspective-file-upload-scripting
filename = event.file.name
asset_id = self.getSibling("AssetSelector").props.value

# Save to Gateway filesystem
save_path = system.util.getProperty("user.dir") + "/data/factorylm/docs/" + asset_id + "/" + filename
event.file.copyTo(save_path)

# Trigger ingest via Web Dev API
import system.net
result = system.net.httpPost(
    "http://localhost:8088/system/webdev/FactoryLM/api/ingest",
    {"Content-Type": "application/json"},
    '{"filename": "%s", "asset_id": "%s", "path": "%s"}' % (filename, asset_id, save_path)
)
```

---

### 5.5 RAG Sidecar — `rag_sidecar.py` (CPython 3.11)

Runs as a Windows Service (NSSM) or systemd service on the same machine as Ignition. Listens on `localhost:5000` only — never exposed externally.

**File:** `rag_sidecar.py`

**Endpoints:**

`POST /rag` — Query ChromaDB and generate LLM response
```python
@app.post("/rag")
async def rag_query(body: RagRequest):
    # 1. Build filter: asset_id if provided
    where = {"asset_id": body.asset_id} if body.asset_id else None
    
    # 2. Retrieve top-5 chunks from ChromaDB
    results = collection.query(
        query_texts=[body.query],
        n_results=5,
        where=where
    )
    
    # 3. Build context string with tag snapshot
    context_parts = []
    for doc, meta in zip(results['documents'][0], results['metadatas'][0]):
        context_parts.append("[%s p.%s] %s" % (meta['source_file'], meta.get('page','?'), doc))
    
    tag_context = "\n".join(["%s = %s" % (k, v['value']) for k, v in body.tag_snapshot.items()])
    
    # 4. Call LLM
    prompt = SYSTEM_PROMPT + "\n\nCurrent tag values:\n" + tag_context
    prompt += "\n\nRelevant documentation:\n" + "\n\n".join(context_parts)
    prompt += "\n\nQuestion: " + body.query
    
    response = openai_client.chat.completions.create(
        model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=800
    )
    
    sources = [{"file": m['source_file'], "page": m.get('page','?'),
                "excerpt": d[:200]} 
               for d, m in zip(results['documents'][0], results['metadatas'][0])]
    
    return {"answer": response.choices[0].message.content, "sources": sources}
```

`POST /ingest` — Chunk and embed a document
- Accepts `{"filename": str, "asset_id": str, "path": str}`
- Parse PDF/DOCX/TXT at `path`
- Chunk at 512 tokens with 64-token overlap
- Embed with `text-embedding-3-small` or local `nomic-embed-text` via Ollama
- Store in ChromaDB with metadata: `{source_file, page, asset_id, chunk_index, ingested_at}`
- Return `{"status": "ok", "chunks_added": N}`

`POST /build_fsm` — Build FSM model from tag history
- Accepts `{"asset_id": str, "tag_history": [StateVector]}`
- Compute state transition table with timing envelopes
- Mark accepting states (stddev > 3x mean stddev)
- Flag rare transitions (< 0.5% frequency)
- Return FSM JSON to be stored by Ignition via `system.db.runPrepUpdate()`

`GET /status` — Health check
- Returns `{"status": "ok", "doc_count": N, "model": "gpt-4o-mini", "chroma_path": str}`

**`install_service_windows.bat`** — NSSM installer script:
```bat
nssm install MiraRAG python rag_sidecar.py
nssm set MiraRAG AppDirectory C:\FactoryLM
nssm set MiraRAG AppEnvironmentExtra OPENAI_API_KEY=%OPENAI_API_KEY%
nssm start MiraRAG
```

**`install_service_linux.sh`** — systemd installer:
```bash
# Creates /etc/systemd/system/mira-rag.service and enables on boot
```

---

### 5.6 Database Schema

Stored in Ignition's internal database (or a configured external DB). Create via Designer > Database > Query Browser or via startup script.

```sql
-- FSM learned models
CREATE TABLE IF NOT EXISTS mira_fsm_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL,
    model_json TEXT NOT NULL,
    cycle_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Anomaly event log
CREATE TABLE IF NOT EXISTS mira_anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL,
    detection_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    expected_ms REAL,
    actual_ms REAL,
    sigma REAL,
    message TEXT,
    acknowledged INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat session history
CREATE TABLE IF NOT EXISTS mira_chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT,
    query TEXT NOT NULL,
    answer TEXT NOT NULL,
    sources_json TEXT,
    operator TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. Tag Namespace Convention

Maintenance engineer creates this structure in Ignition Designer. Mira auto-discovers everything inside it.

```
[default]
└── Mira_Monitored/
    ├── conveyor_3/
    │   ├── State           ← INT: explicit state ID (0=idle,1=running,2=fault...)
    │   ├── Sensor_Entry    ← BOOL
    │   ├── Sensor_Exit     ← BOOL
    │   ├── Motor_Belt_Run  ← BOOL
    │   ├── EStop_Active    ← BOOL
    │   ├── Motor_Current_A ← FLOAT
    │   └── Cycle_Counter   ← INT
    └── press_station_1/
        ├── State
        ├── ...

[default]
└── Mira_Alerts/
    ├── conveyor_3/
    │   └── Latest          ← STRING (JSON): latest anomaly event
    └── press_station_1/
        └── Latest
```

The `Mira_Alerts` tags are **Memory tags** created by Mira — they feed the alert badge and alert panel in Perspective without any database query.

---

## 7. Environment Configuration

All configuration in `factorylm.properties` file in `{ignition_install}/data/factorylm/`:

```properties
# RAG Sidecar
RAG_SIDECAR_URL=http://localhost:5000
RAG_SIDECAR_TIMEOUT_MS=30000

# LLM
OPENAI_API_KEY=
LLM_MODEL=gpt-4o-mini
USE_LOCAL_LLM=false
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Embedding
USE_LOCAL_EMBEDDING=false
OLLAMA_EMBED_MODEL=nomic-embed-text

# Detection thresholds
FSM_N_SIGMA=2.5
FSM_STUCK_MULTIPLIER=3.0
FSM_RARE_THRESHOLD=0.005
FSM_ALERT_RATE_LIMIT_SECONDS=60
FSM_MIN_BASELINE_CYCLES=50

# Storage
DOCS_BASE_PATH={ignition_install}/data/factorylm/docs
CHROMA_PATH={ignition_install}/data/factorylm/chroma
```

Jython scripts read this file via:
```python
import java.io.FileInputStream as FileInputStream
import java.util.Properties as Properties
props = Properties()
props.load(FileInputStream("/path/to/factorylm.properties"))
api_key = props.getProperty("OPENAI_API_KEY")
```

---

## 8. File Structure

```
factorylm-mira/
├── README.md
├── INSTALL.md                    ← Step-by-step for maintenance engineers
│
├── ignition/                     ← Import into Ignition Designer
│   ├── webdev/
│   │   └── FactoryLM/
│   │       ├── mira/
│   │       │   └── doGet.py      ← Chat UI handler
│   │       └── api/
│   │           ├── chat/doPost.py
│   │           ├── alerts/doGet.py
│   │           ├── ingest/doPost.py
│   │           ├── tags/doGet.py
│   │           └── status/doGet.py
│   │
│   ├── gateway-scripts/
│   │   ├── tag-change-fsm-monitor.py
│   │   ├── timer-stuck-state.py
│   │   └── timer-fsm-builder.py
│   │
│   ├── perspective/
│   │   ├── MiraPanel.view.json
│   │   ├── MiraSettings.view.json
│   │   └── MiraAlertHistory.view.json
│   │
│   ├── tags/
│   │   └── Mira_Alerts_template.json  ← Memory tag structure to import
│   │
│   └── db/
│       └── schema.sql
│
├── rag_sidecar/
│   ├── rag_sidecar.py
│   ├── requirements.txt
│   ├── install_service_windows.bat
│   ├── install_service_linux.sh
│   └── .env.example
│
└── tests/
    ├── test_fsm_logic.py           ← Unit tests (CPython)
    ├── test_rag_sidecar.py
    └── test_webdev_handlers.py     ← Mock Jython environment
```

---

## 9. Testing with Factory IO

**Setup (one time):**
1. Open Factory IO → Sorting by Height scene (conveyor with divert)
2. Drivers → OPC UA Client → `opc.tcp://localhost:4096` → Connect
3. Map signals: Entry Sensor, Exit Sensor, Belt, Divert → drag to Ignition tags under `Mira_Monitored/conveyor_demo/`
4. Add `State` memory tag, configure Ignition expression tag: `if({Belt} && {Entry_Sensor}, 1, if({Belt} && !{Entry_Sensor}, 2, 0))`

**Baseline collection:**
1. Run Factory IO for 30 minutes normal operation
2. Trigger `POST http://localhost:5000/build_fsm` with asset_id `conveyor_demo`
3. Verify `mira_fsm_models` table has a row for `conveyor_demo`

**Anomaly injection test:**
1. In Factory IO, reduce belt speed to 30% (simulates belt slip)
2. Within 60 seconds, verify `TIMING_DEVIATION` anomaly appears in `[default]Mira_Alerts/conveyor_demo/Latest`
3. Open Mira chat panel in Perspective, verify anomaly auto-populates context
4. Ask "What is causing the conveyor timing deviation?"
5. Verify answer cites uploaded SOP document with page number

---

## 10. MVP Acceptance Criteria

| # | Requirement | Pass Condition |
|---|------------|----------------|
| 1 | Web Dev routes | All 5 endpoints return HTTP 200 with correct Content-Type |
| 2 | Tag auto-discovery | `browseTags()` returns all tags under `Mira_Monitored/{asset}` folder |
| 3 | Tag read | `readBlocking()` returns good-quality values for all Factory IO tags |
| 4 | Perspective embed | Mira chat panel loads inside Perspective Embedded View at correct URL |
| 5 | File upload | PDF dropped via Perspective File Upload component ingested within 30s |
| 6 | RAG answer | Chat response to maintenance question cites source doc + page |
| 7 | FSM baseline | `build_fsm` produces valid transition table after 50 Factory IO cycles |
| 8 | Tag change script | Script fires on every State tag change (verify via Gateway logs) |
| 9 | Timing deviation | Slowed Factory IO belt triggers TIMING_DEVIATION within 60s |
| 10 | Stuck state | Paused Factory IO triggers STUCK_STATE within 30s (3x max dwell) |
| 11 | Alert in Perspective | Anomaly tag write updates alert badge in Perspective without page refresh |
| 12 | RAG sidecar service | Sidecar starts on boot, accessible at localhost:5000 after machine restart |
| 13 | Local LLM fallback | Setting `USE_LOCAL_LLM=true` routes to Ollama with no code change |

---

## 11. Build Order for Claude Code CLI

Build in this exact sequence — each step is independently testable:

1. **RAG sidecar skeleton** — `rag_sidecar.py` with `/status` endpoint only. Verify it starts.
2. **Document ingestion** — add `/ingest` endpoint. Test with a sample PDF. Verify ChromaDB populated.
3. **RAG query** — add `/rag` endpoint. Test with a plain query against ingested doc. Verify citations returned.
4. **FSM builder** — add `/build_fsm` endpoint with mock StateVector input. Verify JSON model output.
5. **Service installers** — `install_service_windows.bat` and `install_service_linux.sh`.
6. **Database schema** — `schema.sql`. Run in Ignition query browser to create tables.
7. **Web Dev: `/api/status`** — simplest doGet. Verify route works from browser.
8. **Web Dev: `/api/chat`** — doPost calling RAG sidecar. Test via curl before UI.
9. **Web Dev: `/api/ingest`** — doPost receiving file path from Perspective.
10. **Web Dev: `/api/alerts`** and **`/api/tags`** — read-only doGet handlers.
11. **Web Dev: `/mira` chat UI** — full HTML/CSS/JS returned by doGet. Test in browser standalone.
12. **Gateway Tag Change Script** — FSM monitor. Test firing via Gateway logs.
13. **Gateway Timer Scripts** — stuck state checker + FSM builder trigger.
14. **Perspective Views** — MiraPanel, MiraSettings, MiraAlertHistory JSON view files.
15. **File Upload script** — onFileReceived Perspective event script.
16. **End-to-end test** — full Factory IO integration test per Section 9.
17. **INSTALL.md** — step-by-step for maintenance engineers with no Python knowledge.

---

## 12. Out of Scope — v1.0

- Native `.modl` module (v2 — SDK refs provided in Section 2 for future build)
- CMMS API write-back (v2)
- Multi-site / multi-tenant architecture (v3)
- Vision / camera anomaly detection
- PLC write / control commands (Mira is read-only in v1)
- User authentication beyond Ignition's existing session (v1 inherits Ignition auth)
- Rare transition spike detection (implement after timing + stuck state are stable)

