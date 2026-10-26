/* A stand-in for the artifact runtime's `db` capability, for tests only.
 * Mirrors the real contract where it matters to the page: onSnapshot first delivers a cached
 * (fromCache: true) view, then a definitive one; a write is seen at once with hasPendingWrites: true
 * and confirmed only after `latency` ms; errors carry {code}. The "server" lives in localStorage
 * under __fake_server so it survives reloads (interruption tests); every write attempt is logged in
 * __fake_writes. Config (localStorage __fake_cfg): {latency, fail: {code, times}, subError: {code, times}, snapshotDelay, readonly, noDb}. */
(() => {
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const cfg = () => ls('__fake_cfg', {});
  const server = () => ls('__fake_server', { answers: {}, hazards: {} });
  const pending = { answers: {}, hazards: {} };
  const listeners = { answers: [], hazards: [] };
  function view(coll, fromCache){
    const s = server()[coll] || {};
    const merged = { ...s };
    for (const [id, v] of Object.entries(pending[coll])) { if (v === null) delete merged[id]; else merged[id] = v; }
    const docs = Object.keys(merged).sort().map(id => ({ id, exists: true, data: () => merged[id], metadata: { fromCache, hasPendingWrites: id in pending[coll] } }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache, hasPendingWrites: Object.keys(pending[coll]).length > 0 } };
  }
  const notify = coll => listeners[coll].forEach(fn => fn(view(coll, false)));
  function write(coll, id, body){
    const log = ls('__fake_writes', []); log.push({ coll, id, op: body === null ? 'delete' : 'set', at: Date.now() }); put('__fake_writes', log);
    const c = cfg();
    if (c.readonly) return Promise.reject({ code: 'invalid_argument', message: 'no access' });
    if (c.fail && c.fail.times > 0) { c.fail.times--; put('__fake_cfg', c); return Promise.reject({ code: c.fail.code, message: 'injected' }); }
    pending[coll][id] = body; notify(coll);
    return new Promise(res => setTimeout(() => {
      const s = server(); s[coll] = s[coll] || {};
      if (body === null) delete s[coll][id]; else s[coll][id] = JSON.parse(JSON.stringify(body));
      put('__fake_server', s); delete pending[coll][id]; notify(coll); res();
    }, c.latency || 50));
  }
  const db = {
    collection(coll){
      return {
        doc: id => ({ set: b => write(coll, id, b), delete: () => write(coll, id, null), get: async () => { const v = server()[coll]?.[id]; return { id, exists: !!v, data: () => v, metadata: { fromCache: false, hasPendingWrites: false } }; } }),
        onSnapshot(next, error){
          setTimeout(() => next(view(coll, true)), 5);
          const c = cfg();
          if (c.subError && c.subError.times > 0) {            // a terminal subscription error before the first definitive snapshot
            c.subError.times--; put('__fake_cfg', c);
            setTimeout(() => error && error({ code: c.subError.code, message: 'injected' }), 20);
            return () => {};
          }
          listeners[coll].push(next);
          setTimeout(() => next(view(coll, false)), (c.snapshotDelay || 30));
          return () => { listeners[coll] = listeners[coll].filter(f => f !== next); };
        },
      };
    },
  };
  window.claude = { use: async name => (name === 'db' && !cfg().noDb ? db : null) };
})();
