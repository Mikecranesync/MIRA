/* FactoryLM marketing interactions — vanilla JS, no dependencies */
(function () {
  'use strict';

  /* ---- preview bar dismiss (session only) ---- */
  var bar = document.querySelector('[data-preview-bar]');
  if (bar) {
    try { if (sessionStorage.getItem('flm-preview-bar') === 'hidden') bar.classList.add('is-hidden'); } catch (e) {}
    var close = bar.querySelector('button');
    if (close) close.addEventListener('click', function () {
      bar.classList.add('is-hidden');
      try { sessionStorage.setItem('flm-preview-bar', 'hidden'); } catch (e) {}
    });
  }

  /* ---- mobile drawer ---- */
  var burger = document.querySelector('[data-burger]');
  var drawer = document.getElementById('drawer');
  function setDrawer(open) {
    if (!burger || !drawer) return;
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    drawer.classList.toggle('is-open', open);
    drawer.hidden = !open;
  }
  if (burger && drawer) {
    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      setDrawer(burger.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') { setDrawer(false); burger.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (burger.getAttribute('aria-expanded') === 'true' && !drawer.contains(e.target) && !burger.contains(e.target)) setDrawer(false);
    });
    drawer.addEventListener('click', function (e) { if (e.target.closest('a')) setDrawer(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 900) setDrawer(false); });
  }

  /* ---- demo pre-qualifier chips ---- */
  var summary = document.getElementById('demo-summary');
  var groups = document.querySelectorAll('[data-chip-group]');
  function updateSummary() {
    if (!summary) return;
    var emailLink = document.querySelector('[data-demo-email]');
    var emailBase = 'mailto:mike@factorylm.com?subject=FactoryLM%20demo%20request';
    if (emailLink) emailLink.href = emailBase;
    var picks = {};
    groups.forEach(function (g) {
      var name = g.getAttribute('data-chip-group');
      picks[name] = Array.prototype.map.call(g.querySelectorAll('.chip[aria-pressed="true"]'), function (c) { return c.getAttribute('data-value'); });
    });
    var size = picks.size && picks.size[0];
    var brands = picks.brands || [];
    var focus = picks.focus || [];
    if (!size && !brands.length && !focus.length) {
      summary.innerHTML = 'Add optional context for your demo request.';
      return;
    }
    var parts = [];
    parts.push('Demo request for ' + (size ? '<b>' + size + '</b>' : 'my team'));
    if (brands.length) parts.push('using ' + (brands.length > 1 ? '<b>' + brands.slice(0, -1).join(', ') + '</b> and <b>' + brands[brands.length - 1] + '</b> manuals' : 'a <b>' + brands[0] + '</b> manual'));
    var s = parts.join(' ') + '.';
    if (focus.length) s += ' Focus: <b>' + focus.join(', ') + '</b>.';
    s += ' Bring one real question about your equipment manual or electrical prints.';
    summary.innerHTML = s;
    if (emailLink) emailLink.href = emailBase + '&body=' + encodeURIComponent(summary.textContent + '\n\nEquipment and question:\n');
    var note = document.getElementById('demo-note');
    if (note) note.value = summary.textContent;
  }
  groups.forEach(function (g) {
    var single = g.hasAttribute('data-single');
    g.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var on = chip.getAttribute('aria-pressed') === 'true';
        if (single) g.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
        chip.setAttribute('aria-pressed', on ? 'false' : 'true');
        updateSummary();
      });
    });
  });
  updateSummary();

  /* ---- load the real booking calendar only when requested ---- */
  var calendarButton = document.querySelector('[data-load-calendar]');
  var calendarFrame = document.getElementById('booking-calendar');
  if (calendarButton && calendarFrame) {
    calendarButton.addEventListener('click', function () {
      if (!calendarFrame.getAttribute('src')) calendarFrame.src = calendarFrame.getAttribute('data-booking-src');
      calendarFrame.hidden = false;
      calendarButton.setAttribute('aria-expanded', 'true');
      calendarButton.textContent = 'Calendar opened below';
    });
  }

})();
