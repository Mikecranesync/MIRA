(function () {
  var KEY = "fl_sun_mode";

  // Label reflects the NEXT action, not the current state — so it's always
  // clear what clicking will do. OFF → offers sun-readable; ON → offers dark.
  var LABEL_OFF = "☀ Sun-readable";          // ☀ Sun-readable
  var LABEL_ON = "🌙 Dark mode";        // 🌙 Dark mode
  var ARIA_OFF = "Switch to sun-readable high-contrast mode";
  var ARIA_ON = "Switch back to dark mode";

  function setLabel(btn, on) {
    if (!btn) return;
    btn.textContent = on ? LABEL_ON : LABEL_OFF;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? ARIA_ON : ARIA_OFF);
  }

  function applyState() {
    var on = false;
    try {
      on = localStorage.getItem(KEY) === "1";
    } catch (e) { /* localStorage blocked */ }
    if (on) document.body.classList.add("sun");
    setLabel(document.getElementById("fl-sun-toggle"), on);
  }

  window.flToggleSun = function () {
    var on = document.body.classList.toggle("sun");
    setLabel(document.getElementById("fl-sun-toggle"), on);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* blocked */ }
  };

  document.addEventListener("DOMContentLoaded", function () {
    applyState();
    var btn = document.getElementById("fl-sun-toggle");
    if (btn) btn.addEventListener("click", window.flToggleSun);
  });
})();
