# MIRA Offline / Self-Install User Manual

**Audience:** maintenance users, controls engineers, and local IT staff who need to install and use the repository's offline or self-installable MIRA packages.

**Current packaging status:** this repository does not yet contain a finished single-click Windows `.exe` installer. The available programs are local web apps, Ignition project bundles, PowerShell deployment scripts, PLC/edge utilities, and generated lesson PDFs. Use this manual to choose the correct path and understand what works without internet access.

## 1. Package Map

| Package | Best for | Runs offline? | Main entry point |
|---|---|---:|---|
| MIRA Hub Namespace Explorer | Windows Explorer-style asset/manual browser | Partial | `mira-hub/` |
| ConveyorMIRA Ignition project | PLC laptop or Ignition gateway demo | Mostly local | `ignition/deploy_ignition.ps1` |
| MIRA for Ignition Exchange bundle | Importing Perspective widgets into Ignition | Needs API unless self-hosted | `mira-ignition-exchange/` |
| PLC Edge Operator Dashboard | Bench conveyor status panel | Local network | `plc/run_publisher.bat` |
| Legacy MIRA RAG Sidecar | Local document Q&A service | Local | `mira-sidecar/service/install_service_windows.bat` |
| PLC Teacher lesson PDFs | Training/reference material | Yes | `docs/instructions/*.pdf` |

## 2. Before You Start

Use Windows 10/11 with administrator access for Ignition and service installs. Keep secrets out of `.env` files. Production secrets belong in Doppler under `factorylm/prd`; local test values should remain uncommitted.

Recommended tools:

- Git for Windows
- PowerShell 7 or Windows PowerShell
- Node.js or Bun for Hub development
- Python 3.12 and `uv` for the legacy sidecar
- Ignition 8.1+ with Perspective for Ignition packages

Clone or update the repo:

```powershell
cd C:\Users\<you>\Documents
git clone <repo-url> MIRA
cd MIRA
git pull
```

## 3. MIRA Hub Namespace Explorer

MIRA Hub contains the Explorer-style interface: a left namespace tree, right-side node details, files, proposals, work orders, and Ask MIRA chat. It is the closest match to the requested "classic Windows File Explorer" presentation.

Install and run:

```powershell
cd mira-hub
npm install
npm run dev
```

Open the local URL printed by Next.js, usually `http://localhost:3000`. Go to `/namespace`.

Typical use:

1. Click **New Folder** to create a site, line, asset, or component node.
2. Select a node in the left tree.
3. Upload a PDF or manual to attach it to that node.
4. Use **Ask MIRA** on the node to ask questions grounded in uploaded manuals.
5. Download or delete attached files from the file panel.

Limitations: Hub is not a packaged desktop `.exe`. Full chat and retrieval require database and model configuration. The UI can run locally, but it is not a guaranteed air-gapped app unless the database and inference services are also local.

## 4. ConveyorMIRA Ignition Project

Use this path for a PLC laptop, local Ignition gateway, or conveyor demo.

Prerequisites:

- Ignition gateway reachable at `http://localhost:8088`
- Perspective module installed
- Optional Micro820 PLC at `192.168.1.100:502`
- Modbus TCP device named `Micro820_Conveyor`

Deploy:

```powershell
cd C:\Users\<you>\Documents\MIRA
PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1
```

The deployer copies the `ConveyorMIRA` project into Ignition, installs WebDev scripts, imports tags, and prints gateway URLs. Run PowerShell as administrator if Ignition is installed under `C:\Program Files`.

Configuration file:

```text
C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties
```

Start from `ignition/config/factorylm.properties.template`. For cloud Ask MIRA, set tenant and HMAC values expected by the WebDev chat endpoint:

```properties
MIRA_CLOUD_URL=https://api.factorylm.com/api/v1/ignition/chat
MIRA_TENANT_ID=<tenant-id>
MIRA_IGNITION_HMAC_KEY=<shared-secret>
```

Offline note: the current chat WebDev handler defaults to the cloud endpoint and fails closed without an HMAC key. Pure offline chat requires either a local-compatible backend URL or a code/config pass to align the handler with the legacy local sidecar.

## 5. MIRA for Ignition Exchange Bundle

Use `mira-ignition-exchange/` when you want to import the Perspective resource into an existing Ignition project.

Install:

1. Open Ignition Designer.
2. Import the project resources from `mira-ignition-exchange/ignition-project/`.
3. Add the ChatDock and ScanWidget views to your Perspective project.
4. Configure the tenant ID, HMAC key, and API URL according to the bundle README.
5. Confirm outbound HTTPS is allowed if using the hosted API.

This bundle is designed for Ignition Exchange-style distribution, not as a Windows executable.

## 6. PLC Edge Operator Dashboard

Use this for the bench PLC dashboard. It shows conveyor status through MQTT and a browser panel.

Typical start:

```powershell
cd plc
.\run_publisher.bat
```

The flow is:

```text
PLC -> mqtt_publisher.py -> Mosquitto -> browser dashboard
```

The main dashboard files live in `plc/edge-stack/web/`. This is useful for local operation and demonstrations, but it is not an installer package.

## 7. Legacy MIRA RAG Sidecar

The sidecar is legacy and marked for sunset, but it is still useful for local document Q&A experiments.

Install as a Windows service:

```powershell
cd mira-sidecar\service
.\install_service_windows.bat
```

It creates a `MiraRAG` service using NSSM and runs Uvicorn on `127.0.0.1:5000`.

Check:

```powershell
curl http://localhost:5000/status
```

Uninstall:

```powershell
cd mira-sidecar\service
.\uninstall_service_windows.bat
```

## 8. PLC Teacher Lessons

The PLC teacher content is already generated as lesson PDFs and HTML files under `docs/instructions/`. Open the PDFs directly for offline training.

Rebuild PDFs:

```powershell
.\scripts\build_instruction_pdfs.ps1
```

These lessons cover PLC, Modbus polling, UDFB basics, Ignition Perspective, and related commissioning workflows.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Hub opens but chat has no citations | Manual was not attached to a namespace node or database config is missing | Upload the manual from `/namespace` and verify DB env vars |
| Ignition deploy cannot copy project files | PowerShell lacks access to Ignition install directory | Re-run PowerShell as administrator |
| Ignition Ask MIRA returns 503 | Missing HMAC key or tenant config | Fill `MIRA_IGNITION_HMAC_KEY` and `MIRA_TENANT_ID` |
| PLC dashboard shows no data | MQTT publisher is not running or PLC address is wrong | Start `plc/run_publisher.bat` and verify PLC connectivity |
| Sidecar service will not start | Missing Python, `uv`, NSSM, or virtual environment setup | Install prerequisites, then rerun the service installer |

## 10. What Is Not Finished Yet

The repo does not currently include:

- a signed Windows `.exe` installer;
- NSIS, Inno Setup, MSIX, PyInstaller, or Tauri packaging for these tools;
- a single offline desktop shell wrapping Hub, Ignition setup, sidecar, and PLC lessons;
- a fully air-gapped Ask MIRA flow for Ignition without additional local backend configuration.

Treat the current artifacts as installable technical packages. A future `.exe` should wrap the Hub-style Explorer UI, local services, configuration wizard, bundled lessons, and optional Ignition import helpers.
