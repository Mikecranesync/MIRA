/* global window, document, navigator, AudioContext, MediaRecorder, SpeechRecognition, webkitSpeechRecognition */
/* ============================================================
   MIRA CHAT WIDGET — v1.0.0
   Self-contained IIFE. No framework. No external deps.
   Lazy-loaded via index.html on FAB hover/focus/scroll.
   ============================================================ */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────
  var API = window.MIRA_API_BASE || '';
  var TYPE_SPEED_MS = 18;
  var SILENCE_THRESHOLD = 0.015;
  var SILENCE_DURATION_MS = 1500;
  var MAX_HISTORY = 20;
  var MAX_IMAGE_PX = 1920;
  var IMAGE_QUALITY = 0.85;

  // ── State ─────────────────────────────────────────────────
  var sessionId = null;
  var sessionTier = 'SIGNAL';
  var sessionExpired = false;
  var history = [];           // { role:'user'|'mira', content: string }
  var ttsEnabled = true;
  var micMuted = false;

  // Voice
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null;
  var mediaStream = null;
  var mediaRecorder = null;
  var audioChunks = [];
  var vadAnimFrame = null;

  // Typewriter
  var typeQueue = [];
  var typeInterval = null;
  var currentMiraBubble = null;  // the .mira-msg-body div
  var currentMiraText = '';
  var pendingFinalize = null;
  var pendingCitations = [];

  // Motion preference
  var prefersReducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // TTS state
  var activeSpeech = null;
  var waveformEl = null; // avatar waveform of last active Mira message

  // ── DOM refs ──────────────────────────────────────────────
  var fab, panel, overlay, messagesEl, thinkingEl, quickChipsEl,
      inputEl, micBtn, sendBtn, uploadBtn, fileInput,
      ttsToggleBtn, closeBtn, minimizeBtn,
      connDot, connText;

  // ── SVG icons (inline, no external deps) ─────────────────
  var ICONS = {
    mira: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M4 18V7l4 6 4-5 4 5 4-6v11" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mic:  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="9" y1="22" x2="15" y2="22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    micoff: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9 9v4a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.68-1.33" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M17 16.95A7 7 0 0 1 5 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M22 2L11 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.6"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    speakeroff: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    minimize: '—',
    close: '×',
  };

  // ── Build DOM ─────────────────────────────────────────────
  function buildWidget() {
    // Root
    var root = el('div', { id: 'mira-widget-root' });

    // Overlay (mobile backdrop)
    overlay = el('div', { id: 'mira-overlay' });
    overlay.addEventListener('click', closePanel);

    // Panel
    panel = el('div', {
      id: 'mira-panel',
      role: 'dialog',
      'aria-labelledby': 'mira-panel-title',
      'aria-modal': 'true',
      'aria-hidden': 'true',
      'data-open': 'false',
    });

    panel.appendChild(buildHeader());

    // Messages area
    messagesEl = el('div', {
      id: 'mira-messages',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Mira conversation',
    });
    addSysMsg('Session started — SIGNAL tier — Public corpus only');
    panel.appendChild(messagesEl);

    // Thinking indicator
    thinkingEl = el('div', { id: 'mira-thinking', hidden: true, 'aria-hidden': 'true' });
    thinkingEl.innerHTML = '<span></span><span></span><span></span>';
    panel.appendChild(thinkingEl);

    // Quick chips
    quickChipsEl = el('div', { id: 'mira-quick-chips', role: 'group', 'aria-label': 'Quick actions' });
    setDefaultChips();
    panel.appendChild(quickChipsEl);

    // Input bar
    panel.appendChild(buildInputBar());

    root.appendChild(overlay);
    root.appendChild(panel);

    // Grab existing FAB from DOM (rendered by index.html)
    fab = document.getElementById('mira-fab');
    if (!fab) {
      fab = el('button', { id: 'mira-fab', 'aria-label': 'Open Mira chat', 'aria-expanded': 'false', 'data-open': 'false' });
      fab.innerHTML = ICONS.mira;
      document.body.appendChild(fab);
    }
    fab.addEventListener('click', togglePanel);

    document.body.appendChild(root);

    // Keyboard: Escape closes panel
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.dataset.open === 'true') {
        e.preventDefault();
        closePanel();
        fab.focus();
      }
    });
  }

  function buildHeader() {
    var header = el('div', { id: 'mira-panel-header' });

    // Left: logo + title + connection status
    var logoRow = el('div', { class: 'mira-logo-row' });

    var logoMark = el('span', { class: 'mira-logo-mark', 'aria-hidden': 'true' });
    logoMark.innerHTML = ICONS.mira;
    logoRow.appendChild(logoMark);

    var title = el('span', { id: 'mira-panel-title' });
    title.textContent = 'MIRA';
    logoRow.appendChild(title);

    var connStatus = el('div', { class: 'mira-conn-status', 'aria-live': 'polite', 'aria-label': 'Connection status' });
    connDot = el('span', { class: 'mira-conn-dot', 'data-state': 'connecting', 'aria-hidden': 'true' });
    connText = el('span', { class: 'mira-conn-text' });
    connText.textContent = 'Connecting...';
    connStatus.appendChild(connDot);
    connStatus.appendChild(connText);
    logoRow.appendChild(connStatus);

    header.appendChild(logoRow);

    // Right: controls
    var controls = el('div', { class: 'mira-header-controls' });

    ttsToggleBtn = el('button', {
      class: 'mira-header-btn',
      'data-active': 'true',
      'aria-label': 'Disable voice readback',
      'aria-pressed': 'true',
    });
    ttsToggleBtn.innerHTML = ICONS.speaker;
    ttsToggleBtn.addEventListener('click', toggleTTS);

    minimizeBtn = el('button', {
      class: 'mira-header-btn',
      'aria-label': 'Minimize',
    });
    minimizeBtn.innerHTML = ICONS.minimize;
    minimizeBtn.addEventListener('click', closePanel);

    closeBtn = el('button', {
      class: 'mira-header-btn',
      'aria-label': 'Close Mira',
    });
    closeBtn.innerHTML = ICONS.close;
    closeBtn.addEventListener('click', closePanel);

    controls.appendChild(ttsToggleBtn);
    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    header.appendChild(controls);

    return header;
  }

  function buildInputBar() {
    var bar = el('div', { id: 'mira-input-bar' });

    // Camera/upload button
    uploadBtn = el('label', {
      id: 'mira-upload-btn',
      'aria-label': 'Upload image',
      role: 'button',
      tabindex: '0',
    });
    uploadBtn.innerHTML = ICONS.camera;

    fileInput = el('input', {
      type: 'file',
      id: 'mira-file-input',
      accept: 'image/*',
      // Note: omit 'capture' attribute on desktop; add programmatically on mobile
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) handleImageFile(fileInput.files[0]);
      fileInput.value = ''; // reset so same file can be re-selected
    });
    uploadBtn.appendChild(fileInput);

    // Keyboard support for label-as-button
    uploadBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    bar.appendChild(uploadBtn);

    // Text input
    inputEl = el('input', {
      type: 'text',
      id: 'mira-text-input',
      placeholder: 'Ask Mira...',
      'aria-label': 'Message',
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    // Clipboard paste — detect images
    inputEl.addEventListener('paste', handleClipboardPaste);
    bar.appendChild(inputEl);

    // Mic button
    micBtn = el('button', {
      id: 'mira-mic-btn',
      'aria-label': 'Start recording',
      'data-state': 'idle',
      type: 'button',
    });
    micBtn.innerHTML = ICONS.mic +
      '<span class="mira-mic-rings" aria-hidden="true"><span></span><span></span><span></span></span>';
    micBtn.addEventListener('click', handleMicClick);
    bar.appendChild(micBtn);

    // Send button
    sendBtn = el('button', {
      id: 'mira-send-btn',
      'aria-label': 'Send',
      type: 'button',
    });
    sendBtn.innerHTML = ICONS.send;
    sendBtn.addEventListener('click', handleSend);
    bar.appendChild(sendBtn);

    return bar;
  }

  // ── Panel open/close ───────────────────────────────────────

  function openPanel() {
    panel.dataset.open = 'true';
    panel.removeAttribute('aria-hidden');
    fab.dataset.open = 'true';
    fab.setAttribute('aria-expanded', 'true');
    overlay.dataset.visible = 'true';
    overlay.removeAttribute('hidden');

    // Mobile: prevent body scroll
    if (isMobile()) {
      document.body.style.overflow = 'hidden';
    }

    // Focus first focusable element in panel
    setTimeout(function () {
      inputEl.focus();
    }, 250); // after slide-in

    trapFocus(panel);
  }

  function closePanel() {
    panel.dataset.open = 'false';
    panel.setAttribute('aria-hidden', 'true');
    fab.dataset.open = 'false';
    fab.setAttribute('aria-expanded', 'false');
    overlay.dataset.visible = 'false';
    setTimeout(function () { overlay.setAttribute('hidden', ''); }, 250);
    document.body.style.overflow = '';

    // Stop any active voice recording
    stopVoice(false);
    stopTTSPlayback();
  }

  function togglePanel() {
    if (panel.dataset.open === 'true') {
      closePanel();
    } else {
      openPanel();
    }
  }

  // ── Focus trap ────────────────────────────────────────────

  function trapFocus(container) {
    var focusable = 'button:not([disabled]), input:not([disabled]), [tabindex="0"]';
    container.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var elements = Array.from(container.querySelectorAll(focusable));
      var first = elements[0];
      var last = elements[elements.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  // ── Session ───────────────────────────────────────────────

  function initSession() {
    setConnecting();
    fetch(API + '/api/mira/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        sessionId = data.session_id;
        sessionTier = data.tier || 'SIGNAL';
        setConnected();
      })
      .catch(function () {
        setConnError();
      });
  }

  function checkSession() {
    if (!sessionId) return;
    fetch(API + '/api/mira/session/' + sessionId)
      .then(function (r) {
        if (r.status === 404) {
          sessionExpired = true;
          showSessionExpiredBanner();
        }
      })
      .catch(function () {});
  }

  function setConnecting() {
    if (!connDot) return;
    connDot.dataset.state = 'connecting';
    connText.textContent = 'Connecting...';
  }

  function setConnected() {
    if (!connDot) return;
    connDot.dataset.state = 'connected';
    connDot.style.background = '';
    connText.textContent = 'Connected';
  }

  function setConnError() {
    if (!connDot) return;
    connDot.dataset.state = 'error';
    connText.textContent = 'Offline';
  }

  function showSessionExpiredBanner() {
    var banner = el('div', { class: 'mira-tier-banner', role: 'alert' });
    banner.textContent = 'Session expired — tap to reconnect.';
    banner.style.cursor = 'pointer';
    banner.addEventListener('click', function () {
      banner.remove();
      sessionExpired = false;
      initSession();
    });
    messagesEl.appendChild(banner);
    scrollToBottom();
  }

  // ── Messages ──────────────────────────────────────────────

  function addSysMsg(text) {
    var d = el('div', { class: 'mira-sys-msg', 'aria-label': text, role: 'status' });
    d.textContent = text;
    messagesEl.appendChild(d);
  }

  function addUserMsg(text, imageDataUrl) {
    var wrap = el('div', { class: 'mira-msg-user' });
    if (imageDataUrl) {
      var imgWrap = el('div', { class: 'mira-img-thumb' });
      var img = el('img', { src: imageDataUrl, alt: 'Uploaded image', loading: 'lazy' });
      img.style.cssText = 'width:200px;height:150px;object-fit:cover;border-radius:4px;display:block;';
      var badge = el('span', { class: 'mira-img-analyzed-badge', 'aria-hidden': 'true' });
      badge.textContent = 'Analyzed ✓';
      imgWrap.appendChild(img);
      imgWrap.appendChild(badge);
      wrap.appendChild(imgWrap);
    }
    if (text) {
      var txt = document.createTextNode(text);
      wrap.appendChild(txt);
    }
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function addMiraMsg() {
    var row = el('div', { class: 'mira-msg-mira' });

    // Avatar
    var avatar = el('div', { class: 'mira-avatar', 'aria-hidden': 'true' });
    avatar.innerHTML = ICONS.mira;
    var waveform = el('div', { class: 'mira-waveform', 'aria-hidden': 'true' });
    waveform.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';
    avatar.appendChild(waveform);
    row.appendChild(avatar);

    // Bubble
    var bubble = el('div', { class: 'mira-msg-bubble' });
    var body = el('div', { class: 'mira-msg-body' });
    bubble.appendChild(body);
    row.appendChild(bubble);

    messagesEl.appendChild(row);
    scrollToBottom();

    return { row: row, body: body, avatar: avatar, waveform: waveform };
  }

  function markImageAnalyzed(userMsgEl) {
    var badge = userMsgEl && userMsgEl.querySelector('.mira-img-analyzed-badge');
    if (badge) badge.dataset.show = 'true';
  }

  // ── Typewriter ────────────────────────────────────────────

  function startTypewriter(bodyEl) {
    currentMiraBubble = bodyEl;
    currentMiraText = '';
    typeQueue = [];
    if (typeInterval) { clearInterval(typeInterval); typeInterval = null; }
    pendingFinalize = null;
    pendingCitations = [];
  }

  function enqueue(token) {
    if (prefersReducedMotion) {
      currentMiraText += token;
      currentMiraBubble.textContent = currentMiraText;
      scrollToBottom();
      return;
    }
    for (var i = 0; i < token.length; i++) typeQueue.push(token[i]);
    if (!typeInterval) {
      typeInterval = setInterval(typeStep, TYPE_SPEED_MS);
    }
  }

  function typeStep() {
    if (!typeQueue.length) {
      clearInterval(typeInterval);
      typeInterval = null;
      if (pendingFinalize) { pendingFinalize(); pendingFinalize = null; }
      return;
    }
    if (!currentMiraBubble) return;
    currentMiraText += typeQueue.shift();
    currentMiraBubble.textContent = currentMiraText;
    scrollToBottom();
  }

  function appendWOButton(bodyEl, fullText) {
    var match = fullText.match(/WO RECOMMENDED:\s*([^\n.!?]+[.!?]?)/i);
    if (!match) return;
    var description = match[1].trim();

    var btn = el('button', { class: 'mira-wo-btn', type: 'button' });
    btn.textContent = '\u2295 Create Work Order';
    bodyEl.parentNode.appendChild(btn);

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Creating\u2026';
      fetch(API + '/api/mira/work-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description, session_id: sessionId }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok) {
            btn.textContent = '\u2713 Work Order Created';
            btn.classList.add('mira-wo-btn--done');
          } else {
            btn.textContent = '\u26a0 Failed \u2014 tap to retry';
            btn.disabled = false;
          }
        })
        .catch(function () {
          btn.textContent = '\u26a0 Failed \u2014 tap to retry';
          btn.disabled = false;
        });
    });
  }

  function finalizeMsg(bodyEl, fullText, citations, waveformEl_) {
    var finalize = function () {
      renderCitations(bodyEl, fullText, citations);
      if (/WO RECOMMENDED:/i.test(fullText)) appendWOButton(bodyEl, fullText);
      if (ttsEnabled) speak(fullText, waveformEl_);
    };

    // If typewriter still running, defer finalize until queue drains
    if (typeQueue.length > 0 || typeInterval) {
      pendingFinalize = finalize;
    } else {
      finalize();
    }
  }

  function renderCitations(bodyEl, text, citations) {
    if (!citations || !citations.length) return;

    // Build citation chips row
    var row = el('div', { class: 'mira-citation-row' });
    citations.forEach(function (ref) {
      var chip = el('button', {
        class: 'mira-citation',
        type: 'button',
        'aria-label': 'Citation: ' + ref,
      });
      // Work order citations get amber styling
      if (/^WO-/i.test(ref)) chip.dataset.type = 'wo';
      chip.textContent = '\u00a7' + ref;
      chip.addEventListener('click', function (e) { showCitationTooltip(chip, ref, e); });
      row.appendChild(chip);
    });

    bodyEl.parentElement.appendChild(row);
  }

  function showCitationTooltip(chipEl, ref, e) {
    // Remove any existing tooltip
    var old = document.getElementById('mira-tooltip');
    if (old) { old.remove(); return; } // toggle off

    var tip = el('div', {
      id: 'mira-tooltip',
      class: 'mira-citation-tooltip',
      role: 'tooltip',
    });
    tip.textContent = ref;

    document.body.appendChild(tip);

    var rect = chipEl.getBoundingClientRect();
    var top = rect.top + window.scrollY - tip.offsetHeight - 8;
    var left = Math.min(rect.left + window.scrollX, window.innerWidth - 300);
    if (top < 0) top = rect.bottom + window.scrollY + 8;
    tip.style.cssText = 'top:' + top + 'px;left:' + left + 'px;';

    // Dismiss on outside click
    setTimeout(function () {
      document.addEventListener('click', function dismiss(ev) {
        if (!tip.contains(ev.target) && ev.target !== chipEl) {
          tip.remove();
          document.removeEventListener('click', dismiss);
        }
      });
    }, 10);

    e.stopPropagation();
  }

  // ── Quick chips ───────────────────────────────────────────

  var DEFAULT_CHIPS = ['Fault code lookup', 'Work order status', 'PM schedule', 'Upload photo'];
  var AFTER_FAULT_CHIPS = ['Create work order', 'Find parts', 'Show history'];
  var AFTER_IMAGE_CHIPS = ['Analyze deeper', 'Find similar issues', 'Create WO from this'];

  function setDefaultChips() { renderChips(DEFAULT_CHIPS); }
  function setFaultChips()   { renderChips(AFTER_FAULT_CHIPS); }
  function setImageChips()   { renderChips(AFTER_IMAGE_CHIPS); }

  function renderChips(chips) {
    if (!quickChipsEl) return;
    quickChipsEl.innerHTML = '';
    chips.forEach(function (label) {
      var btn = el('button', { class: 'mira-chip', type: 'button' });
      btn.textContent = label;
      btn.addEventListener('click', function () {
        if (label === 'Upload photo') {
          fileInput.click();
        } else {
          inputEl.value = label;
          inputEl.focus();
        }
      });
      quickChipsEl.appendChild(btn);
    });
  }

  // ── Sending ───────────────────────────────────────────────

  function handleSend() {
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    sendTextMessage(text);
  }

  function sendTextMessage(text) {
    addUserMsg(text, null);
    history.push({ role: 'user', content: text });
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

    setThinking(true);
    stopTTSPlayback();

    var msgParts = addMiraMsg();
    startTypewriter(msgParts.body);

    streamChat(text, history.slice(0, -1), msgParts, null);
  }

  function streamChat(message, hist, msgParts, userMsgEl) {
    if (sessionExpired) { checkSession(); return; }

    var es = null;
    var body = JSON.stringify({ message: message, session_id: sessionId, history: hist });

    // Use EventSource-compatible fetch (SSE via fetch + ReadableStream)
    fetch(API + '/api/mira/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    }).then(function (response) {
      setThinking(false);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return consumeSSE(response, msgParts, userMsgEl, 'text');
    }).catch(function (err) {
      setThinking(false);
      console.error('[mira] chat error:', err);
      finalizeMsg(msgParts.body, 'Connection error — please try again.', [], msgParts.waveform);
    });
  }

  function streamVision(file, userMsgEl, msgParts) {
    setThinking(true);
    stopTTSPlayback();

    var fd = new FormData();
    fd.append('image', file);
    if (sessionId) fd.append('session_id', sessionId);
    fd.append('context', JSON.stringify(history.slice(-5)));

    fetch(API + '/api/mira/vision', {
      method: 'POST',
      body: fd,
    }).then(function (response) {
      setThinking(false);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return consumeSSE(response, msgParts, userMsgEl, 'vision');
    }).catch(function (err) {
      setThinking(false);
      console.error('[mira] vision error:', err);
      finalizeMsg(msgParts.body, 'Image analysis failed — please try again.', [], msgParts.waveform);
    });
  }

  // ── SSE consumer (fetch ReadableStream) ───────────────────

  function consumeSSE(response, msgParts, userMsgEl, type) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullText = '';
    var citations = [];

    function read() {
      return reader.read().then(function (result) {
        if (result.done) {
          finalizeMsg(msgParts.body, fullText, citations, msgParts.waveform);
          history.push({ role: 'mira', content: fullText });
          if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
          if (type === 'vision' && userMsgEl) markImageAnalyzed(userMsgEl);
          if (type === 'vision') setImageChips();
          else setFaultChips();
          return;
        }

        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        lines.forEach(function (line) {
          if (!line.startsWith('data: ')) return;
          var json = line.slice(6).trim();
          if (!json) return;
          try {
            var event = JSON.parse(json);
            if (event.type === 'token') {
              fullText += event.content;
              enqueue(event.content);
            } else if (event.type === 'citation') {
              citations.push(event.ref);
            } else if (event.type === 'error') {
              finalizeMsg(msgParts.body, event.message || 'Error', [], msgParts.waveform);
            }
          } catch (_) {}
        });

        return read();
      });
    }

    return read();
  }

  // ── Image handling ────────────────────────────────────────

  function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;

    stopTTSPlayback();

    compressImage(file).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var userMsgEl = addUserMsg(null, url);

      var msgParts = addMiraMsg();
      startTypewriter(msgParts.body);

      var compressedFile = new File([blob], file.name || 'image.jpg', { type: blob.type || 'image/jpeg' });
      streamVision(compressedFile, userMsgEl, msgParts);

      history.push({ role: 'user', content: '[Image uploaded]' });
    }).catch(function () {
      addSysMsg('Image could not be processed — please try a different file.');
    });
  }

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var objectUrl = URL.createObjectURL(file);

      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        var w = img.naturalWidth;
        var h = img.naturalHeight;

        if (w > MAX_IMAGE_PX || h > MAX_IMAGE_PX) {
          var ratio = Math.min(MAX_IMAGE_PX / w, MAX_IMAGE_PX / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          blob ? resolve(blob) : reject(new Error('toBlob failed'));
        }, 'image/jpeg', IMAGE_QUALITY);
      };

      img.onerror = function () { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')); };
      img.src = objectUrl;
    });
  }

  function handleClipboardPaste(e) {
    var items = (e.clipboardData || e.originalEvent && e.originalEvent.clipboardData || {}).items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        if (blob) handleImageFile(blob);
        return;
      }
    }
  }

  // ── Voice input ───────────────────────────────────────────

  function handleMicClick() {
    // If TTS is playing, cancel it and start recording
    if (activeSpeech) {
      stopTTSPlayback();
      setTimeout(startVoice, 100);
      return;
    }

    var state = micBtn.dataset.state;
    if (state === 'recording') {
      stopVoice(true);
    } else if (state === 'idle' || state === 'error') {
      startVoice();
    }
  }

  function startVoice() {
    if (micMuted) return;

    if (SR) {
      startWebSpeech();
    } else {
      startMediaRecorder();
    }
  }

  function stopVoice(submit) {
    if (recognition) {
      recognition.abort();
      recognition = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (vadAnimFrame) { cancelAnimationFrame(vadAnimFrame); vadAnimFrame = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(function (t) { t.stop(); }); mediaStream = null; }
    setMicState('idle');
  }

  // Chrome/Edge/Android: Web Speech API
  function startWebSpeech() {
    try {
      recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      var originalValue = inputEl.value;

      recognition.onstart = function () {
        setMicState('recording');
        micBtn.setAttribute('aria-label', 'Stop recording');
      };

      recognition.onresult = function (e) {
        var interim = '';
        var finalStr = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalStr += t;
          else interim += t;
        }
        // Show interim in gray in input placeholder style
        inputEl.value = finalStr || interim;
        inputEl.style.color = finalStr ? '' : 'var(--mira-faint)';
      };

      recognition.onend = function () {
        inputEl.style.color = '';
        var text = inputEl.value.trim();
        recognition = null;
        setMicState('idle');
        micBtn.setAttribute('aria-label', 'Start recording');
        if (text) {
          // Small delay so user sees final transcript before submit
          setTimeout(function () { handleSend(); }, 150);
        }
      };

      recognition.onerror = function (e) {
        console.warn('[mira] speech recognition error:', e.error);
        recognition = null;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setMicState('error');
          micBtn.setAttribute('aria-label', 'Mic access denied');
          micBtn.title = 'Microphone access denied — check browser settings';
        } else {
          setMicState('idle');
          micBtn.setAttribute('aria-label', 'Start recording');
        }
        inputEl.style.color = '';
      };

      recognition.start();
    } catch (err) {
      console.error('[mira] Web Speech API error:', err);
      setMicState('error');
    }
  }

  // iOS Safari / Firefox: getUserMedia → MediaRecorder → Whisper API
  function startMediaRecorder() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicState('error');
      micBtn.title = 'Microphone not supported on this browser';
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        mediaStream = stream;

        // Set up VAD via Web Audio API
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        var audioCtx = new AudioCtx();
        var analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        var source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        var dataArray = new Uint8Array(analyser.frequencyBinCount);
        var silenceStart = null;

        // MediaRecorder
        var mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
        mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
        audioChunks = [];

        mediaRecorder.ondataavailable = function (e) {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = function () {
          if (vadAnimFrame) { cancelAnimationFrame(vadAnimFrame); vadAnimFrame = null; }
          if (mediaStream) { mediaStream.getTracks().forEach(function (t) { t.stop(); }); mediaStream = null; }
          audioCtx.close();
          setMicState('processing');
          micBtn.setAttribute('aria-label', 'Processing...');

          var blob = new Blob(audioChunks, { type: mimeType });
          transcribeAudio(blob, mimeType);
        };

        mediaRecorder.start(100); // collect 100ms chunks
        setMicState('recording');
        micBtn.setAttribute('aria-label', 'Stop recording');

        // VAD loop
        function checkVAD() {
          analyser.getByteTimeDomainData(dataArray);
          var sum = 0;
          for (var i = 0; i < dataArray.length; i++) sum += Math.abs(dataArray[i] - 128);
          var rms = sum / dataArray.length / 128;

          if (rms < SILENCE_THRESHOLD) {
            if (!silenceStart) silenceStart = Date.now();
            else if (Date.now() - silenceStart > SILENCE_DURATION_MS) {
              if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
              return; // exit loop
            }
          } else {
            silenceStart = null;
          }
          vadAnimFrame = requestAnimationFrame(checkVAD);
        }
        checkVAD();
      })
      .catch(function (err) {
        console.warn('[mira] getUserMedia error:', err);
        setMicState('error');
        micBtn.title = 'Microphone access denied — check browser settings';
      });
  }

  function transcribeAudio(blob, mimeType) {
    var fd = new FormData();
    var ext = mimeType === 'audio/webm' ? '.webm' : '.mp4';
    fd.append('audio', blob, 'recording' + ext);

    fetch(API + '/api/transcribe', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setMicState('idle');
        micBtn.setAttribute('aria-label', 'Start recording');
        if (data.transcript && data.transcript.trim()) {
          inputEl.value = data.transcript.trim();
          setTimeout(handleSend, 150);
        }
      })
      .catch(function (err) {
        console.error('[mira] transcription error:', err);
        setMicState('idle');
        micBtn.setAttribute('aria-label', 'Start recording');
        addSysMsg('Transcription failed — please try typing instead.');
      });
  }

  function setMicState(state) {
    if (!micBtn) return;
    micBtn.dataset.state = state;
  }

  // ── TTS (Web Speech Synthesis) ────────────────────────────

  function toggleTTS() {
    ttsEnabled = !ttsEnabled;
    ttsToggleBtn.dataset.active = String(ttsEnabled);
    ttsToggleBtn.setAttribute('aria-pressed', String(ttsEnabled));
    ttsToggleBtn.setAttribute('aria-label', ttsEnabled ? 'Disable voice readback' : 'Enable voice readback');
    ttsToggleBtn.innerHTML = ttsEnabled ? ICONS.speaker : ICONS.speakeroff;
    if (!ttsEnabled) stopTTSPlayback();
  }

  function speak(text, waveformElArg) {
    if (!ttsEnabled) return;
    if (!('speechSynthesis' in window)) return;

    var clean = text
      .replace(/\[§[^\]]+\]/g, '')   // strip citation markers
      .replace(/WO RECOMMENDED:/g, 'Work order recommended:')
      .trim();
    if (!clean) return;

    stopTTSPlayback();
    micMuted = true;
    if (recognition) recognition.abort();

    var utt = new SpeechSynthesisUtterance(clean);
    utt.rate = 1.05;
    utt.pitch = 0.95;
    utt.volume = 0.9;
    utt.lang = 'en-US';

    // Voice priority: Samantha → Google US English → Microsoft David → first en-US
    function setVoice() {
      var voices = window.speechSynthesis.getVoices();
      var preferred = ['Samantha', 'Google US English', 'Microsoft David Desktop'];
      for (var i = 0; i < preferred.length; i++) {
        var v = voices.find(function (x) { return x.name === preferred[i]; });
        if (v) { utt.voice = v; return; }
      }
      // Fallback: first en-US voice
      var enUs = voices.find(function (x) { return x.lang === 'en-US'; });
      if (enUs) utt.voice = enUs;
    }

    // Voices may not be loaded yet
    if (window.speechSynthesis.getVoices().length) {
      setVoice();
    } else {
      window.speechSynthesis.onvoiceschanged = function () { setVoice(); };
    }

    waveformEl = waveformElArg || null;

    utt.onstart = function () {
      activeSpeech = utt;
      if (waveformEl) waveformEl.dataset.active = 'true';
    };

    utt.onend = function () {
      activeSpeech = null;
      if (waveformEl) { waveformEl.dataset.active = 'false'; waveformEl = null; }
      setTimeout(function () { micMuted = false; }, 400);
    };

    utt.onerror = function () {
      activeSpeech = null;
      if (waveformEl) { waveformEl.dataset.active = 'false'; waveformEl = null; }
      micMuted = false;
    };

    window.speechSynthesis.speak(utt);
    activeSpeech = utt;
  }

  function stopTTSPlayback() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    activeSpeech = null;
    if (waveformEl) { waveformEl.dataset.active = 'false'; waveformEl = null; }
    setTimeout(function () { micMuted = false; }, 100);
  }

  // ── Thinking indicator ────────────────────────────────────

  function setThinking(on) {
    thinkingEl.hidden = !on;
    sendBtn.disabled = on;
  }

  // ── Scroll to bottom ──────────────────────────────────────

  function scrollToBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Utilities ─────────────────────────────────────────────

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'hidden' && attrs[k] === true) node.setAttribute('hidden', '');
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  function isMobile() {
    return window.innerWidth <= 767;
  }

  // ── Init ─────────────────────────────────────────────────

  // Inject CSS if not already loaded (handles late lazy-load case)
  if (!document.getElementById('mira-chat-css')) {
    var link = document.createElement('link');
    link.id = 'mira-chat-css';
    link.rel = 'stylesheet';
    link.href = (API || '') + '/mira-chat.css';
    document.head.appendChild(link);
  }

  buildWidget();
  initSession();

  // Recheck session if page regains focus (tab switch)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && sessionId) checkSession();
  });

  // Mobile: add capture attribute to file input for direct camera
  if (isMobile() && fileInput) {
    fileInput.setAttribute('capture', 'environment');
  }

})();
