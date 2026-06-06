# AskMira Deploy Recipe (Mike Hands-on)

**Generated:** 2026-06-06
**Source branch:** `Mikecranesync/MIRA_PLC@feat/ask-mira-ignition-hmi`
**Target:** PLC laptop Ignition Gateway `http://100.72.2.99:8088` (Tailscale: `laptop-0ka3c70h`)
**Backend already healthy:** `http://100.68.120.99:8011/ask` (Tailscale: `factorylm-prod`) — Gate 4 smoke logged in `docs/demos/_audit/askmira-deploy-session-2026-06-06.md`.

## Why this doc exists

The original `APPLY.ps1` deploy script on `feat/ask-mira-ignition-hmi` only deploys the Conveyor view + tag definitions. It does **not** include the AskMira view. The view file is in the branch, but the deploy automation skips it. The project import zip (`ConvSimpleLive_PE01_import.zip`) also lacks it. So the deploy must be done by hand via Ignition Designer Launcher.

## Pre-flight (already green)

- Gateway reachable from travel laptop: `curl -o /dev/null -w "%{http_code}" http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive` → 200.
- Backend health: `curl http://100.68.120.99:8011/health` → `{"status":"ok","platform":"ignition"}`.
- Auth: gate intentionally disabled (`X-Mira-Key: ""` on both ends).

## Deploy Steps

### 1. Launch Designer

```powershell
& "C:\Program Files\Inductive Automation\Designer Launcher\designerlauncher.exe"
```

Connect to `http://100.72.2.99:8088`. Log in with Gateway admin credentials (NOT Windows password).

### 2. Create the AskMira folder + view

In **Project Browser**, open project `ConvSimpleLive` → expand **Perspective** → **Views** → right-click → **New Folder** → name it `AskMira`.

Right-click the new `AskMira` folder → **New View** → name it `AskMira` (so the path becomes `Perspective/Views/AskMira/AskMira`). Pick any starting template; we'll overwrite the JSON.

### 3. Replace the view JSON

Designer Project Browser → right-click `AskMira/AskMira` → **Edit Resource → view.json** (or use Project Browser's "open in editor" depending on Designer version).

Paste the full JSON below, replacing whatever is there:

<details>
<summary>view.json (139 lines, click to expand)</summary>

```json
{
  "custom": { "question": "", "answer": "Ask me about the garage conveyor…", "busy": false },
  "params": {},
  "props": {
    "defaultSize": { "width": 480, "height": 560 }
  },
  "root": {
    "type": "ia.container.flex",
    "meta": { "name": "root" },
    "props": {
      "direction": "column",
      "style": {
        "backgroundColor": "#161b22",
        "border": "2px solid #30363d",
        "borderRadius": "14px",
        "padding": "16px",
        "gap": "12px",
        "height": "100%"
      }
    },
    "children": [
      {
        "type": "ia.display.label",
        "meta": { "name": "title" },
        "position": { "basis": "30px", "shrink": 0 },
        "props": {
          "text": "ASK MIRA",
          "style": {
            "color": "#e6edf3",
            "fontSize": "20px",
            "fontWeight": 700,
            "letterSpacing": "0.06em",
            "textAlign": "center"
          }
        }
      },
      {
        "type": "ia.input.text-area",
        "meta": { "name": "question_input" },
        "position": { "basis": "120px", "shrink": 0 },
        "props": {
          "text": "",
          "placeholder": "What's going on with the conveyor?",
          "style": {
            "backgroundColor": "#0d1117",
            "color": "#e6edf3",
            "border": "1px solid #30363d",
            "borderRadius": "8px",
            "fontSize": "14px",
            "padding": "8px"
          }
        },
        "propConfig": {
          "props.text": {
            "binding": {
              "type": "property",
              "config": { "path": "view.custom.question" },
              "bidirectional": true
            }
          }
        }
      },
      {
        "type": "ia.input.button",
        "meta": { "name": "ask_btn" },
        "position": { "basis": "40px", "shrink": 0 },
        "props": {
          "text": "Ask MIRA",
          "style": {
            "backgroundColor": "#1f6feb",
            "color": "#ffffff",
            "fontSize": "15px",
            "fontWeight": 700,
            "borderRadius": "8px",
            "border": "none"
          }
        },
        "events": {
          "component": {
            "onActionPerformed": {
              "type": "script",
              "scope": "G",
              "config": {
                "script": "\t# Gateway-scope: reads live PLC tags, posts to the MIRA /ask service over Tailscale.\n\tself.view.custom.busy = True\n\tpaths = [\"[default]MIRA_IOCheck/VFD/vfd_frequency\",\"[default]MIRA_IOCheck/VFD/vfd_freq_sp\",\"[default]MIRA_IOCheck/VFD/vfd_current\",\"[default]MIRA_IOCheck/VFD/vfd_dc_bus\",\"[default]MIRA_IOCheck/VFD/vfd_cmd_word\",\"[default]MIRA_IOCheck/VFD/vfd_status_word\",\"[default]MIRA_IOCheck/VFD/vfd_fault_code\",\"[default]MIRA_IOCheck/VFD/vfd_comm_ok\",\"[default]MIRA_IOCheck/VFD/pe_latched\",\"[default]MIRA_IOCheck/Inputs/DI_02\",\"[default]MIRA_IOCheck/Inputs/DI_05\",\"[default]MIRA_IOCheck/Outputs/DO_02\"]\n\tkeys = [\"vfd_frequency\",\"vfd_freq_sp\",\"vfd_current\",\"vfd_dc_bus\",\"vfd_cmd_word\",\"vfd_status_word\",\"vfd_fault_code\",\"vfd_comm_ok\",\"pe_latched\",\"e_stop\",\"pe_beam\",\"mlc\"]\n\tqvs = system.tag.readBlocking(paths)\n\ttags = {}\n\tfor i in range(len(keys)):\n\t\ttry:\n\t\t\ttags[keys[i]] = qvs[i].value\n\t\texcept:\n\t\t\tpass\n\ttry:\n\t\tsid = self.session.props.id\n\texcept:\n\t\tsid = \"\"\n\tbody = system.util.jsonEncode({\"question\": self.view.custom.question, \"tags\": tags, \"session_id\": sid})\n\ttry:\n\t\tclient = system.net.httpClient(timeout=95000)\n\t\t# X-Mira-Key left empty for now (no shared secret yet); set ASK_API_KEY both ends to enable.\n\t\tresp = client.post(\"http://100.68.120.99:8011/ask\", data=body, headers={\"Content-Type\":\"application/json\",\"X-Mira-Key\":\"\"})\n\t\tdata = system.util.jsonDecode(resp.text)\n\t\tself.view.custom.answer = data.get(\"answer\",\"(no answer field)\")\n\texcept Exception as e:\n\t\tself.view.custom.answer = \"Error contacting MIRA: \" + str(e)\n\tfinally:\n\t\tself.view.custom.busy = False\n"
              }
            }
          }
        }
      },
      {
        "type": "ia.display.label",
        "meta": { "name": "busy_lbl" },
        "position": { "basis": "20px", "shrink": 0 },
        "props": {
          "text": "MIRA is thinking…",
          "style": {
            "color": "#f0a90e",
            "fontSize": "13px",
            "fontStyle": "italic",
            "textAlign": "center"
          }
        },
        "propConfig": {
          "meta.visible": {
            "binding": {
              "type": "property",
              "config": { "path": "view.custom.busy" }
            }
          }
        }
      },
      {
        "type": "ia.display.markdown",
        "meta": { "name": "answer_md" },
        "position": { "basis": "0px", "grow": 1, "shrink": 1 },
        "props": {
          "source": "",
          "style": {
            "backgroundColor": "#0d1117",
            "color": "#e6edf3",
            "border": "1px solid #30363d",
            "borderRadius": "8px",
            "padding": "12px",
            "fontSize": "14px",
            "overflow": "auto"
          }
        },
        "propConfig": {
          "props.source": {
            "binding": {
              "type": "property",
              "config": { "path": "view.custom.answer" }
            }
          }
        }
      }
    ]
  }
}
```

</details>

The view depends on these PLC tags already existing (created by an earlier APPLY.ps1 run on the Conveyor view): `MIRA_IOCheck/VFD/{vfd_frequency, vfd_freq_sp, vfd_current, vfd_dc_bus, vfd_cmd_word, vfd_status_word, vfd_fault_code, vfd_comm_ok, pe_latched}`, `MIRA_IOCheck/Inputs/{DI_02, DI_05}`, `MIRA_IOCheck/Outputs/DO_02`. If any tag is missing, the Gateway script falls back to skipping the missing key (try/except per tag) and the call still goes through.

### 4. Save the project

Designer → **File → Save Project** (or `Ctrl+S`). The Gateway scanner picks up the change within ~30 s.

### 5. Open in browser

Visit `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/AskMira` from any device on the Tailnet. The view should render: dark card, "ASK MIRA" header, question text area, blue "Ask MIRA" button, status line, answer markdown panel.

### 6. Click test

Type `current status?` in the text area, press the button. The script reads the 12 PLC tags, sends to `100.68.120.99:8011/ask`, and renders the answer. Expect ~30-50 s latency on a grounded diagnostic. The "MIRA is thinking…" line displays while in flight.

## If something fails

| Symptom | Likely cause | Fix |
|---|---|---|
| Designer connection refused | Gateway service down OR WiFi off Tailnet | Re-launch Designer; check `tailscale status` |
| View doesn't appear in browser | Project save didn't flush | Designer → File → Save Project again; or Gateway Config → Projects → Update |
| Click returns "Error contacting MIRA: ..." | ask_api unreachable on `100.68.120.99:8011` | From travel laptop: `curl http://100.68.120.99:8011/health` — if not `ok`, the prod ask_api container is down; check VPS |
| Click returns `(no answer field)` | ask_api returned non-JSON / different schema | Check ask_api logs on VPS |
| Click hangs > 95 s | Engine timeout exceeded; Gateway's `httpClient` aborts | Re-test with simpler question; check engine logs |
| Tag read errors | One of the 12 tags is missing | Tag list has try/except per key — missing tags just drop out of the payload |

## Rollback

If the AskMira view causes any problem with the live Conveyor display:
- Designer → Project Browser → right-click `Perspective/Views/AskMira` folder → **Delete**
- File → Save Project. AskMira disappears within ~30 s. Conveyor view and tags are unaffected.

## After deploy succeeds

Move to Gate 5 — run the 10-question re-test (via Webwright once installed) against the AskMira view and capture results in `docs/demos/_audit/askmira-rerun-2026-06-06.md` (template stub already created).
