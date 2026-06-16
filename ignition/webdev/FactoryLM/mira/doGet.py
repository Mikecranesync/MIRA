# Web Dev Module Handler: GET /system/webdev/FactoryLM/mira
# Returns the MIRA Chat UI as an inline HTML page.
# Accepts optional URL params:
#   ?asset=<asset_id>    — sets active asset context in the UI
#   ?alarm=<alarm_code>  — pre-injects alarm context as opening message
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.UI")

    params     = request.get("params", {}) or {}
    asset_id   = params.get("asset", "")   or ""
    alarm_msg  = params.get("alarm", "")   or ""

    logger.debug("MIRA UI request — asset: %s, alarm: %s" % (asset_id or "(none)", alarm_msg or "(none)"))

    # Inject runtime values into JS via a small inline config block.
    # We build the JS snippet separately so the HTML template stays clean.
    js_config = (
        "window.MIRA_CONFIG = {"
        "  assetId: %r,"
        "  alarmMsg: %r"
        "};"
    ) % (asset_id, alarm_msg)

    html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>MIRA &mdash; Maintenance Co-Pilot</title>
<style>
/* =====================================================================
   RESET & BASE
   ===================================================================== */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: #0d0d0d;
  color: #e0e0e0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

/* =====================================================================
   LAYOUT SHELL
   ===================================================================== */
#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 375px;
}

/* ---- Header ---- */
#header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  min-height: 48px;
  padding: 0 16px;
  background: #111111;
  border-bottom: 1px solid #222222;
  flex-shrink: 0;
  z-index: 10;
}

#header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

#logo {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #00b4a6;
  text-transform: uppercase;
}

#asset-badge {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: #1a1a1a;
  border: 1px solid #333333;
  border-radius: 4px;
  font-size: 11px;
  color: #888888;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

#asset-badge.visible {
  display: flex;
}

#asset-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00b4a6;
}

#header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

#alerts-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid #333333;
  border-radius: 4px;
  color: #888888;
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  font-family: inherit;
  white-space: nowrap;
}

#alerts-toggle-btn:hover {
  border-color: #555555;
  color: #cccccc;
}

#alert-indicator {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #888888;
  transition: background 0.3s;
}

#alert-indicator.has-critical {
  background: #FF4444;
  box-shadow: 0 0 6px rgba(255, 68, 68, 0.6);
}

#alert-indicator.has-warning {
  background: #FFBB33;
  box-shadow: 0 0 6px rgba(255, 187, 51, 0.5);
}

/* ---- Body row (chat + sidebar) ---- */
#body-row {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* ---- Chat area ---- */
#chat-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

#message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-behavior: smooth;
}

#message-list::-webkit-scrollbar {
  width: 5px;
}

#message-list::-webkit-scrollbar-track {
  background: transparent;
}

#message-list::-webkit-scrollbar-thumb {
  background: #2a2a2a;
  border-radius: 3px;
}

#message-list::-webkit-scrollbar-thumb:hover {
  background: #404040;
}

/* ---- Input bar ---- */
#input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  background: #111111;
  border-top: 1px solid #222222;
  min-height: 60px;
  flex-shrink: 0;
}

#input-wrap {
  flex: 1;
  position: relative;
}

#chat-input {
  width: 100%;
  padding: 9px 12px;
  background: #1a1a1a;
  border: 1px solid #333333;
  border-radius: 6px;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  resize: none;
  max-height: 120px;
  min-height: 38px;
  overflow-y: auto;
  transition: border-color 0.15s;
  outline: none;
}

#chat-input::placeholder {
  color: #555555;
}

#chat-input:focus {
  border-color: #00b4a6;
}

#chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

#send-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #00b4a6;
  border: none;
  border-radius: 6px;
  color: #0d0d0d;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  font-size: 16px;
  font-weight: 700;
}

#send-btn:hover:not(:disabled) {
  background: #00968a;
}

#send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #00b4a6;
}

/* =====================================================================
   MESSAGES
   ===================================================================== */
.msg {
  display: flex;
  flex-direction: column;
  max-width: 78%;
  animation: fadeSlideIn 0.18s ease-out;
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Mira messages — left */
.msg.mira {
  align-self: flex-start;
}

/* User messages — right */
.msg.user {
  align-self: flex-end;
}

/* System / context injection messages — center */
.msg.system {
  align-self: center;
  max-width: 92%;
}

.msg-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 4px;
  padding-left: 4px;
}

.msg.mira  .msg-label { color: #00b4a6; }
.msg.user  .msg-label { color: #888888; text-align: right; padding-right: 4px; padding-left: 0; }
.msg.system .msg-label { display: none; }

.msg-bubble {
  padding: 10px 14px;
  border-radius: 8px;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}

.msg.mira .msg-bubble {
  background: #1e1e1e;
  border-left: 3px solid #00b4a6;
  border-radius: 2px 8px 8px 2px;
  color: #e0e0e0;
}

.msg.user .msg-bubble {
  background: #2a2a2a;
  border-radius: 8px 2px 8px 8px;
  color: #e0e0e0;
}

.msg.system .msg-bubble {
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  color: #888888;
  font-size: 12px;
  font-style: italic;
  text-align: center;
}

/* Code blocks inside messages */
.msg-bubble code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  padding: 1px 5px;
  border-radius: 3px;
  color: #00b4a6;
}

.msg-bubble pre {
  margin: 8px 0 4px;
  padding: 10px;
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  overflow-x: auto;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre;
}

.msg-bubble pre code {
  background: transparent;
  border: none;
  padding: 0;
  color: #cccccc;
}

/* Source citations */
.msg-sources {
  margin-top: 8px;
}

.msg-sources details {
  font-size: 12px;
}

.msg-sources summary {
  cursor: pointer;
  color: #555555;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
  transition: color 0.15s;
  outline: none;
}

.msg-sources summary::-webkit-details-marker { display: none; }

.msg-sources summary:hover { color: #888888; }

.msg-sources details[open] summary { color: #888888; }

.source-toggle-icon {
  font-size: 9px;
  transition: transform 0.15s;
  display: inline-block;
  color: #555555;
}

details[open] .source-toggle-icon {
  transform: rotate(90deg);
}

.source-list {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.source-card {
  background: #161616;
  border: 1px solid #252525;
  border-radius: 4px;
  padding: 7px 10px;
}

.source-card-header {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  color: #00b4a6;
  margin-bottom: 3px;
}

.source-card-excerpt {
  font-size: 11px;
  color: #666666;
  line-height: 1.4;
  font-style: italic;
}

/* ---- Typing indicator ---- */
#typing-indicator {
  display: none;
  align-self: flex-start;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #1e1e1e;
  border-left: 3px solid #00b4a6;
  border-radius: 2px 8px 8px 2px;
  max-width: 78%;
}

#typing-indicator.visible {
  display: flex;
}

.typing-label {
  font-size: 12px;
  color: #555555;
  font-style: italic;
}

.typing-dots {
  display: flex;
  gap: 4px;
  align-items: center;
}

.typing-dots span {
  width: 5px;
  height: 5px;
  background: #00b4a6;
  border-radius: 50%;
  animation: typingBounce 1.2s infinite ease-in-out;
  opacity: 0.4;
}

.typing-dots span:nth-child(1) { animation-delay: 0s; }
.typing-dots span:nth-child(2) { animation-delay: 0.18s; }
.typing-dots span:nth-child(3) { animation-delay: 0.36s; }

@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30%           { transform: translateY(-5px); opacity: 1; }
}

/* =====================================================================
   ALERT SIDEBAR
   ===================================================================== */
#alert-sidebar {
  width: 280px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  background: #161616;
  border-left: 1px solid #222222;
  overflow: hidden;
  transition: width 0.22s ease, min-width 0.22s ease;
  flex-shrink: 0;
}

#alert-sidebar.collapsed {
  width: 0;
  min-width: 0;
  border-left: none;
}

#sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #222222;
  flex-shrink: 0;
}

#sidebar-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #888888;
}

#sidebar-refresh-info {
  font-size: 10px;
  color: #444444;
}

#alert-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

#alert-list::-webkit-scrollbar { width: 4px; }
#alert-list::-webkit-scrollbar-track { background: transparent; }
#alert-list::-webkit-scrollbar-thumb { background: #252525; border-radius: 2px; }

.alert-card {
  padding: 9px 11px;
  background: #1a1a1a;
  border: 1px solid #252525;
  border-radius: 5px;
  cursor: default;
  transition: border-color 0.15s;
}

.alert-card:hover {
  border-color: #333333;
}

.alert-card-top {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 3px;
}

.alert-sev-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.alert-sev-dot.critical {
  background: #FF4444;
  box-shadow: 0 0 5px rgba(255, 68, 68, 0.5);
}

.alert-sev-dot.warning {
  background: #FFBB33;
  box-shadow: 0 0 5px rgba(255, 187, 51, 0.4);
}

.alert-sev-dot.info {
  background: #4499FF;
}

.alert-sev-dot.ok {
  background: #44BB66;
}

.alert-type {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  color: #cccccc;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alert-time {
  font-size: 10px;
  color: #555555;
  flex-shrink: 0;
}

.alert-msg {
  font-size: 11px;
  color: #666666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 15px;
}

.alerts-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #444444;
  font-size: 12px;
  font-style: italic;
  padding: 24px;
  text-align: center;
}

.alerts-error {
  padding: 12px;
  font-size: 11px;
  color: #664444;
  text-align: center;
}

/* =====================================================================
   ERROR TOAST
   ===================================================================== */
#toast {
  position: fixed;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: #2a1414;
  border: 1px solid #FF4444;
  border-radius: 6px;
  color: #FF4444;
  padding: 8px 16px;
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
  z-index: 100;
  white-space: nowrap;
  max-width: calc(100vw - 32px);
  text-align: center;
}

#toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* =====================================================================
   RESPONSIVE
   ===================================================================== */
@media (max-width: 600px) {
  #alert-sidebar {
    position: absolute;
    right: 0;
    top: 48px;
    bottom: 60px;
    z-index: 20;
    border-left: 1px solid #222222;
    box-shadow: -4px 0 16px rgba(0,0,0,0.5);
  }

  #alert-sidebar.collapsed {
    width: 0;
    min-width: 0;
  }

  .msg {
    max-width: 92%;
  }
}
</style>
</head>
<body>
<div id="app">

  <!-- ================================================================
       HEADER
       ================================================================ -->
  <header id="header">
    <div id="header-left">
      <div id="logo">MIRA</div>
      <div id="asset-badge">
        <span id="asset-badge-dot"></span>
        <span id="asset-badge-label"></span>
      </div>
    </div>
    <div id="header-right">
      <button id="alerts-toggle-btn" type="button" title="Toggle alert sidebar">
        <span id="alert-indicator"></span>
        ALERTS
      </button>
    </div>
  </header>

  <!-- ================================================================
       BODY ROW
       ================================================================ -->
  <div id="body-row">

    <!-- Chat area -->
    <div id="chat-area">
      <div id="message-list" role="log" aria-live="polite" aria-label="Conversation">
        <!-- Messages injected here -->
        <div id="typing-indicator" role="status" aria-label="Mira is typing">
          <div class="typing-dots">
            <span></span><span></span><span></span>
          </div>
          <span class="typing-label">Mira is thinking&hellip;</span>
        </div>
      </div>
    </div>

    <!-- Alert sidebar -->
    <aside id="alert-sidebar" aria-label="Recent alerts">
      <div id="sidebar-header">
        <span id="sidebar-title">Recent Alerts</span>
        <span id="sidebar-refresh-info">auto-refresh 10s</span>
      </div>
      <div id="alert-list" aria-live="polite" aria-label="Alert list">
        <div class="alerts-empty">No recent alerts</div>
      </div>
    </aside>

  </div><!-- /body-row -->

  <!-- ================================================================
       INPUT BAR
       ================================================================ -->
  <div id="input-bar">
    <div id="input-wrap">
      <textarea
        id="chat-input"
        placeholder="Type your question&hellip;"
        rows="1"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="sentences"
        spellcheck="true"
        aria-label="Message input"
      ></textarea>
    </div>
    <button id="send-btn" type="button" title="Send (Enter)" aria-label="Send message">
      &#10148;
    </button>
  </div>

</div><!-- /app -->

<!-- Error toast -->
<div id="toast" role="alert" aria-live="assertive"></div>

<!-- ====================================================================
     RUNTIME CONFIG (injected by Jython doGet)
     ==================================================================== -->
<script>
MIRA_CONFIG_PLACEHOLDER
</script>

<!-- ====================================================================
     APPLICATION JAVASCRIPT
     ==================================================================== -->
<script>
(function () {
  'use strict';

  // =========================================================================
  // STATE
  // =========================================================================
  var cfg         = window.MIRA_CONFIG || {};
  var currentAsset = cfg.assetId || '';
  var isBusy       = false;
  var alertTimer   = null;
  var toastTimer   = null;
  var sidebarOpen  = true;

  // =========================================================================
  // DOM REFS
  // =========================================================================
  var msgList        = document.getElementById('message-list');
  var typingIndicator= document.getElementById('typing-indicator');
  var chatInput      = document.getElementById('chat-input');
  var sendBtn        = document.getElementById('send-btn');
  var alertList      = document.getElementById('alert-list');
  var alertIndicator = document.getElementById('alert-indicator');
  var alertSidebar   = document.getElementById('alert-sidebar');
  var alertsToggleBtn= document.getElementById('alerts-toggle-btn');
  var assetBadge     = document.getElementById('asset-badge');
  var assetBadgeLabel= document.getElementById('asset-badge-label');
  var toast          = document.getElementById('toast');

  // =========================================================================
  // ASSET BADGE
  // =========================================================================
  function setAsset(assetId) {
    currentAsset = assetId || '';
    if (currentAsset) {
      assetBadgeLabel.textContent = currentAsset;
      assetBadge.classList.add('visible');
    } else {
      assetBadge.classList.remove('visible');
    }
  }

  setAsset(currentAsset);

  // =========================================================================
  // SIDEBAR TOGGLE
  // =========================================================================
  function setSidebar(open) {
    sidebarOpen = open;
    if (open) {
      alertSidebar.classList.remove('collapsed');
      alertsToggleBtn.setAttribute('aria-pressed', 'true');
    } else {
      alertSidebar.classList.add('collapsed');
      alertsToggleBtn.setAttribute('aria-pressed', 'false');
    }
  }

  alertsToggleBtn.addEventListener('click', function () {
    setSidebar(!sidebarOpen);
  });

  // =========================================================================
  // TOAST
  // =========================================================================
  function showToast(msg, durationMs) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimer = setTimeout(function () {
      toast.classList.remove('show');
    }, durationMs || 4000);
  }

  // =========================================================================
  // MESSAGE RENDERING
  // =========================================================================

  /**
   * Escape HTML special chars in a string for safe insertion.
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Very lightweight markdown-like formatter:
   * - **bold**
   * - `inline code`
   * - ```fenced code blocks```
   * - Preserves newlines
   */
  function formatText(raw) {
    // Fenced code blocks first (before escaping)
    var parts  = [];
    var remain = String(raw);
    var fenceRe = /```([a-z]*)\n?([\s\S]*?)```/g;
    var lastIndex = 0;
    var m;

    fenceRe.lastIndex = 0;
    while ((m = fenceRe.exec(remain)) !== null) {
      // text before this block
      parts.push({ type: 'text', val: remain.slice(lastIndex, m.index) });
      parts.push({ type: 'code', lang: m[1], val: m[2] });
      lastIndex = fenceRe.lastIndex;
    }
    parts.push({ type: 'text', val: remain.slice(lastIndex) });

    return parts.map(function (p) {
      if (p.type === 'code') {
        return '<pre><code>' + escapeHtml(p.val) + '</code></pre>';
      }
      // Escape then apply inline markup
      var s = escapeHtml(p.val);
      // **bold**
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // `inline code`
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      // Preserve newlines
      s = s.replace(/\n/g, '<br>');
      return s;
    }).join('');
  }

  /**
   * Build a source citation block from the sources array returned by the API.
   * Each source: { file: "GS10_Manual.pdf", page: 12, excerpt: "..." }
   */
  function buildSourcesHtml(sources) {
    if (!sources || !sources.length) return '';

    var items = sources.map(function (src) {
      var label = escapeHtml(src.file || 'Unknown source');
      if (src.page) label += ' &mdash; page ' + escapeHtml(String(src.page));
      var excerpt = src.excerpt
        ? '<div class="source-card-excerpt">&ldquo;' + escapeHtml(src.excerpt) + '&rdquo;</div>'
        : '';
      return (
        '<div class="source-card">' +
          '<div class="source-card-header">' + label + '</div>' +
          excerpt +
        '</div>'
      );
    }).join('');

    return (
      '<div class="msg-sources">' +
        '<details>' +
          '<summary>' +
            '<span class="source-toggle-icon">&#9658;</span>' +
            'Sources (' + sources.length + ')' +
          '</summary>' +
          '<div class="source-list">' + items + '</div>' +
        '</details>' +
      '</div>'
    );
  }

  /**
   * Append a message bubble to the chat list.
   * role: 'mira' | 'user' | 'system'
   * text: plain string
   * sources: array (optional, only for mira)
   */
  function appendMessage(role, text, sources) {
    // Remove typing indicator from DOM flow, re-add at bottom after message
    var wasVisible = typingIndicator.classList.contains('visible');

    var wrapper = document.createElement('div');
    wrapper.className = 'msg ' + role;

    var label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = role === 'mira' ? 'Mira' : role === 'user' ? 'You' : '';
    wrapper.appendChild(label);

    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = formatText(text);
    wrapper.appendChild(bubble);

    if (role === 'mira' && sources && sources.length) {
      var srcHtml = buildSourcesHtml(sources);
      if (srcHtml) {
        var srcDiv = document.createElement('div');
        srcDiv.innerHTML = srcHtml;
        wrapper.appendChild(srcDiv.firstChild);
      }
    }

    // Insert before typing indicator
    msgList.insertBefore(wrapper, typingIndicator);
    scrollToBottom();

    if (wasVisible) {
      // Keep typing indicator visible and scrolled into view
      scrollToBottom();
    }

    return wrapper;
  }

  /** Shorthand for system context messages */
  function addSystemMessage(text) {
    appendMessage('system', text, null);
  }

  function scrollToBottom() {
    msgList.scrollTop = msgList.scrollHeight;
  }

  // =========================================================================
  // TYPING INDICATOR
  // =========================================================================
  function showTyping() {
    typingIndicator.classList.add('visible');
    scrollToBottom();
  }

  function hideTyping() {
    typingIndicator.classList.remove('visible');
  }

  // =========================================================================
  // INPUT HELPERS
  // =========================================================================
  function setInputBusy(busy) {
    isBusy = busy;
    chatInput.disabled = busy;
    sendBtn.disabled   = busy;
  }

  /** Auto-grow textarea height */
  function resizeInput() {
    chatInput.style.height = 'auto';
    var newH = Math.min(chatInput.scrollHeight, 120);
    chatInput.style.height = newH + 'px';
  }

  chatInput.addEventListener('input', resizeInput);

  // =========================================================================
  // SEND MESSAGE
  // =========================================================================
  function getInputText() {
    return chatInput.value.replace(/^\s+|\s+$/g, '');
  }

  async function sendMessage() {
    var text = getInputText();
    if (!text || isBusy) return;

    chatInput.value = '';
    resizeInput();
    chatInput.focus();

    appendMessage('user', text, null);
    setInputBusy(true);
    showTyping();

    try {
      var resp = await fetch('/system/webdev/FactoryLM/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query:    text,
          asset_id: currentAsset
        })
      });

      if (!resp.ok) {
        var errBody = '';
        try { errBody = (await resp.json()).error || ''; } catch (e) {}
        throw new Error('HTTP ' + resp.status + (errBody ? ': ' + errBody : ''));
      }

      var data = await resp.json();
      var answer  = data.answer  || '(No response received)';
      var sources = data.sources || [];

      hideTyping();
      appendMessage('mira', answer, sources);

    } catch (err) {
      hideTyping();
      appendMessage('mira', 'Sorry, I could not reach the diagnostics service. Please try again.', null);
      showToast('Error: ' + (err.message || 'Unknown error'));
    } finally {
      setInputBusy(false);
      chatInput.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);

  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // =========================================================================
  // ALERTS
  // =========================================================================

  /** Convert ISO timestamp (or epoch ms string) to relative time string */
  function relativeTime(tsStr) {
    if (!tsStr) return '';
    var d = new Date(tsStr);
    if (isNaN(d.getTime())) return tsStr;
    var diffMs = Date.now() - d.getTime();
    var diffS  = Math.round(diffMs / 1000);
    if (diffS < 5)   return 'just now';
    if (diffS < 60)  return diffS + 's ago';
    if (diffS < 3600) return Math.floor(diffS / 60) + 'm ago';
    if (diffS < 86400) return Math.floor(diffS / 3600) + 'h ago';
    return Math.floor(diffS / 86400) + 'd ago';
  }

  /** Determine severity dot CSS class from severity string */
  function sevClass(sev) {
    if (!sev) return 'info';
    var s = String(sev).toLowerCase();
    if (s === 'critical' || s === 'high' || s === 'error') return 'critical';
    if (s === 'warning'  || s === 'warn' || s === 'medium') return 'warning';
    if (s === 'ok'       || s === 'clear' || s === 'low')   return 'ok';
    return 'info';
  }

  function renderAlerts(alerts) {
    alertList.innerHTML = '';

    if (!alerts || !alerts.length) {
      var empty = document.createElement('div');
      empty.className = 'alerts-empty';
      empty.textContent = 'No recent alerts';
      alertList.appendChild(empty);
      alertIndicator.className = '';
      return;
    }

    // Determine worst severity for header indicator
    var hasCritical = false;
    var hasWarning  = false;

    alerts.forEach(function (a) {
      var sc = sevClass(a.severity || a.level || a.type || '');
      if (sc === 'critical') hasCritical = true;
      if (sc === 'warning')  hasWarning  = true;

      var card = document.createElement('div');
      card.className = 'alert-card';

      var top = document.createElement('div');
      top.className = 'alert-card-top';

      var dot = document.createElement('span');
      dot.className = 'alert-sev-dot ' + sc;
      top.appendChild(dot);

      var type = document.createElement('span');
      type.className = 'alert-type';
      type.textContent = a.type || a.alarm || a.name || 'ALERT';
      top.appendChild(type);

      var time = document.createElement('span');
      time.className = 'alert-time';
      time.textContent = relativeTime(a.timestamp || a.ts || a.created_at || '');
      top.appendChild(time);

      card.appendChild(top);

      if (a.message || a.msg || a.description) {
        var msgEl = document.createElement('div');
        msgEl.className = 'alert-msg';
        msgEl.textContent = a.message || a.msg || a.description || '';
        card.appendChild(msgEl);
      }

      alertList.appendChild(card);
    });

    // Update header indicator
    if (hasCritical) {
      alertIndicator.className = 'has-critical';
    } else if (hasWarning) {
      alertIndicator.className = 'has-warning';
    } else {
      alertIndicator.className = '';
    }
  }

  async function refreshAlerts() {
    var url = '/system/webdev/FactoryLM/api/alerts?limit=10';
    if (currentAsset) url += '&asset=' + encodeURIComponent(currentAsset);

    try {
      var resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      renderAlerts(data.alerts || data || []);
    } catch (err) {
      // Don't thrash the UI on transient network errors — just leave stale data
      // Only show error if list is currently empty
      if (!alertList.querySelector('.alert-card')) {
        alertList.innerHTML = '<div class="alerts-error">Could not load alerts</div>';
      }
    }
  }

  function startAlertPolling() {
    refreshAlerts();
    alertTimer = setInterval(refreshAlerts, 10000);
  }

  // =========================================================================
  // postMessage LISTENER (Perspective iframe embedding)
  // =========================================================================
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'MIRA_CONTEXT') return;

    if (e.data.assetId) {
      setAsset(e.data.assetId);
      addSystemMessage('Asset context updated: ' + e.data.assetId);
      // Restart alert polling with new asset
      clearInterval(alertTimer);
      startAlertPolling();
    }
    if (e.data.alarm) {
      addSystemMessage('Alert context: ' + e.data.alarm);
    }
    if (e.data.tagPath) {
      addSystemMessage('Tag: ' + e.data.tagPath);
    }
  });

  // =========================================================================
  // INIT
  // =========================================================================
  function init() {
    // Welcome message
    appendMessage(
      'mira',
      'Hello! I\'m Mira, your maintenance co-pilot. Ask me about equipment diagnostics, maintenance procedures, or alert context. I have access to your uploaded documentation and live tag values.',
      null
    );

    // If alarm was passed via URL, inject context message and pre-fill input
    var alarmCtx = cfg.alarmMsg || '';
    if (alarmCtx) {
      addSystemMessage('Alert context: ' + alarmCtx);
      chatInput.value = 'What does the alert "' + alarmCtx + '" mean and what should I do?';
      resizeInput();
    }

    // Start alert polling
    startAlertPolling();

    // Focus input
    chatInput.focus();
  }

  init();

})();
</script>

</body>
</html>"""

    # Replace the config placeholder with the actual JS config block.
    # This avoids any Python string formatting issues with curly braces
    # that are present throughout the HTML/JS.
    html = html.replace("MIRA_CONFIG_PLACEHOLDER", js_config)

    return {"html": html}
