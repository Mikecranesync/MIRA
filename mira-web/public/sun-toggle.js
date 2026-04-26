(function () {
  var KEY = "fl_sun_mode";

  function applyState() {
    try {
      if (localStorage.getItem(KEY) === "1") {
        document.body.classList.add("sun");
        var btn = document.getElementById("fl-sun-toggle");
        if (btn) btn.setAttribute("aria-pressed", "true");
      }
    } catch (e) { /* localStorage blocked */ }
  }

  window.flToggleSun = function () {
    var on = document.body.classList.toggle("sun");
    var btn = document.getElementById("fl-sun-toggle");
    if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* blocked */ }
  };

  document.addEventListener("DOMContentLoaded", applyState);
})();
