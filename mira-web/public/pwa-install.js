(function () {
  var deferred = null;
  var banner = null;

  function dismissed() {
    try { return sessionStorage.getItem('pwa_dismissed') === '1'; } catch (_) { return false; }
  }

  function showBanner() {
    if (banner || dismissed()) return;
    banner = document.createElement('div');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Install app');
    banner.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;z-index:9000;' +
      'background:#1B365D;color:#fff;' +
      'display:flex;align-items:center;justify-content:space-between;gap:12px;' +
      'padding:12px 16px;font-size:14px;line-height:1.4;' +
      'box-shadow:0 -2px 8px rgba(0,0,0,0.25);';

    var msg = document.createElement('span');
    msg.textContent = 'Add FactoryLM to your home screen for quick floor access.';

    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';

    var install = document.createElement('button');
    install.textContent = 'Install';
    install.style.cssText =
      'background:#f5a623;color:#0d0d0b;border:none;border-radius:6px;' +
      'padding:8px 16px;font-weight:700;font-size:14px;cursor:pointer;';
    install.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function (r) {
        if (r.outcome === 'accepted') removeBanner();
        deferred = null;
      });
    });

    var dismiss = document.createElement('button');
    dismiss.textContent = '\u2715';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.style.cssText =
      'background:transparent;color:rgba(255,255,255,0.7);border:none;' +
      'font-size:18px;cursor:pointer;padding:4px 8px;';
    dismiss.addEventListener('click', function () {
      try { sessionStorage.setItem('pwa_dismissed', '1'); } catch (_) {}
      removeBanner();
    });

    btns.appendChild(install);
    btns.appendChild(dismiss);
    banner.appendChild(msg);
    banner.appendChild(btns);
    document.body.appendChild(banner);
  }

  function removeBanner() {
    if (banner) { banner.remove(); banner = null; }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (!dismissed()) setTimeout(showBanner, 4000);
  });

  window.addEventListener('appinstalled', function () {
    removeBanner();
    deferred = null;
  });
})();
