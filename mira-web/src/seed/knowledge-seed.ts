/**
 * Knowledge seed — bridges Atlas CMMS data into NeonDB for RAG retrieval.
 *
 * Three seed functions:
 * 1. seedAssetKnowledge — asset descriptions → knowledge_entries
 * 2. seedFaultCodes — structured fault codes → fault_codes table
 * 3. seedWorkOrderPatterns — WO history patterns → knowledge_entries
 *
 * This ensures knowledge is available on first login — not waiting for crons.
 */

const MCP_URL = () => process.env.MIRA_MCP_URL || "http://mira-mcp:8001";
const MCP_KEY = () => process.env.MCP_REST_API_KEY || "";

interface KnowledgeChunk {
  content: string;
  manufacturer: string;
  modelNumber: string;
  sourceType: string;
  chunkType: string;
}

function chunkAssetDescription(
  name: string,
  model: string,
  description: string,
): KnowledgeChunk[] {
  const sections = description.split(/\n(?=[A-Z]{2,}.*:)/);
  const chunks: KnowledgeChunk[] = [];

  const manufacturer = extractManufacturer(description);

  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length < 50) continue;

    const header = `Equipment: ${name} (Model: ${model})\n`;
    const content = header + trimmed;

    if (content.length > 2500) {
      const subChunks = splitByLines(content, 2000);
      for (const sub of subChunks) {
        chunks.push({
          content: sub,
          manufacturer,
          modelNumber: model,
          sourceType: "atlas_asset",
          chunkType: "text",
        });
      }
    } else {
      chunks.push({
        content,
        manufacturer,
        modelNumber: model,
        sourceType: "atlas_asset",
        chunkType: "text",
      });
    }
  }

  if (chunks.length === 0 && description.length > 50) {
    chunks.push({
      content: `Equipment: ${name} (Model: ${model})\n${description}`,
      manufacturer,
      modelNumber: model,
      sourceType: "atlas_asset",
      chunkType: "text",
    });
  }

  return chunks;
}

function splitByLines(text: string, maxChars: number): string[] {
  const lines = text.split("\n");
  const result: string[] = [];
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 100) {
      result.push(current.trim());
      current = "";
    }
    current += line + "\n";
  }
  if (current.trim().length > 50) result.push(current.trim());
  return result;
}

function extractManufacturer(desc: string): string {
  const match = desc.match(/Manufacturer:\s*(.+)/i);
  if (match) return match[1].trim().split(/[(/]/)[0].trim();
  return "";
}

async function embedText(text: string): Promise<number[] | null> {
  // Try mira-mcp embed proxy first, fall back to direct Ollama
  const key = MCP_KEY();
  if (key) {
    try {
      const resp = await fetch(`${MCP_URL()}/api/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({ text }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.embedding) return data.embedding;
      }
    } catch { /* fall through to direct Ollama */ }
  }

  // Direct Ollama fallback (for pre-deployment or when mira-mcp lacks /api/embed)
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://100.86.236.11:11434";
  try {
    const resp = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text:latest", prompt: text }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.embedding || null;
  } catch {
    return null;
  }
}

async function insertKnowledgeEntry(
  chunk: KnowledgeChunk,
  embedding: number[],
  tenantId: string,
): Promise<boolean> {
  try {
    const { neon } = await import("@neondatabase/serverless");
    const url = process.env.NEON_DATABASE_URL;
    if (!url) {
      console.warn("[knowledge-seed] NEON_DATABASE_URL not set — skipping insert");
      return false;
    }
    const sql = neon(url);

    const id = crypto.randomUUID();
    const embeddingStr = `[${embedding.join(",")}]`;
    const metadataStr = JSON.stringify({ chunk_type: chunk.chunkType, seeded: true });

    await sql`
      INSERT INTO knowledge_entries
        (id, tenant_id, source_type, manufacturer, model_number,
         content, embedding, source_url, source_page, metadata,
         is_private, verified, chunk_type)
      VALUES
        (${id}, ${tenantId}, ${chunk.sourceType}, ${chunk.manufacturer},
         ${chunk.modelNumber}, ${chunk.content},
         cast(${embeddingStr} AS vector),
         ${"atlas-seed"}, ${0},
         cast(${metadataStr} AS jsonb),
         false, false, ${chunk.chunkType})
    `;
    return true;
  } catch (err) {
    console.error("[knowledge-seed] Insert failed:", err);
    return false;
  }
}

export interface SeedKnowledgeResult {
  chunked: number;
  embedded: number;
  inserted: number;
  failed: number;
}

export async function seedAssetKnowledge(
  assets: Array<{ name: string; model: string; description: string }>,
  tenantId: string,
): Promise<SeedKnowledgeResult> {
  const result: SeedKnowledgeResult = {
    chunked: 0,
    embedded: 0,
    inserted: 0,
    failed: 0,
  };

  const allChunks: KnowledgeChunk[] = [];
  for (const asset of assets) {
    const chunks = chunkAssetDescription(asset.name, asset.model, asset.description);
    allChunks.push(...chunks);
  }
  result.chunked = allChunks.length;
  console.log(`[knowledge-seed] Chunked ${assets.length} assets into ${allChunks.length} knowledge entries`);

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    const embedding = await embedText(chunk.content);
    if (!embedding) {
      console.warn(`[knowledge-seed] Embedding failed for chunk ${i + 1}/${allChunks.length}`);
      result.failed++;
      continue;
    }
    result.embedded++;

    const ok = await insertKnowledgeEntry(chunk, embedding, tenantId);
    if (ok) {
      result.inserted++;
    } else {
      result.failed++;
    }

    if ((i + 1) % 5 === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  console.log(
    `[knowledge-seed] Complete: ${result.inserted} inserted, ${result.failed} failed, ${result.embedded} embedded`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// #141 — Fault codes seed (structured fault_codes table)
// ---------------------------------------------------------------------------

interface FaultCode {
  code: string;
  description: string;
  cause: string;
  action: string;
  severity: string;
  equipmentModel: string;
  manufacturer: string;
}

const DEMO_FAULT_CODES: FaultCode[] = [
  // GS10 VFD
  { code: "F05", description: "Overcurrent fault", cause: "Motor overload, coupling misalignment, DC bus capacitor degradation, mechanical load spike at startup", action: "Check motor load and FLA. Verify coupling alignment. Check accel ramp P042 (increase if tripping on startup). If recurring, measure DC bus capacitor ESR — replace if >1.5x nominal.", severity: "HIGH", equipmentModel: "GS1-45P0", manufacturer: "AutomationDirect" },
  { code: "F02", description: "Overvoltage fault", cause: "Regenerative voltage during deceleration, decel time too fast, no dynamic braking resistor", action: "Increase decel time P043. If load has high inertia, add dynamic braking resistor. Check input voltage for sags/swells.", severity: "MEDIUM", equipmentModel: "GS1-45P0", manufacturer: "AutomationDirect" },
  { code: "F04", description: "Undervoltage fault", cause: "Input power loss, loose connections at L1/L2/L3, voltage sag during plant-wide load event", action: "Check input power at drive terminals with meter. Torque L1/L2/L3 connections. Check for voltage sag correlation with other large loads starting.", severity: "MEDIUM", equipmentModel: "GS1-45P0", manufacturer: "AutomationDirect" },
  { code: "F07", description: "Drive overtemperature", cause: "Ambient temp >40°C, blocked cooling fan, fan failure, insufficient ventilation clearance", action: "Check ambient temp in enclosure. Verify fan rotation. Clean fan filter. Ensure 4\" clearance above and below drive. Replace fan if stalled (P/N GS1-FAN-01).", severity: "HIGH", equipmentModel: "GS1-45P0", manufacturer: "AutomationDirect" },
  // FANUC Robot
  { code: "E-731", description: "Axis following error (encoder feedback loss)", cause: "Encoder cable damage at bend point (especially J2 at CN2), pulse coder battery low (<3.1V), encoder failure, servo amplifier fault", action: "Check encoder cable at CN2 connector — inspect for pinch damage near axis housing. Measure pulse coder battery voltage (>3.1V required). If cable and battery OK, swap-test encoder or servo amplifier.", severity: "HIGH", equipmentModel: "R-2000iC/165F", manufacturer: "FANUC" },
  { code: "SRVO-050", description: "Collision detected", cause: "Physical collision with fixture/part/tooling, torque sensor triggered by unexpected load, DCS zone violation", action: "Inspect tooling and fixture for obstruction. Check part placement in fixture. Re-master all 6 axes if robot displaced. Verify DCS zone configuration. Review teach points for clearance.", severity: "HIGH", equipmentModel: "R-2000iC/165F", manufacturer: "FANUC" },
  { code: "SRVO-023", description: "Battery alarm — pulse coder backup", cause: "Pulse coder backup batteries depleted (<2.5V)", action: "Replace 4x 1.5V AA lithium batteries in controller backplane IMMEDIATELY. CRITICAL: replace with controller power ON to preserve position data. If replaced with power off, full re-mastering required.", severity: "HIGH", equipmentModel: "R-2000iC/165F", manufacturer: "FANUC" },
  { code: "SRVO-001", description: "Servo motor overheat", cause: "Excessive cycle time, high ambient temperature (>40°C), blocked ventilation, continuous operation at high duty cycle", action: "Reduce robot speed. Check ambient temp and ventilation. Reduce duty cycle or add cooling pause between cycles. Inspect motor cooling fan.", severity: "MEDIUM", equipmentModel: "R-2000iC/165F", manufacturer: "FANUC" },
  // CompactLogix PLC
  { code: "MF-01", description: "Major Fault Type 1 — Power loss or watchdog", cause: "1769-PA2 power supply failure, bus voltage drop, firmware crash, watchdog timeout", action: "Check 1769-PA2 input power (120/240VAC). Measure backplane bus voltage. If recurring, check for noise on power feed. Download controller fault log via RSLogix.", severity: "HIGH", equipmentModel: "1769-L33ER", manufacturer: "Rockwell Automation" },
  { code: "MF-03", description: "Major Fault Type 3 — I/O module fault", cause: "Module unseated, backplane contact failure, module hardware failure, field wiring short", action: "Reseat the faulted module. Check backplane contacts for debris or corrosion. Verify field wiring for shorts. Replace module if reseat doesn't clear. Note: Slot 4 (1769-IQ16) has history of intermittent faults.", severity: "HIGH", equipmentModel: "1769-L33ER", manufacturer: "Rockwell Automation" },
  { code: "MF-10", description: "Minor Fault Type 10 — Battery low", cause: "1769-BA lithium battery depleted (voltage <2.5V)", action: "Replace 1769-BA battery. CRITICAL: do NOT remove battery with controller power off — program memory will be lost. Replace with power ON, then cycle power to clear fault.", severity: "MEDIUM", equipmentModel: "1769-L33ER", manufacturer: "Rockwell Automation" },
  // Ingersoll Rand Compressor
  { code: "HT-AL", description: "High discharge temperature alarm", cause: "Dirty condenser/cooler fins, low oil level, failed thermal valve, high ambient temperature (>100°F), wrong oil grade", action: "Clean condenser fins with dry compressed air (not water — aluminum fins). Check oil level at sight glass. Test thermal valve operation (should open at 170°F). Verify ambient temp. Check oil grade (Ultra EL-500 synthetic spec'd).", severity: "HIGH", equipmentModel: "UP6-25-125", manufacturer: "Ingersoll Rand" },
  { code: "HT-SD", description: "High discharge temperature shutdown", cause: "Thermal switch triggered at 235°F. Same root causes as HT-AL but more severe — cooler fully blocked, thermal valve stuck closed, oil critically low", action: "Do NOT restart until discharge temp drops below 200°F. Investigate all HT-AL causes. Thermal valve replacement likely required if alarm was previously active. Send oil sample for analysis.", severity: "HIGH", equipmentModel: "UP6-25-125", manufacturer: "Ingersoll Rand" },
];

export async function seedFaultCodes(tenantId: string): Promise<{ inserted: number; failed: number }> {
  let inserted = 0;
  let failed = 0;

  try {
    const { neon } = await import("@neondatabase/serverless");
    const url = process.env.NEON_DATABASE_URL;
    if (!url) {
      console.warn("[knowledge-seed] NEON_DATABASE_URL not set — skipping fault codes");
      return { inserted: 0, failed: 0 };
    }
    const sql = neon(url);

    for (const fc of DEMO_FAULT_CODES) {
      try {
        await sql`
          INSERT INTO fault_codes
            (tenant_id, code, description, cause, action, severity, equipment_model, manufacturer, source_url)
          VALUES
            (${tenantId}, ${fc.code}, ${fc.description}, ${fc.cause}, ${fc.action},
             ${fc.severity}, ${fc.equipmentModel}, ${fc.manufacturer}, ${"demo-seed"})
          ON CONFLICT (tenant_id, code, equipment_model) DO NOTHING
        `;
        inserted++;
      } catch (err) {
        console.error(`[knowledge-seed] Fault code ${fc.code} insert failed:`, err);
        failed++;
      }
    }
  } catch (err) {
    console.error("[knowledge-seed] Fault codes seed failed:", err);
    return { inserted: 0, failed: DEMO_FAULT_CODES.length };
  }

  console.log(`[knowledge-seed] Fault codes seeded: ${inserted}/${DEMO_FAULT_CODES.length}`);
  return { inserted, failed };
}

// ---------------------------------------------------------------------------
// #140 — Work order history pattern seed (knowledge_entries)
// ---------------------------------------------------------------------------

interface WOPattern {
  assetName: string;
  model: string;
  manufacturer: string;
  summary: string;
}

const DEMO_WO_PATTERNS: WOPattern[] = [
  {
    assetName: "GS10 VFD — Pump-001",
    model: "GS1-45P0",
    manufacturer: "AutomationDirect",
    summary: `MAINTENANCE PATTERN ANALYSIS: GS10 VFD Pump-001 (Model GS1-45P0)
Period: Last 90 days | Events: 8 overcurrent faults (F05)

PATTERN: Escalating F05 overcurrent fault — 8 occurrences over 60 days, increasing severity.

TIMELINE:
- Day 1 (82 days ago): First F05, cleared on power cycle. No root cause found.
- Day 2 (68 days ago): F05 on startup. Accel ramp P042 increased from 2.0s to 3.5s.
- Day 3 (55 days ago): F05 recurred. DC bus voltage 5% below nominal. Capacitor aging suspected.
- Day 4 (41 days ago): F05 during peak demand. Motor at 112% FLA. Coupling misalignment found and corrected.
- Day 5 (30 days ago): F05, 5th event. Megger test on motor: 48 MΩ (pass). Capacitor ESR test scheduled.
- Day 6 (22 days ago): F05. DC bus capacitor ESR measured 2.3x nominal. Replacement ordered (P/N GS1-CAP-460).
- Day 7 (14 days ago): Capacitor replaced. F05 cleared.
- Day 8 (5 days ago): No recurrence in 9 days. Pattern closed.

ROOT CAUSE: DC bus capacitor degradation after 4 years of service. ESR rose to 2.3x nominal, causing intermittent bus voltage sag under load, triggering overcurrent protection.

RESOLUTION: Replaced DC bus capacitor (P/N GS1-CAP-460, 450V 2200µF Nichicon LGU series). Also corrected coupling misalignment found during investigation. Accel ramp P042 remains at 3.5s (conservative setting retained).

RECOMMENDATION: Add DC bus capacitor ESR measurement to quarterly PM checklist for all GS10/GS20 VFDs. Capacitor replacement interval: 5 years or when ESR exceeds 1.5x nominal.`,
  },
  {
    assetName: "Conveyor Drive — Conv-001",
    model: "R47 DRE80M4",
    manufacturer: "SEW-Eurodrive",
    summary: `MAINTENANCE PATTERN ANALYSIS: Conveyor Drive Conv-001 (Model R47 DRE80M4)
Period: Last 90 days | Events: 6 belt-related work orders

PATTERN: Progressive belt degradation — tracking drift → tension loss → slippage → fraying → replacement.

TIMELINE:
- Day 1 (75 days ago): Belt tracking off 2mm at tail pulley. Minor take-up adjustment.
- Day 2 (58 days ago): Tracking off 4mm again. Take-up spring showing wear. Spring ordered.
- Day 3 (44 days ago): Belt slipping under load — 8% speed loss measured. Tensioned to spec (45 lbs).
- Day 4 (31 days ago): Belt edge fraying at splice. Field splice was 6 months old. Full replacement scheduled.
- Day 5 (18 days ago): New belt installed (Habasit HAB-2160T). Old belt had 3mm wear at splice. Take-up spring also replaced.
- Day 6 (6 days ago): Post-replacement check: tracking centered, tension 44 lbs, no slip at full load.

ROOT CAUSE: Field-made belt splice failed after 6 months. Take-up spring fatigue contributed to inability to maintain proper tension.

RESOLUTION: Full belt replacement with vulcanized splice (not field-made). Take-up spring replaced (P/N SEW-TU-SP-24). Running within spec.

RECOMMENDATION: Do not use field-made splices — always vulcanized. Replace take-up springs annually. Add belt tension measurement (44-46 lbs at midspan) to monthly PM checklist.`,
  },
  {
    assetName: "Air Compressor — Comp-001",
    model: "UP6-25-125",
    manufacturer: "Ingersoll Rand",
    summary: `MAINTENANCE PATTERN ANALYSIS: Air Compressor Comp-001 (Model UP6-25-125)
Period: Last 90 days | Events: 6 thermal and service work orders

PATTERN: Seasonal high-temperature events correlating with ambient temperature rise, compounded by thermal valve degradation.

TIMELINE:
- Day 1 (85 days ago): High discharge temp alarm at 218°F (limit 225°F). Ambient 94°F. Cleaned condenser fins.
- Day 2 (62 days ago): Oil analysis: TAN 1.8 (replace at 2.0), iron 35 ppm (watch level). Oil change scheduled.
- Day 3 (48 days ago): Oil and filter changed (Ultra EL-500 synthetic). Discharge temp dropped to 195°F.
- Day 4 (35 days ago): High temp alarm again at 221°F. Ambient 97°F. Thermal valve found sluggish — replaced.
- Day 5 (20 days ago): Post thermal valve replacement: discharge temp 188°F at 91°F ambient. Good 97°F delta.
- Day 6 (8 days ago): Quarterly PM: air filter replaced, belt tension OK, oil topped off.

ROOT CAUSE: Thermal valve degraded — stuck partially closed, reducing oil flow through cooler. Combined with summer ambient temperatures, pushed discharge temp above alarm threshold.

RESOLUTION: Thermal valve replaced. Oil changed. Condenser cleaned. Operating well within limits.

RECOMMENDATION: Test thermal valve annually (should open at 170°F — bypass oil cooler). Clean condenser quarterly, more frequently in summer. Install ambient temp monitor in compressor room — consider exhaust fan upgrade if room regularly exceeds 95°F.`,
  },
  {
    assetName: "FANUC Robot — Robot-001",
    model: "R-2000iC/165F",
    manufacturer: "FANUC",
    summary: `MAINTENANCE PATTERN ANALYSIS: FANUC Robot-001 (Model R-2000iC/165F, Controller R-30iB Plus)
Period: Last 90 days | Events: 7 work orders including safety-critical items

ACTIVE CONCERN: J1 reducer vibration elevated — 4.2 mm/s vs 2.8 mm/s baseline (50% increase). Monitoring.

KEY EVENTS:
- Encoder cable fault E-731 on J2 (52 days ago): Following error during fast traverse. Cable wear at CN2 bend point. Rerouted with strain relief. No recurrence.
- Collision event (40 days ago): Torque sensor triggered SRVO-050. No fixture obstruction found — likely part misplace in fixture. Re-mastered all 6 axes. TCP verified within 0.5mm.
- Weld schedule 4 adjustment (15 days ago): Current increased 12.5kA → 13.0kA per engineering. Nugget diameter improved 4.8mm → 5.2mm (spec min 5.0mm).
- J1 reducer noise (3 days ago): Grinding noise during CW rotation >50% speed. Vibration 4.2 mm/s RMS vs 2.8 mm/s baseline. Scheduled for inspection next PM window.

OPEN RISK: J1 reducer vibration trend. If vibration continues to rise, reducer replacement required (Nabtesco RV-320CA). Lead time: 4-6 weeks. Recommend ordering spare now.

RECOMMENDATION: Increase J1 vibration monitoring from quarterly to monthly. If reading exceeds 5.5 mm/s, schedule immediate replacement. Keep J1 speed below 80% until reducer is inspected.`,
  },
];

export async function seedWorkOrderPatterns(tenantId: string): Promise<SeedKnowledgeResult> {
  const result: SeedKnowledgeResult = { chunked: 0, embedded: 0, inserted: 0, failed: 0 };

  const chunks: KnowledgeChunk[] = DEMO_WO_PATTERNS.map((p) => ({
    content: p.summary,
    manufacturer: p.manufacturer,
    modelNumber: p.model,
    sourceType: "work_order_history",
    chunkType: "text",
  }));
  result.chunked = chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await embedText(chunk.content);
    if (!embedding) {
      result.failed++;
      continue;
    }
    result.embedded++;

    const ok = await insertKnowledgeEntry(chunk, embedding, tenantId);
    if (ok) result.inserted++;
    else result.failed++;
  }

  console.log(`[knowledge-seed] WO patterns seeded: ${result.inserted}/${chunks.length}`);
  return result;
}

// ---------------------------------------------------------------------------
// #156 — Nameplate asset seed (tenant-scoped knowledge from nameplate data)
// ---------------------------------------------------------------------------

export interface NameplateInput {
  manufacturer: string;
  modelNumber: string;
  serial?: string;
  voltage?: string;
  fla?: string;
  hp?: string;
  frequency?: string;
  rpm?: string;
}

export interface SeedAssetFromNameplateResult {
  linkedChunks: number;
  inserted: number;
}

/**
 * Query NeonDB for existing OEM manual chunks matching this manufacturer + model
 * (no tenant filter — OEM manuals are shared/global), then insert one
 * tenant-scoped knowledge chunk that links the nameplate specs to those entries.
 */
export async function seedAssetFromNameplate(
  tenantId: string,
  nameplate: NameplateInput,
): Promise<SeedAssetFromNameplateResult> {
  const { manufacturer, modelNumber } = nameplate;

  // Step 1 — Count existing OEM manual chunks for this model (global, no tenant filter)
  let linkedChunks = 0;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const url = process.env.NEON_DATABASE_URL;
    if (!url) {
      console.warn("[knowledge-seed] NEON_DATABASE_URL not set — skipping nameplate OEM lookup");
    } else {
      const sql = neon(url);
      const rows = await sql`
        SELECT COUNT(*) AS cnt
        FROM knowledge_entries
        WHERE manufacturer ILIKE ${manufacturer}
          AND model_number ILIKE ${modelNumber}
      `;
      linkedChunks = Number(rows[0]?.cnt ?? 0);
    }
  } catch (err) {
    console.error("[knowledge-seed] OEM chunk lookup failed:", err);
  }

  // Step 2 — Build context chunk text (omit undefined/null spec fields)
  const specParts: string[] = [];
  if (nameplate.voltage) specParts.push(`Voltage: ${nameplate.voltage}`);
  if (nameplate.fla) specParts.push(`FLA: ${nameplate.fla}`);
  if (nameplate.hp) specParts.push(`HP: ${nameplate.hp}`);
  if (nameplate.frequency) specParts.push(`Frequency: ${nameplate.frequency}`);
  if (nameplate.rpm) specParts.push(`RPM: ${nameplate.rpm}`);

  const assetLabel = nameplate.serial
    ? `${nameplate.serial} (${manufacturer} ${modelNumber})`
    : `${manufacturer} ${modelNumber}`;

  const specsLine = specParts.length > 0 ? `\nSpecifications: ${specParts.join(", ")}` : "";

  const chunkText =
    `Asset: ${assetLabel}\n` +
    `Linked OEM documentation: ${linkedChunks} chunks found in knowledge base.` +
    specsLine;

  // Step 3 — Embed the chunk
  const embedding = await embedText(chunkText);
  if (!embedding) {
    console.warn("[knowledge-seed] Embedding failed for nameplate asset:", assetLabel);
    return { linkedChunks, inserted: 0 };
  }

  // Step 4 — Insert via the shared helper
  const chunk: KnowledgeChunk = {
    content: chunkText,
    manufacturer,
    modelNumber,
    sourceType: "nameplate_asset",
    chunkType: "text",
  };

  const ok = await insertKnowledgeEntry(chunk, embedding, tenantId);
  if (!ok) {
    console.error("[knowledge-seed] Insert failed for nameplate asset:", assetLabel);
    return { linkedChunks, inserted: 0 };
  }

  console.log(
    `[knowledge-seed] Nameplate seeded: tenant=%s asset=%s linkedChunks=%d`,
    tenantId,
    assetLabel,
    linkedChunks,
  );
  return { linkedChunks, inserted: 1 };
}
