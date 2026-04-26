/**
 * PostHog init stub for FactoryLM.
 *
 * Defines window.posthog with a no-op capture() so [data-cta] click handlers
 * never throw. When PLG_POSTHOG_KEY ships, the real client will overwrite this.
 *
 * Also installs a single document-level click delegate that fires
 * posthog.capture('cta_click', { cta: <value> }) for any element with [data-cta].
 */
(function () {
  if (!window.posthog) {
    window.posthog = {
      capture: function () {},
      identify: function () {},
    };
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      while (t && t !== document.body) {
        if (t.dataset && t.dataset.cta) {
          try {
            window.posthog.capture("cta_click", {
              cta: t.dataset.cta,
              href: t.getAttribute && t.getAttribute("href"),
              path: window.location.pathname,
            });
          } catch (_) {}
          return;
        }
        t = t.parentElement;
      }
    },
    { passive: true }
  );
})();
