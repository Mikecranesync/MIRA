'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { OpenAI } = require('openai');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.MIRA_WEB_PORT || '3200', 10);

// claude-opus-4-5 is the verified alias for claude-opus-4-5-20251101
// Docs: https://docs.anthropic.com/en/docs/about-claude/models/overview
const CHAT_MODEL = 'claude-opus-4-5';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MCP_REST_API_KEY = process.env.MCP_REST_API_KEY || '';
const MCP_BASE_URL = process.env.MCP_BASE_URL || 'http://mira-mcp:8001';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const MIRA_SYSTEM_PROMPT = `You are Mira, the Factory LM industrial maintenance AI. \
You help field technicians diagnose equipment faults, find root causes, and take corrective action fast.

Rules:
- Be specific and actionable. No hedging, no filler phrases.
- Keep responses under 5 sentences unless technical detail demands more.
- When citing a source, use this exact format: [§SECTION document PAGE]
  Example: [§12.4 FANUC R-30iB Maintenance Manual p.284]
- If a work order should be created, open your recommendation with "WO RECOMMENDED:"
- Never start with "Certainly!", "Great!", "Of course!", or similar filler.
- If you do not have enough information to diagnose, ask one targeted question.`;

// ─── Clients ─────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ─── Express ─────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ─── Session store ───────────────────────────────────────────────────────────

/** @type {Map<string, { session_id: string, tier: string, created_at: number, message_count: number }>} */
const sessions = new Map();

// Prune expired sessions every hour
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, sess] of sessions.entries()) {
    if (sess.created_at < cutoff) sessions.delete(id);
  }
}, 60 * 60 * 1000).unref();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Write a single SSE event. */
function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Set SSE response headers. */
function setSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();
}

/** Remove temp file without throwing. */
function cleanupFile(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) {}
}

/** Extract [§...] citation markers from text and return unique refs. */
function extractCitations(text) {
  const re = /\[§([^\]]+)\]/g;
  const refs = [];
  let m;
  while ((m = re.exec(text)) !== null) refs.push(m[1]);
  return [...new Set(refs)];
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', model: CHAT_MODEL }));

// POST /api/mira/session — create a new anonymous session
app.post('/api/mira/session', (_req, res) => {
  const session_id = uuidv4();
  const session = { session_id, tier: 'SIGNAL', created_at: Date.now(), message_count: 0 };
  sessions.set(session_id, session);
  res.json(session);
});

// GET /api/mira/session/:id — retrieve session state
app.get('/api/mira/session/:id', (req, res) => {
  const sess = sessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: 'session_expired' });
  const expired = Date.now() - sess.created_at > SESSION_TTL_MS;
  if (expired) {
    sessions.delete(req.params.id);
    return res.status(404).json({ error: 'session_expired' });
  }
  res.json(sess);
});

// POST /api/mira/chat — SSE streaming text response
app.post('/api/mira/chat', async (req, res) => {
  const { message, session_id, history = [] } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const sess = sessions.get(session_id);
  if (sess) sess.message_count++;

  setSseHeaders(res);

  // Build message array: up to 10 history turns + new user message
  const messages = [
    ...history.slice(-10).map(h => ({
      role: h.role === 'mira' ? 'assistant' : 'user',
      content: String(h.content),
    })),
    { role: 'user', content: message },
  ];

  let stream;
  try {
    stream = anthropic.messages.stream({
      model: CHAT_MODEL,
      max_tokens: 1024,
      system: MIRA_SYSTEM_PROMPT,
      messages,
    });

    // Abort stream if client disconnects mid-stream (res.close fires only on actual socket close)
    res.on('close', () => { if (!res.writableEnded) { try { stream.abort(); } catch (_) {} } });

    let fullText = '';

    stream.on('text', (text) => {
      fullText += text;
      sse(res, { type: 'token', content: text });
    });

    await stream.finalMessage();

    // Emit parsed citations after streaming completes
    for (const ref of extractCitations(fullText)) {
      sse(res, { type: 'citation', ref });
    }

    sse(res, { type: 'done', session_id: session_id || null });
  } catch (err) {
    console.error('[chat] error:', err.message);
    sse(res, { type: 'error', message: 'Inference error — please try again' });
  } finally {
    res.end();
  }
});

// POST /api/mira/vision — SSE streaming vision analysis
app.post('/api/mira/vision', upload.single('image'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'image required' });
  if (!ANTHROPIC_API_KEY) {
    cleanupFile(file.path);
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { session_id, context } = req.body;

  setSseHeaders(res);

  let stream;
  try {
    const imageBuffer = fs.readFileSync(file.path);
    const base64 = imageBuffer.toString('base64');
    // Determine media type from multer's detected mime, fallback to jpeg
    const mediaType = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)
      ? file.mimetype
      : 'image/jpeg');

    let contextTurns = [];
    if (context) {
      try { contextTurns = JSON.parse(context); } catch (_) {}
    }

    const contextSummary = contextTurns
      .slice(-5)
      .map(m => `${m.role === 'mira' ? 'Mira' : 'Tech'}: ${m.content}`)
      .join('\n') || 'None';

    const visionPrompt = `You are Mira, the Factory LM maintenance AI. A field technician has uploaded an image.

RECENT CONVERSATION:
${contextSummary}

Analyze the image and:
1. Identify the equipment, component, or fault condition visible
2. Provide one specific, actionable troubleshooting step
3. Cite your source if applicable using [§SECTION document PAGE]
4. If a work order should be created, begin with "WO RECOMMENDED:"

Be concise. The technician is on a noisy shop floor.`;

    // Abort stream if client disconnects mid-stream
    res.on('close', () => { if (!res.writableEnded && stream) { try { stream.abort(); } catch (_) {} } });

    stream = anthropic.messages.stream({
      model: CHAT_MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          { type: 'text', text: visionPrompt },
        ],
      }],
    });

    let fullText = '';

    stream.on('text', (text) => {
      fullText += text;
      sse(res, { type: 'token', content: text });
    });

    await stream.finalMessage();

    for (const ref of extractCitations(fullText)) {
      sse(res, { type: 'citation', ref });
    }

    sse(res, { type: 'done', session_id: session_id || null });
  } catch (err) {
    console.error('[vision] error:', err.message);
    sse(res, { type: 'error', message: 'Vision analysis failed — please try again' });
  } finally {
    cleanupFile(file.path);
    res.end();
  }
});

// POST /api/transcribe — Whisper transcription for iOS/Firefox fallback
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'audio required' });
  if (!OPENAI_API_KEY) {
    cleanupFile(file.path);
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured — transcription unavailable' });
  }

  try {
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(file.path),
      model: 'whisper-1',
      language: 'en',
    });
    res.json({ transcript: transcript.text });
  } catch (err) {
    console.error('[transcribe] error:', err.message);
    res.status(500).json({ error: 'Transcription failed' });
  } finally {
    cleanupFile(file.path);
  }
});

// POST /api/mira/work-order — proxy to mira-mcp CMMS REST API
app.post('/api/mira/work-order', async (req, res) => {
  if (!MCP_REST_API_KEY) {
    return res.status(503).json({ error: 'MCP_REST_API_KEY not configured' });
  }

  const { description, session_id } = req.body;
  if (!description || typeof description !== 'string' || description.trim().length < 5) {
    return res.status(400).json({ error: 'description required (min 5 chars)' });
  }

  try {
    const response = await fetch(`${MCP_BASE_URL}/api/cmms/work-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MCP_REST_API_KEY}`,
      },
      body: JSON.stringify({
        title: description.trim().slice(0, 80),
        description: description.trim(),
        priority: req.body.priority || 'MEDIUM',
        category: 'CORRECTIVE',
      }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[work-order] error:', err.message);
    res.status(502).json({ error: 'CMMS service unavailable' });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[mira-web] listening on :${PORT}`);
  console.log(`[mira-web] model: ${CHAT_MODEL}`);
  if (!ANTHROPIC_API_KEY) console.warn('[mira-web] WARNING: ANTHROPIC_API_KEY not set — chat/vision disabled');
  if (!OPENAI_API_KEY) console.warn('[mira-web] WARNING: OPENAI_API_KEY not set — transcription disabled');
  if (!MCP_REST_API_KEY) console.warn('[mira-web] WARNING: MCP_REST_API_KEY not set — work orders disabled');
});
