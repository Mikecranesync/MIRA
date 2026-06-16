# Sensors & FFT API

Sensors are the live telemetry layer under each asset. MIRA collects time-series readings (vibration, temperature, current, pressure) and runs on-demand FFT analysis that classifies spectral peaks into named fault signatures — imbalance, bearing-defect frequencies, gear-mesh harmonics — so a maintenance technician gets "inner-race defect at 147 Hz, 3.2× baseline" rather than a raw spectrum they have to interpret.

**MIRA differentiator:** Factory AI exposes `/sensors` as a read endpoint over admin-configured monitors. MIRA adds batch ingest (`POST /sensors/{id}/readings`), time-bucketed reporting, and the `POST /sensors/{id}/fft` engine — the only endpoint in this class that labels bearing-defect frequencies automatically.

The asset `/charts` endpoint (see [Assets](./assets.md#charts)) calls this report endpoint internally; hook into it directly for custom dashboards or alerting pipelines.

---

## Data model

```ts
type Sensor = {
  id: string;             // uuid
  assetId: string;        // parent asset
  name: string;           // human label, e.g. "Drive-end bearing — radial"
  type: "vibration" | "temperature" | "current" | "pressure";
  unit: string;           // "g", "°C", "A", "bar", "in/s", etc.
  samplingRateHz: number; // acquisition rate used for FFT (e.g. 12800 for bearing analysis)
  location?: string;      // mounting point, e.g. "DE bearing, vertical"
  threshold?: {
    warning: number;      // value in `unit` — crossing emits sensor.threshold_exceeded (severity=warning)
    critical: number;     // crossing emits sensor.threshold_exceeded (severity=critical)
  };
  createdAt: string;      // ISO 8601
  updatedAt: string;
};

type Reading = {
  sensorId: string;
  ts: string;             // ISO 8601
  value: number;          // in sensor.unit
};

// Returned by POST /sensors/{id}/fft
type FFTResult = {
  sensorId: string;
  computedAt: string;
  inputSamples: number;     // length of the time-domain array submitted
  samplingRateHz: number;
  spectrum: Array<{
    frequencyHz: number;
    amplitudeG: number;     // or amplitude in sensor.unit if non-vibration
  }>;
  peaks: Array<{
    frequencyHz: number;
    amplitudeG: number;
    label: string;          // see Peak labels below
    severity: "normal" | "warning" | "critical";
    confidence: number;     // 0–1
  }>;
  overallRms: number;       // RMS of all samples, in sensor.unit
  machineGeometry: {        // echoed back for traceability
    rpm: number;
    bearingModel?: string;
    ballCount?: number;
    gearTeeth?: number;
  };
};
```

### Peak labels

| Label | Meaning |
|---|---|
| `1X` | Fundamental running speed (shaft imbalance, misalignment) |
| `2X` | Second harmonic (misalignment, looseness) |
| `3X` | Third harmonic (looseness, blade/vane pass) |
| `BPFO` | Ball-pass frequency, outer race — outer-race bearing defect |
| `BPFI` | Ball-pass frequency, inner race — inner-race bearing defect |
| `BSF` | Ball-spin frequency — rolling-element defect |
| `FTF` | Fundamental train frequency (cage defect) |
| `GMF` | Gear-mesh frequency (tooth wear / damage) |
| `GMF+1X` | Gear-mesh sideband — modulated by shaft speed |
| `unknown` | Peak above the amplitude threshold with no matched frequency |

**How bearing-defect frequencies are derived.** Given `rpm`, `ballCount` (`n`), and geometric ratios (MIRA uses the standard BPFO/BPFI/BSF/FTF formulae), the engine computes expected fault frequencies, builds ±2 % tolerance windows around each harmonic up to the 5th, and flags every spectrum bin whose amplitude exceeds the baseline RMS by the severity thresholds (configurable on the sensor; defaults: warning = 2×, critical = 4×). A peak is labeled with the closest matching frequency; unmatched peaks above threshold are labeled `unknown`.

---

## Endpoints

### List sensors for an asset

```http
GET /api/v1/assets/{assetId}/sensors
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `type` | string | Filter: `vibration`, `temperature`, `current`, `pressure`. |
| `limit` | int | Default 50, max 200. |
| `cursor` | string | Pagination. |

Response:

```json
{
  "items": [
    {
      "id": "sensor_01JK...",
      "assetId": "asset_01HQ...",
      "name": "Drive-end bearing — radial",
      "type": "vibration",
      "unit": "g",
      "samplingRateHz": 12800,
      "location": "DE bearing, vertical",
      "threshold": { "warning": 0.5, "critical": 1.2 },
      "createdAt": "2026-03-01T08:00:00Z",
      "updatedAt": "2026-06-14T12:34:00Z"
    }
  ],
  "nextCursor": null
}
```

### Create sensor

```http
POST /api/v1/assets/{assetId}/sensors
```

Body:

```json
{
  "name": "Drive-end bearing — radial",
  "type": "vibration",
  "unit": "g",
  "samplingRateHz": 12800,
  "location": "DE bearing, vertical",
  "threshold": { "warning": 0.5, "critical": 1.2 }
}
```

Required: `name`, `type`, `unit`.

### Ingest readings (batch)

```http
POST /api/v1/sensors/{id}/readings
```

Batch time-series ingest. Accepts up to 10,000 readings per call. Readings are stored in time order; duplicates (same `ts`) are idempotently ignored.

Body:

```json
{
  "readings": [
    { "ts": "2026-06-14T10:00:00.000Z", "value": 0.31 },
    { "ts": "2026-06-14T10:00:00.078Z", "value": 0.29 },
    { "ts": "2026-06-14T10:00:00.156Z", "value": 0.34 }
  ]
}
```

Response `202 Accepted`:

```json
{
  "accepted": 3,
  "rejected": 0,
  "earliestTs": "2026-06-14T10:00:00.000Z",
  "latestTs":   "2026-06-14T10:00:00.156Z"
}
```

Threshold checks run asynchronously after ingest; any crossing emits a `sensor.threshold_exceeded` webhook within ~1 s.

### Get time-bucketed report

```http
GET /api/v1/sensors/{id}/report
```

Returns a downsampled, time-bucketed series — the same data [asset `/charts`](./assets.md#charts) renders.

Query parameters:

| Name | Type | Description |
|---|---|---|
| `window` | string | `1h`, `6h`, `24h`, `7d`, `30d`. Default `24h`. |
| `metric` | string | `mean`, `max`, `p95`, `rms`. Default `mean`. |
| `buckets` | int | Number of time buckets to return. Default 60, max 1440. |

Response:

```json
{
  "sensorId": "sensor_01JK...",
  "window": "24h",
  "metric": "mean",
  "unit": "g",
  "series": [
    { "ts": "2026-06-13T12:00:00Z", "value": 0.28 },
    { "ts": "2026-06-13T12:24:00Z", "value": 0.31 },
    { "ts": "2026-06-13T12:48:00Z", "value": 0.44 }
  ],
  "overallMin": 0.21,
  "overallMax": 0.61,
  "overallMean": 0.30
}
```

### FFT + peak classification

```http
POST /api/v1/sensors/{id}/fft
```

Accepts raw time-domain samples and machine geometry. Returns the full frequency spectrum and a list of classified spectral peaks with severity scores. This endpoint does not require prior readings to be stored — it processes the submitted samples in-request.

Body:

```json
{
  "samples": [0.31, 0.29, 0.34, -0.12, 0.08, "..."],
  "samplingRateHz": 12800,
  "machineGeometry": {
    "rpm": 1750,
    "bearingModel": "SKF 6205-2Z",
    "ballCount": 9,
    "gearTeeth": 48
  }
}
```

| Field | Required | Description |
|---|---|---|
| `samples` | yes | Array of amplitude values (floats) in `sensor.unit`. Min 512, max 131,072. Must be a power of 2 for optimal FFT window. |
| `samplingRateHz` | yes | Acquisition rate. Determines max detectable frequency (`samplingRateHz / 2` — Nyquist). For rolling-element bearings use ≥ 5,000 Hz; 12,800 Hz is typical. |
| `machineGeometry.rpm` | yes | Running speed. Used to compute 1X/2X harmonics and bearing-defect frequencies. |
| `machineGeometry.bearingModel` | no | If provided, MIRA looks up BPFO/BPFI/BSF/FTF ratios from its bearing catalog and uses them instead of ball-count geometry. |
| `machineGeometry.ballCount` | no | Used when `bearingModel` is not in the catalog. |
| `machineGeometry.gearTeeth` | no | Number of teeth on the gear under analysis. Required for GMF detection. |

Response:

```json
{
  "sensorId": "sensor_01JK...",
  "computedAt": "2026-06-14T10:05:02Z",
  "inputSamples": 8192,
  "samplingRateHz": 12800,
  "overallRms": 0.47,
  "machineGeometry": { "rpm": 1750, "bearingModel": "SKF 6205-2Z", "ballCount": 9, "gearTeeth": 48 },
  "peaks": [
    {
      "frequencyHz": 29.2,
      "amplitudeG": 0.51,
      "label": "1X",
      "severity": "normal",
      "confidence": 0.98
    },
    {
      "frequencyHz": 146.8,
      "amplitudeG": 1.84,
      "label": "BPFO",
      "severity": "critical",
      "confidence": 0.91
    },
    {
      "frequencyHz": 293.6,
      "amplitudeG": 0.62,
      "label": "BPFO",
      "severity": "warning",
      "confidence": 0.87
    }
  ],
  "spectrum": [
    { "frequencyHz": 0.0,   "amplitudeG": 0.00 },
    { "frequencyHz": 1.56,  "amplitudeG": 0.02 },
    { "frequencyHz": 3.12,  "amplitudeG": 0.01 }
  ]
}
```

The `spectrum` array contains one entry per FFT bin (`samplingRateHz / inputSamples` Hz resolution). It is truncated here for readability; a real response for 8,192 samples at 12,800 Hz contains 4,096 bins at 1.56 Hz resolution up to 6,400 Hz.

A `sensor.fft_anomaly` webhook fires automatically when any peak reaches `severity=critical` (see [Webhooks](./webhooks.md)).

---

## How this feeds asset charts

`GET /api/v1/assets/{id}/charts?metric=vibration` is a thin wrapper over `GET /api/v1/sensors/{id}/report` for each vibration sensor attached to that asset. It merges the series and returns them keyed by sensor name. See [Assets — Charts](./assets.md#charts).

---

## Examples

### curl — ingest a batch of readings

```bash
curl -X POST https://acme.factorylm.com/api/v1/sensors/sensor_01JK.../readings \
  -H "Authorization: Bearer $MIRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "readings": [
      { "ts": "2026-06-14T10:00:00.000Z", "value": 0.31 },
      { "ts": "2026-06-14T10:00:00.078Z", "value": 0.29 }
    ]
  }'
```

### curl — FFT with bearing geometry

```bash
curl -X POST https://acme.factorylm.com/api/v1/sensors/sensor_01JK.../fft \
  -H "Authorization: Bearer $MIRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "samples": [0.31, 0.29, 0.34, -0.12, 0.08],
    "samplingRateHz": 12800,
    "machineGeometry": {
      "rpm": 1750,
      "bearingModel": "SKF 6205-2Z",
      "ballCount": 9
    }
  }'
```

### TypeScript

```ts
import { MiraClient } from "@factorylm/mira-sdk";

const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

// Ingest a block of samples
await mira.sensors.ingestReadings("sensor_01JK...", {
  readings: timeSeries.map((v, i) => ({
    ts: new Date(startMs + i * sampleIntervalMs).toISOString(),
    value: v,
  })),
});

// Run FFT and check for critical peaks
const fft = await mira.sensors.fft("sensor_01JK...", {
  samples: timeDomainBuffer,
  samplingRateHz: 12800,
  machineGeometry: { rpm: 1750, bearingModel: "SKF 6205-2Z", ballCount: 9 },
});

const critical = fft.peaks.filter((p) => p.severity === "critical");
if (critical.length > 0) {
  console.error("Critical bearing fault detected:", critical);
}
```

### Python

```python
import os
from mira import Mira

mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

# Ingest readings
mira.sensors.ingest_readings(
    sensor_id="sensor_01JK...",
    readings=[{"ts": ts, "value": v} for ts, v in zip(timestamps, values)],
)

# FFT analysis
result = mira.sensors.fft(
    sensor_id="sensor_01JK...",
    samples=time_domain_samples,
    sampling_rate_hz=12800,
    machine_geometry={"rpm": 1750, "bearing_model": "SKF 6205-2Z", "ball_count": 9},
)

for peak in result.peaks:
    if peak.severity in ("warning", "critical"):
        print(f"{peak.label} @ {peak.frequency_hz:.1f} Hz — {peak.severity} (amp={peak.amplitude_g:.3f} g)")
```

---

## Webhooks emitted

- `sensor.threshold_exceeded` — a reading (or batch RMS) crossed a `warning` or `critical` threshold. Payload includes `sensorId`, `value`, `threshold`, `severity`.
- `sensor.fft_anomaly` — a `POST /fft` call returned one or more `severity=critical` peaks. Payload includes the full `peaks` array so the webhook receiver can act without a follow-up API call.

See [Webhooks API](./webhooks.md) to subscribe.

---

## Errors

See [Error format](./README.md#error-format). Common codes for this resource:

| Code | HTTP | Meaning |
|---|---|---|
| `sensor_not_found` | 404 | Sensor ID does not exist in this tenant. |
| `too_many_readings` | 422 | Batch exceeds 10,000 readings. Split into smaller batches. |
| `sample_count_invalid` | 422 | `samples` array length is not between 512 and 131,072. |
| `sampling_rate_required` | 422 | `samplingRateHz` missing from FFT request. |
| `rpm_required` | 422 | `machineGeometry.rpm` missing — needed for harmonic labeling. |
