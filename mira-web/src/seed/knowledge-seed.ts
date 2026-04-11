/**
 * Knowledge seed — bridges Atlas CMMS asset data into NeonDB knowledge_entries.
 *
 * When demo data is seeded, this module:
 * 1. Takes enriched asset descriptions (nameplate data, specs, fault codes)
 * 2. Chunks them into retrieval-friendly segments
 * 3. Embeds via mira-mcp /api/embed proxy (Ollama nomic-embed-text)
 * 4. Inserts into NeonDB knowledge_entries for RAG retrieval
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
  const key = MCP_KEY();
  if (!key) return null;

  try {
    const resp = await fetch(`${MCP_URL()}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({ text }),
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
