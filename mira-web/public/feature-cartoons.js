/**
 * feature-cartoons.js
 * Animated SVG cartoon illustrations for each feature block.
 * Each cartoon cycles through 4 scenes demonstrating the feature.
 * Click or tap any cartoon to advance; dots for direct navigation.
 */
(function () {
  'use strict';

  // ── Scene player ──────────────────────────────────────────────────────
  function CartoonPlayer(id, captions, ms) {
    var el = document.getElementById(id);
    if (!el) return;
    var scenes = el.querySelectorAll('.c-scene');
    var dots   = el.querySelectorAll('.c-dot');
    var cap    = el.querySelector('.c-caption');
    var cur    = 0, timer;

    function show(i) {
      scenes[cur].style.opacity = '0';
      dots[cur].classList.remove('active');
      cur = ((i % scenes.length) + scenes.length) % scenes.length;
      scenes[cur].style.opacity = '1';
      dots[cur].classList.add('active');
      if (cap) cap.textContent = captions[cur] || '';
    }

    function tick() { show(cur + 1); }
    function start() { clearInterval(timer); timer = setInterval(tick, ms || 3400); }

    // init
    scenes[0].style.opacity = '1';
    dots[0].classList.add('active');
    if (cap) cap.textContent = captions[0] || '';

    el.addEventListener('click', function (e) {
      var d = e.target.closest('.c-dot');
      if (d) show(parseInt(d.dataset.scene, 10));
      else tick();
      start();
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); tick(); start(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); show(cur - 1); start(); }
    });
    start();
  }

  // ── Inject SVG + footer into placeholder div ──────────────────────────
  function mount(id, svg, captions, ms) {
    var el = document.getElementById(id);
    if (!el) return;
    var dots = captions.map(function (_, i) {
      return '<button class="c-dot" data-scene="' + i + '" aria-label="Scene ' + (i + 1) + '"></button>';
    }).join('');
    el.innerHTML = svg +
      '<div class="cartoon-footer">' +
        '<span class="c-caption"></span>' +
        '<div class="c-dots">' + dots + '</div>' +
      '</div>';
    new CartoonPlayer(id, captions, ms);
  }

  // ══════════════════════════════════════════════════════════════════════
  // CARTOON 1 — FAULT DIAGNOSIS
  // Story: tech types a fault code → MIRA searches manuals → cited answer → WO created
  // ══════════════════════════════════════════════════════════════════════
  var FD = '<svg viewBox="0 0 480 256" xmlns="http://www.w3.org/2000/svg" width="100%" height="216px" style="display:block;flex-shrink:0">' +
  '<defs>' +
    '<clipPath id="fd-clip"><rect x="160" y="44" width="160" height="192" rx="4"/></clipPath>' +
    '<filter id="fd-teal-glow" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur stdDeviation="4" result="b"/>' +
      '<feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 .83 .67 0 0  0 0 0 0 0  0 0 0 .7 0" result="c"/>' +
      '<feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    '</filter>' +
  '</defs>' +

  // Background + grid
  '<rect width="480" height="256" fill="#09090c"/>' +
  '<g stroke="rgba(255,255,255,.022)" stroke-width="1" fill="none">' +
    '<line x1="0" y1="64" x2="480" y2="64"/><line x1="0" y1="128" x2="480" y2="128"/><line x1="0" y1="192" x2="480" y2="192"/>' +
    '<line x1="120" y1="0" x2="120" y2="256"/><line x1="240" y1="0" x2="240" y2="256"/><line x1="360" y1="0" x2="360" y2="256"/>' +
  '</g>' +

  // Left decoration — signal waves
  '<g stroke="#f0a000" stroke-width="1.2" fill="none" opacity=".14">' +
    '<path d="M18 90 Q38 70 58 90 Q78 110 98 90"/>' +
    '<path d="M18 110 Q38 90 58 110 Q78 130 98 110"/>' +
    '<path d="M18 130 Q38 150 58 130 Q78 110 98 130"/>' +
    '<path d="M18 150 Q38 170 58 150 Q78 130 98 150"/>' +
  '</g>' +
  // Right decoration — circuit trace
  '<g stroke="#00d4aa" stroke-width="1" fill="none" opacity=".12">' +
    '<polyline points="380,70 400,70 400,100 430,100 430,80 460,80"/>' +
    '<polyline points="380,140 410,140 410,160 450,160"/>' +
    '<circle cx="400" cy="70" r="3" fill="#00d4aa" opacity=".5"/>' +
    '<circle cx="430" cy="100" r="3" fill="#00d4aa" opacity=".5"/>' +
    '<circle cx="410" cy="140" r="3" fill="#00d4aa" opacity=".5"/>' +
  '</g>' +

  // Phone shadow
  '<rect x="150" y="12" width="180" height="248" rx="26" fill="rgba(0,0,0,.45)" transform="translate(3,5)"/>' +
  // Phone body
  '<rect x="150" y="7" width="180" height="248" rx="26" fill="#1a1b1f"/>' +
  '<rect x="150" y="7" width="180" height="248" rx="26" fill="none" stroke="#2c2e38" stroke-width="1.5"/>' +
  '<rect x="150" y="7" width="180" height="248" rx="26" fill="none" stroke="rgba(255,255,255,.055)" stroke-width="1"/>' +
  // Notch
  '<rect x="199" y="13" width="82" height="16" rx="5" fill="#0a0b0e"/>' +
  // Home bar
  '<rect x="213" y="246" width="54" height="5" rx="2.5" fill="rgba(255,255,255,.1)"/>' +
  // Screen bg
  '<rect x="160" y="44" width="160" height="192" rx="4" fill="#10111a"/>' +

  // ── Clipped screen content ──
  '<g clip-path="url(#fd-clip)">' +

    // Header
    '<rect x="160" y="44" width="160" height="33" fill="#14151e"/>' +
    '<line x1="160" y1="77" x2="320" y2="77" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
    '<circle cx="176" cy="61" r="9" fill="rgba(0,212,170,.14)" stroke="#00d4aa" stroke-width="1.5"/>' +
    '<text x="176" y="65" text-anchor="middle" font-size="8" font-weight="700" fill="#00d4aa" font-family="ui-monospace,monospace">M</text>' +
    '<text x="193" y="57" font-size="8" font-weight="600" fill="#e8eaf0" font-family="ui-monospace,monospace">MIRA</text>' +
    '<text x="193" y="69" font-size="7" fill="rgba(255,255,255,.3)" font-family="ui-monospace,monospace">Industrial AI</text>' +
    '<circle cx="313" cy="61" r="3.5" fill="#00d4aa"><animate attributeName="opacity" values="1;.3;1" dur="2.4s" repeatCount="indefinite"/></circle>' +

    // ── Scene 0: User types fault code ──
    '<g class="c-scene" id="fd-s0">' +
      '<text x="240" y="132" text-anchor="middle" font-size="8.5" fill="rgba(255,255,255,.09)" font-family="ui-monospace,monospace">Ask any fault code…</text>' +
      '<rect x="208" y="174" width="106" height="45" rx="10" fill="rgba(240,160,0,.11)" stroke="rgba(240,160,0,.28)" stroke-width="1"/>' +
      '<text x="261" y="193" text-anchor="middle" font-size="8.5" fill="#e8eaf0" font-family="ui-monospace,monospace">F-012 fault on</text>' +
      '<text x="261" y="208" text-anchor="middle" font-size="8.5" fill="#e8eaf0" font-family="ui-monospace,monospace">PowerFlex 525</text>' +
      '<rect x="307" y="193" width="2" height="10" rx="1" fill="#f0a000"><animate attributeName="opacity" values="1;0;1" dur=".85s" repeatCount="indefinite"/></rect>' +
    '</g>' +

    // ── Scene 1: Thinking / searching ──
    '<g class="c-scene" id="fd-s1" style="opacity:0">' +
      '<rect x="208" y="155" width="106" height="45" rx="10" fill="rgba(240,160,0,.06)" stroke="rgba(240,160,0,.12)" stroke-width="1"/>' +
      '<text x="261" y="174" text-anchor="middle" font-size="8.5" fill="rgba(232,234,240,.3)" font-family="ui-monospace,monospace">F-012 fault on</text>' +
      '<text x="261" y="189" text-anchor="middle" font-size="8.5" fill="rgba(232,234,240,.3)" font-family="ui-monospace,monospace">PowerFlex 525</text>' +
      '<rect x="162" y="162" width="58" height="25" rx="8" fill="#1b2138" stroke="rgba(0,212,170,.2)" stroke-width="1"/>' +
      '<circle cx="175" cy="174" r="3.5" fill="#00d4aa"><animate attributeName="cy" values="174;170;174" dur=".65s" begin="0s" repeatCount="indefinite"/></circle>' +
      '<circle cx="186" cy="174" r="3.5" fill="#00d4aa"><animate attributeName="cy" values="174;170;174" dur=".65s" begin=".13s" repeatCount="indefinite"/></circle>' +
      '<circle cx="197" cy="174" r="3.5" fill="#00d4aa"><animate attributeName="cy" values="174;170;174" dur=".65s" begin=".26s" repeatCount="indefinite"/></circle>' +
      '<text x="240" y="208" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,.2)" font-family="ui-monospace,monospace">Searching manuals…</text>' +
    '</g>' +

    // ── Scene 2: Cited answer ──
    '<g class="c-scene" id="fd-s2" style="opacity:0">' +
      '<rect x="208" y="79" width="106" height="36" rx="8" fill="rgba(240,160,0,.07)" stroke="rgba(240,160,0,.15)" stroke-width="1"/>' +
      '<text x="261" y="94" text-anchor="middle" font-size="7.5" fill="rgba(232,234,240,.4)" font-family="ui-monospace,monospace">F-012 fault on</text>' +
      '<text x="261" y="107" text-anchor="middle" font-size="7.5" fill="rgba(232,234,240,.4)" font-family="ui-monospace,monospace">PowerFlex 525</text>' +
      '<rect x="162" y="123" width="128" height="78" rx="10" fill="#151c30" stroke="rgba(0,212,170,.22)" stroke-width="1"/>' +
      '<text x="172" y="140" font-size="8.5" fill="#e8eaf0" font-family="ui-monospace,monospace">Input phase loss.</text>' +
      '<text x="172" y="154" font-size="8.5" fill="#e8eaf0" font-family="ui-monospace,monospace">Check L1 wiring</text>' +
      '<text x="172" y="168" font-size="8.5" fill="#e8eaf0" font-family="ui-monospace,monospace">at TB1 terminal.</text>' +
      '<rect x="164" y="176" width="123" height="18" rx="3" fill="rgba(0,212,170,.08)" stroke="rgba(0,212,170,.22)" stroke-width="1"/>' +
      '<text x="225" y="188" text-anchor="middle" font-size="7.5" fill="#00d4aa" font-family="ui-monospace,monospace">§ PF525 Manual p.47</text>' +
    '</g>' +

    // ── Scene 3: Work order auto-created ──
    '<g class="c-scene" id="fd-s3" style="opacity:0">' +
      '<rect x="208" y="79" width="106" height="36" rx="8" fill="rgba(240,160,0,.07)" stroke="rgba(240,160,0,.12)" stroke-width="1"/>' +
      '<text x="261" y="94" text-anchor="middle" font-size="7" fill="rgba(232,234,240,.35)" font-family="ui-monospace,monospace">F-012 fault on</text>' +
      '<text x="261" y="107" text-anchor="middle" font-size="7" fill="rgba(232,234,240,.35)" font-family="ui-monospace,monospace">PowerFlex 525</text>' +
      '<rect x="162" y="122" width="118" height="54" rx="8" fill="#151c30" stroke="rgba(0,212,170,.14)" stroke-width="1"/>' +
      '<text x="172" y="137" font-size="8" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">Input phase loss.</text>' +
      '<text x="172" y="150" font-size="8" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">Check L1 at TB1.</text>' +
      '<rect x="164" y="157" width="112" height="14" rx="2" fill="rgba(0,212,170,.06)" stroke="rgba(0,212,170,.15)" stroke-width="1"/>' +
      '<text x="220" y="167" text-anchor="middle" font-size="7" fill="rgba(0,212,170,.7)" font-family="ui-monospace,monospace">§ PF525 p.47</text>' +
      '<rect x="158" y="184" width="162" height="44" rx="8" fill="#091a12" stroke="#00d4aa" stroke-width="1.5" filter="url(#fd-teal-glow)"/>' +
      '<text x="170" y="201" font-size="8.5" font-weight="700" fill="#00d4aa" font-family="ui-monospace,monospace">✓ WO-4821 CREATED</text>' +
      '<text x="170" y="215" font-size="7.5" fill="rgba(255,255,255,.5)" font-family="ui-monospace,monospace">Asset: Line 3 VFD · HIGH</text>' +
      '<text x="170" y="225" font-size="7" fill="rgba(255,255,255,.3)" font-family="ui-monospace,monospace">F-012: Input phase loss</text>' +
    '</g>' +

  '</g>' + // /clip
  '</svg>';

  // ══════════════════════════════════════════════════════════════════════
  // CARTOON 2 — CMMS INTEGRATION
  // Story: MIRA diagnoses → pipeline flows → WO fills CMMS → synced
  // ══════════════════════════════════════════════════════════════════════
  var CMMS = '<svg viewBox="0 0 480 256" xmlns="http://www.w3.org/2000/svg" width="100%" height="216px" style="display:block;flex-shrink:0">' +
  '<defs>' +
    '<filter id="cm-amber-glow" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur stdDeviation="5" result="b"/>' +
      '<feColorMatrix in="b" type="matrix" values="0 0 0 0 .94  0 0 0 0 .63  0 0 0 0 0  0 0 0 .55 0" result="c"/>' +
      '<feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    '</filter>' +
    '<filter id="cm-teal-glow" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur stdDeviation="5" result="b"/>' +
      '<feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 0 0 0 .83  0 0 0 0 .67  0 0 0 .55 0" result="c"/>' +
      '<feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    '</filter>' +
    // path for animated data packets
    '<path id="cm-pipe" d="M198,128 L282,128"/>' +
  '</defs>' +

  // BG
  '<rect width="480" height="256" fill="#09090c"/>' +
  '<g stroke="rgba(255,255,255,.022)" stroke-width="1" fill="none">' +
    '<line x1="0" y1="64" x2="480" y2="64"/><line x1="0" y1="128" x2="480" y2="128"/><line x1="0" y1="192" x2="480" y2="192"/>' +
    '<line x1="120" y1="0" x2="120" y2="256"/><line x1="240" y1="0" x2="240" y2="256"/><line x1="360" y1="0" x2="360" y2="256"/>' +
  '</g>' +

  // ── MIRA Panel (left) ──
  '<rect x="16" y="30" width="170" height="190" rx="12" fill="#13141a" stroke="rgba(240,160,0,.22)" stroke-width="1.5"/>' +
  // Panel header
  '<rect x="16" y="30" width="170" height="38" rx="12" fill="#1a1b1f"/>' +
  '<rect x="16" y="50" width="170" height="18" fill="#1a1b1f"/>' +
  '<line x1="16" y1="68" x2="186" y2="68" stroke="rgba(255,255,255,.06)" stroke-width="1"/>' +
  // MIRA logo mini
  '<rect x="28" y="40" width="20" height="20" rx="5" fill="#f0a000"/>' +
  '<path d="M32 56V46l3.5 5 2.5-3.5 2.5 3.5 3.5-5v10" stroke="#0a0a08" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
  '<text x="54" y="48" font-size="9" font-weight="700" fill="#e8eaf0" font-family="ui-monospace,monospace">MIRA</text>' +
  '<text x="54" y="61" font-size="7.5" fill="rgba(255,255,255,.3)" font-family="ui-monospace,monospace">Diagnostic AI</text>' +

  // Chat bubble (always visible)
  '<rect x="26" y="80" width="150" height="36" rx="7" fill="rgba(240,160,0,.1)" stroke="rgba(240,160,0,.22)" stroke-width="1"/>' +
  '<text x="34" y="95" font-size="7.5" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">F-012 fault on</text>' +
  '<text x="34" y="108" font-size="7.5" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">PowerFlex 525 ›</text>' +

  // MIRA response bubble
  '<rect x="26" y="124" width="150" height="60" rx="7" fill="#151c30" stroke="rgba(0,212,170,.18)" stroke-width="1"/>' +
  '<text x="36" y="140" font-size="7.5" fill="#e8eaf0" font-family="ui-monospace,monospace">Input phase loss.</text>' +
  '<text x="36" y="153" font-size="7.5" fill="#e8eaf0" font-family="ui-monospace,monospace">Check L1 at TB1.</text>' +
  '<rect x="28" y="160" width="144" height="16" rx="3" fill="rgba(0,212,170,.07)" stroke="rgba(0,212,170,.2)" stroke-width="1"/>' +
  '<text x="100" y="171" text-anchor="middle" font-size="7" fill="#00d4aa" font-family="ui-monospace,monospace">§ PF525 Manual p.47</text>' +

  // Fault diagnosed badge (bottom of MIRA panel)
  '<rect x="26" y="194" width="150" height="18" rx="4" fill="rgba(240,160,0,.08)" stroke="rgba(240,160,0,.25)" stroke-width="1"/>' +
  '<text x="101" y="206" text-anchor="middle" font-size="7.5" font-weight="600" fill="#f0a000" font-family="ui-monospace,monospace">FAULT DIAGNOSED ✓</text>' +

  // ── Pipeline (center) ──
  '<line x1="186" y1="128" x2="294" y2="128" stroke="rgba(255,255,255,.08)" stroke-width="1" stroke-dasharray="4,4"/>' +
  '<path d="M282,122 L294,128 L282,134" fill="rgba(0,212,170,.5)"/>' +
  '<text x="240" y="118" text-anchor="middle" font-size="7" fill="rgba(255,255,255,.2)" font-family="ui-monospace,monospace" letter-spacing="1">WORK ORDER DATA</text>' +

  // ── CMMS Panel (right) ──
  '<rect x="294" y="30" width="170" height="190" rx="12" fill="#13141a" stroke="rgba(0,212,170,.22)" stroke-width="1.5"/>' +
  '<rect x="294" y="30" width="170" height="38" rx="12" fill="#1a1b1f"/>' +
  '<rect x="294" y="50" width="170" height="18" fill="#1a1b1f"/>' +
  '<line x1="294" y1="68" x2="464" y2="68" stroke="rgba(255,255,255,.06)" stroke-width="1"/>' +
  // CMMS header icon (clipboard)
  '<rect x="306" y="38" width="20" height="22" rx="3" fill="#13141a" stroke="#00d4aa" stroke-width="1.5"/>' +
  '<line x1="311" y1="46" x2="321" y2="46" stroke="#00d4aa" stroke-width="1"/>' +
  '<line x1="311" y1="51" x2="321" y2="51" stroke="rgba(0,212,170,.4)" stroke-width="1"/>' +
  '<line x1="311" y1="56" x2="317" y2="56" stroke="rgba(0,212,170,.4)" stroke-width="1"/>' +
  '<text x="332" y="48" font-size="9" font-weight="700" fill="#e8eaf0" font-family="ui-monospace,monospace">CMMS</text>' +
  '<text x="332" y="61" font-size="7.5" fill="rgba(255,255,255,.3)" font-family="ui-monospace,monospace">Work Orders</text>' +

  // ── Scenes (overlay different CMMS panel states) ──

  // Scene 0: CMMS dim / not yet populated
  '<g class="c-scene" id="cm-s0">' +
    // Dim overlay on CMMS panel
    '<rect x="294" y="30" width="170" height="190" rx="12" fill="rgba(9,9,12,.65)"/>' +
    '<text x="379" y="136" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.2)" font-family="ui-monospace,monospace">Waiting…</text>' +
    // No pipeline dots
  '</g>' +

  // Scene 1: Pipeline animating
  '<g class="c-scene" id="cm-s1" style="opacity:0">' +
    '<rect x="294" y="30" width="170" height="190" rx="12" fill="rgba(9,9,12,.45)"/>' +
    '<text x="379" y="136" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.25)" font-family="ui-monospace,monospace">Sending…</text>' +
    // Animated data packets
    '<circle r="4" fill="#f0a000" opacity=".9"><animateMotion dur="1.1s" begin="0s" repeatCount="indefinite"><mpath href="#cm-pipe"/></animateMotion></circle>' +
    '<circle r="4" fill="#f0a000" opacity=".7"><animateMotion dur="1.1s" begin="0.37s" repeatCount="indefinite"><mpath href="#cm-pipe"/></animateMotion></circle>' +
    '<circle r="4" fill="#f0a000" opacity=".5"><animateMotion dur="1.1s" begin="0.74s" repeatCount="indefinite"><mpath href="#cm-pipe"/></animateMotion></circle>' +
  '</g>' +

  // Scene 2: CMMS populated with WO data
  '<g class="c-scene" id="cm-s2" style="opacity:0">' +
    // WO fields
    '<text x="306" y="88" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">Work Order</text>' +
    '<text x="306" y="102" font-size="10" font-weight="700" fill="#e8eaf0" font-family="ui-monospace,monospace">WO-4821</text>' +
    '<line x1="306" y1="110" x2="454" y2="110" stroke="rgba(255,255,255,.06)" stroke-width="1"/>' +
    '<text x="306" y="125" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">Asset</text>' +
    '<text x="390" y="125" font-size="7.5" fill="#e8eaf0" font-family="ui-monospace,monospace">Line 3 VFD</text>' +
    '<text x="306" y="141" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">Priority</text>' +
    '<rect x="388" y="132" width="36" height="14" rx="3" fill="rgba(240,100,0,.18)" stroke="rgba(240,100,0,.4)" stroke-width="1"/>' +
    '<text x="406" y="143" text-anchor="middle" font-size="7.5" font-weight="600" fill="#ff6400" font-family="ui-monospace,monospace">HIGH</text>' +
    '<text x="306" y="157" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">Description</text>' +
    '<text x="306" y="170" font-size="7" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">Input phase loss.</text>' +
    '<text x="306" y="181" font-size="7" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">Check L1 at TB1.</text>' +
    '<text x="306" y="192" font-size="7" fill="rgba(0,212,170,.6)" font-family="ui-monospace,monospace">§ PF525 p.47</text>' +
    '<rect x="306" y="200" width="148" height="14" rx="3" fill="rgba(255,165,0,.07)" stroke="rgba(255,165,0,.2)" stroke-width="1"/>' +
    '<text x="380" y="210" text-anchor="middle" font-size="7" fill="rgba(255,165,0,.7)" font-family="ui-monospace,monospace">STATUS: OPEN</text>' +
    // Animated data packets still flowing
    '<circle r="3.5" fill="#f0a000" opacity=".7"><animateMotion dur="1.3s" begin="0s" repeatCount="indefinite"><mpath href="#cm-pipe"/></animateMotion></circle>' +
    '<circle r="3.5" fill="#f0a000" opacity=".4"><animateMotion dur="1.3s" begin="0.43s" repeatCount="indefinite"><mpath href="#cm-pipe"/></animateMotion></circle>' +
  '</g>' +

  // Scene 3: Synced — both panels lit, checkmarks
  '<g class="c-scene" id="cm-s3" style="opacity:0">' +
    '<text x="306" y="88" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">Work Order</text>' +
    '<text x="306" y="102" font-size="10" font-weight="700" fill="#e8eaf0" font-family="ui-monospace,monospace">WO-4821</text>' +
    '<line x1="306" y1="110" x2="454" y2="110" stroke="rgba(255,255,255,.06)" stroke-width="1"/>' +
    '<text x="306" y="125" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">Asset</text>' +
    '<text x="390" y="125" font-size="7.5" fill="#e8eaf0" font-family="ui-monospace,monospace">Line 3 VFD</text>' +
    '<text x="306" y="141" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">Priority</text>' +
    '<rect x="388" y="132" width="36" height="14" rx="3" fill="rgba(240,100,0,.18)" stroke="rgba(240,100,0,.4)" stroke-width="1"/>' +
    '<text x="406" y="143" text-anchor="middle" font-size="7.5" font-weight="600" fill="#ff6400" font-family="ui-monospace,monospace">HIGH</text>' +
    '<text x="306" y="157" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">Description</text>' +
    '<text x="306" y="170" font-size="7" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">Input phase loss.</text>' +
    '<text x="306" y="181" font-size="7" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">Check L1 at TB1.</text>' +
    '<text x="306" y="192" font-size="7" fill="rgba(0,212,170,.6)" font-family="ui-monospace,monospace">§ PF525 p.47</text>' +
    // SYNCED badge
    '<rect x="294" y="196" width="170" height="24" rx="0" fill="rgba(0,212,170,.12)" stroke="rgba(0,212,170,.3)" stroke-width="1"/>' +
    '<text x="379" y="212" text-anchor="middle" font-size="8" font-weight="700" fill="#00d4aa" font-family="ui-monospace,monospace">✓ SYNCED — MaintainX</text>' +
    // Sync indicator on pipeline
    '<circle cx="240" cy="128" r="6" fill="rgba(0,212,170,.15)" stroke="#00d4aa" stroke-width="1"><animate attributeName="r" values="6;10;6" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/></circle>' +
    '<circle cx="240" cy="128" r="3" fill="#00d4aa"/>' +
  '</g>' +

  '</svg>';

  // ══════════════════════════════════════════════════════════════════════
  // CARTOON 3 — VOICE + VISION
  // Story: point phone at equipment → scan → nameplate read → diagnosis
  // ══════════════════════════════════════════════════════════════════════
  var VV = '<svg viewBox="0 0 480 256" xmlns="http://www.w3.org/2000/svg" width="100%" height="216px" style="display:block;flex-shrink:0">' +
  '<defs>' +
    '<clipPath id="vv-phone-clip"><rect x="296" y="44" width="134" height="168" rx="4"/></clipPath>' +
    '<filter id="vv-scan-glow" x="-10%" y="-10%" width="120%" height="120%">' +
      '<feGaussianBlur stdDeviation="3" result="b"/>' +
      '<feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 .83 .67 0 0  0 0 0 0 0  0 0 0 .8 0" result="c"/>' +
      '<feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    '</filter>' +
  '</defs>' +

  // BG
  '<rect width="480" height="256" fill="#09090c"/>' +
  '<g stroke="rgba(255,255,255,.022)" stroke-width="1" fill="none">' +
    '<line x1="0" y1="64" x2="480" y2="64"/><line x1="0" y1="128" x2="480" y2="128"/><line x1="0" y1="192" x2="480" y2="192"/>' +
    '<line x1="120" y1="0" x2="120" y2="256"/><line x1="240" y1="0" x2="240" y2="256"/><line x1="360" y1="0" x2="360" y2="256"/>' +
  '</g>' +

  // ── VFD Equipment Panel ──
  // Case outer
  '<rect x="14" y="20" width="200" height="220" rx="10" fill="#1a1b1f" stroke="#2a2c38" stroke-width="2"/>' +
  '<rect x="14" y="20" width="200" height="220" rx="10" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="1"/>' +
  // Case shadow/depth
  '<rect x="14" y="20" width="200" height="8" rx="10" fill="rgba(255,255,255,.04)"/>' +
  // Vent holes top
  '<g fill="rgba(0,0,0,.5)">' +
    '<rect x="25" y="28" width="4" height="16" rx="1"/><rect x="32" y="28" width="4" height="16" rx="1"/>' +
    '<rect x="39" y="28" width="4" height="16" rx="1"/><rect x="46" y="28" width="4" height="16" rx="1"/>' +
    '<rect x="53" y="28" width="4" height="16" rx="1"/><rect x="60" y="28" width="4" height="16" rx="1"/>' +
    '<rect x="67" y="28" width="4" height="16" rx="1"/><rect x="74" y="28" width="4" height="16" rx="1"/>' +
    '<rect x="81" y="28" width="4" height="16" rx="1"/><rect x="88" y="28" width="4" height="16" rx="1"/>' +
  '</g>' +
  // LCD fault display
  '<rect x="30" y="52" width="168" height="46" rx="5" fill="#0a1408" stroke="#2a4020" stroke-width="1.5"/>' +
  '<text x="44" y="71" font-size="9" fill="rgba(0,200,50,.4)" font-family="ui-monospace,monospace">PowerFlex 525</text>' +
  '<text x="44" y="88" font-size="22" font-weight="700" fill="#f0a000" font-family="ui-monospace,monospace">F-012</text>' +
  // Fault light (amber, blinking)
  '<circle cx="178" cy="66" r="8" fill="rgba(240,160,0,.1)" stroke="rgba(240,160,0,.4)" stroke-width="1.5"><animate attributeName="opacity" values="1;.3;1" dur="1.2s" repeatCount="indefinite"/></circle>' +
  '<circle cx="178" cy="66" r="4" fill="#f0a000"><animate attributeName="opacity" values="1;.2;1" dur="1.2s" repeatCount="indefinite"/></circle>' +
  '<text x="178" y="82" text-anchor="middle" font-size="6.5" fill="rgba(240,160,0,.5)" font-family="ui-monospace,monospace">FAULT</text>' +

  // Nameplate area
  '<rect x="30" y="106" width="168" height="60" rx="4" fill="#111318" stroke="#2a2c38" stroke-width="1"/>' +
  '<text x="38" y="120" font-size="7.5" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">NAMEPLATE</text>' +
  '<text x="38" y="134" font-size="8" font-weight="600" fill="rgba(255,255,255,.7)" font-family="ui-monospace,monospace">Allen-Bradley</text>' +
  '<text x="38" y="147" font-size="7.5" fill="rgba(255,255,255,.55)" font-family="ui-monospace,monospace">PowerFlex 525</text>' +
  '<text x="38" y="159" font-size="7" fill="rgba(255,255,255,.35)" font-family="ui-monospace,monospace">25B-E1P7N104 · 460V</text>' +

  // Terminal block area
  '<rect x="30" y="174" width="168" height="52" rx="3" fill="#0d0e11" stroke="#1e2028" stroke-width="1"/>' +
  '<text x="38" y="188" font-size="7" fill="rgba(255,255,255,.25)" font-family="ui-monospace,monospace">TERMINALS</text>' +
  '<g fill="rgba(255,255,255,.15)">' +
    '<rect x="40" y="193" width="8" height="8" rx="1"/><rect x="52" y="193" width="8" height="8" rx="1"/>' +
    '<rect x="64" y="193" width="8" height="8" rx="1"/><rect x="76" y="193" width="8" height="8" rx="1"/>' +
    '<rect x="88" y="193" width="8" height="8" rx="1"/><rect x="100" y="193" width="8" height="8" rx="1"/>' +
    '<rect x="112" y="193" width="8" height="8" rx="1"/><rect x="124" y="193" width="8" height="8" rx="1"/>' +
  '</g>' +
  '<text x="40" y="216" font-size="6.5" fill="rgba(255,255,255,.2)" font-family="ui-monospace,monospace">R  S  T  U  V  W  +  −</text>' +

  // ── Phone (right) ──
  '<rect x="289" y="14" width="148" height="240" rx="20" fill="#1a1b1f" stroke="#2c2e38" stroke-width="1.5"/>' +
  '<rect x="289" y="14" width="148" height="240" rx="20" fill="none" stroke="rgba(255,255,255,.055)" stroke-width="1"/>' +
  // Notch
  '<rect x="331" y="19" width="64" height="14" rx="4" fill="#0a0b0e"/>' +
  // Camera lens
  '<circle cx="363" cy="26" r="4.5" fill="#0a0b0e" stroke="#333" stroke-width="1"/>' +
  '<circle cx="363" cy="26" r="2.5" fill="#1a1b1f"/>' +
  // Home bar
  '<rect x="337" y="243" width="52" height="4" rx="2" fill="rgba(255,255,255,.1)"/>' +
  // Screen bg
  '<rect x="296" y="44" width="134" height="168" rx="4" fill="#0a0c10"/>' +

  // Viewfinder frame (always visible)
  '<g clip-path="url(#vv-phone-clip)">' +
    '<text x="363" y="66" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,.2)" font-family="ui-monospace,monospace">MIRA VISION</text>' +
    // Corner brackets
    '<g stroke="#00d4aa" stroke-width="1.5" fill="none" opacity=".7">' +
      // TL
      '<path d="M314,80 L314,92 M314,80 L326,80"/>' +
      // TR
      '<path d="M412,80 L412,92 M412,80 L400,80"/>' +
      // BL
      '<path d="M314,188 L314,176 M314,188 L326,188"/>' +
      // BR
      '<path d="M412,188 L412,176 M412,188 L400,188"/>' +
    '</g>' +
    // Center crosshair
    '<line x1="363" y1="128" x2="363" y2="140" stroke="rgba(0,212,170,.4)" stroke-width="1"/>' +
    '<line x1="357" y1="134" x2="369" y2="134" stroke="rgba(0,212,170,.4)" stroke-width="1"/>' +

    // ── Scene 0: Point phone at equipment ──
    '<g class="c-scene" id="vv-s0">' +
      '<text x="363" y="155" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.2)" font-family="ui-monospace,monospace">Point at equipment</text>' +
      '<text x="363" y="168" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,.14)" font-family="ui-monospace,monospace">to identify &amp; diagnose</text>' +
    '</g>' +

    // ── Scene 1: Scan line sweeping ──
    '<g class="c-scene" id="vv-s1" style="opacity:0">' +
      // Scan beam
      '<rect x="314" y="80" width="98" height="2" fill="#00d4aa" opacity=".9" filter="url(#vv-scan-glow)">' +
        '<animate attributeName="y" values="80;188;80" dur="1.6s" repeatCount="indefinite"/>' +
        '<animate attributeName="opacity" values=".9;.6;.9" dur="1.6s" repeatCount="indefinite"/>' +
      '</rect>' +
      '<text x="363" y="160" text-anchor="middle" font-size="7.5" fill="rgba(0,212,170,.6)" font-family="ui-monospace,monospace">Scanning…</text>' +
    '</g>' +

    // ── Scene 2: Nameplate identified ──
    '<g class="c-scene" id="vv-s2" style="opacity:0">' +
      // Nameplate highlight box
      '<rect x="316" y="106" width="94" height="52" rx="3" fill="rgba(0,212,170,.06)" stroke="#00d4aa" stroke-width="1.5"/>' +
      '<text x="363" y="119" text-anchor="middle" font-size="7.5" font-weight="600" fill="#00d4aa" font-family="ui-monospace,monospace">IDENTIFIED</text>' +
      '<text x="321" y="132" font-size="7" fill="#e8eaf0" font-family="ui-monospace,monospace">Allen-Bradley</text>' +
      '<text x="321" y="144" font-size="7" fill="#e8eaf0" font-family="ui-monospace,monospace">PowerFlex 525</text>' +
      '<text x="321" y="155" font-size="6.5" fill="rgba(232,234,240,.6)" font-family="ui-monospace,monospace">25B-E1P7N104</text>' +
    '</g>' +

    // ── Scene 3: Diagnosis from photo ──
    '<g class="c-scene" id="vv-s3" style="opacity:0">' +
      '<rect x="314" y="88" width="98" height="94" rx="6" fill="#091a12" stroke="#00d4aa" stroke-width="1.5"/>' +
      '<text x="363" y="103" text-anchor="middle" font-size="7" font-weight="700" fill="#00d4aa" font-family="ui-monospace,monospace">F-012 DIAGNOSIS</text>' +
      '<line x1="318" y1="108" x2="408" y2="108" stroke="rgba(0,212,170,.15)" stroke-width="1"/>' +
      '<text x="320" y="120" font-size="7" fill="#e8eaf0" font-family="ui-monospace,monospace">Input phase loss.</text>' +
      '<text x="320" y="132" font-size="7" fill="#e8eaf0" font-family="ui-monospace,monospace">Check L1 at TB1.</text>' +
      '<text x="320" y="144" font-size="7" fill="#e8eaf0" font-family="ui-monospace,monospace">Replace input fuse</text>' +
      '<text x="320" y="156" font-size="7" fill="#e8eaf0" font-family="ui-monospace,monospace">if blown.</text>' +
      '<rect x="316" y="162" width="96" height="14" rx="2" fill="rgba(0,212,170,.07)" stroke="rgba(0,212,170,.2)" stroke-width="1"/>' +
      '<text x="364" y="172" text-anchor="middle" font-size="7" fill="#00d4aa" font-family="ui-monospace,monospace">§ PF525 p.47</text>' +
    '</g>' +

  '</g>' + // /phone clip

  // ── Connecting arrow (phone aiming at VFD) ──
  '<g opacity=".18" stroke="rgba(255,255,255,.3)" stroke-width="1" stroke-dasharray="4,3" fill="none">' +
    '<line x1="214" y1="116" x2="290" y2="116"/>' +
    '<line x1="214" y1="155" x2="290" y2="155"/>' +
  '</g>' +

  '</svg>';

  // ── CSS injected into <head> ─────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent =
    '.cartoon-demo{position:relative;background:#09090c;border:1px solid rgba(255,255,255,.07);' +
    'border-radius:10px;overflow:hidden;cursor:pointer;' +
    'transition:transform 280ms cubic-bezier(.16,1,.3,1),box-shadow 280ms ease;' +
    'height:280px;display:flex;flex-direction:column;user-select:none;}' +
    '.cartoon-demo:hover{transform:translateY(-2px);box-shadow:0 0 0 1px rgba(240,160,0,.18);}' +
    '.cartoon-demo svg{flex-shrink:0;}' +
    '.cartoon-footer{position:absolute;bottom:0;left:0;right:0;height:40px;' +
    'display:flex;align-items:center;justify-content:space-between;padding:0 14px;' +
    'background:linear-gradient(transparent,rgba(0,0,0,.75));pointer-events:none;}' +
    '.c-caption{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;' +
    'text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.35);}' +
    '.c-dots{display:flex;gap:7px;pointer-events:auto;}' +
    '.c-dot{width:22px;height:3px;background:rgba(255,255,255,.13);border:none;' +
    'border-radius:2px;cursor:pointer;padding:0;transition:all 280ms cubic-bezier(.16,1,.3,1);outline:none;}' +
    '.c-dot:hover{background:rgba(255,255,255,.28);}' +
    '.c-dot.active{background:#f0a000;width:34px;box-shadow:0 0 10px rgba(240,160,0,.35);}' +
    '.c-scene{transition:opacity .55s cubic-bezier(.16,1,.3,1);}' +
    '@media(max-width:768px){.cartoon-demo{height:220px;}}';
  document.head.appendChild(css);

  // ── Mount on DOMContentLoaded ────────────────────────────────────────
  function init() {
    mount('cartoon-fd', FD, [
      'Ask any fault code to MIRA',
      'MIRA searches your manuals',
      'Cited answer in seconds',
      'Work order auto-created'
    ], 3400);

    mount('cartoon-cmms', CMMS, [
      'Fault diagnosed by MIRA',
      'Data flows to your CMMS',
      'Work order fields filled in',
      'Synced to MaintainX · Limble · UpKeep'
    ], 3400);

    mount('cartoon-vv', VV, [
      'Point phone at equipment',
      'MIRA scans the nameplate',
      'Model and spec identified',
      'Full diagnosis from photo'
    ], 3400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
