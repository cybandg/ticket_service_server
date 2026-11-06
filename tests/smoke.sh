// Lightweight load test using built-in fetch. Run: node tests/load_test.js
const BASE_URL = process.env.BASE_URL || 'http://localhost:5678';
const USERS = Number(process.env.USERS || 10);          // virtual users
const ITERATIONS = Number(process.env.ITERATIONS || 10); // requests per user (read-heavy)

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function userFlow(n) {
  const login = `load_${Date.now()}_${n}_${Math.floor(Math.random() * 1e6)}`;
  const password = 'password123';
  const lat = [];
  const errors = [];
  const t = (label, fn) => (async () => {
    const start = process.hrtime.bigint();
    const r = await fn();
    lat.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (r.status >= 400) errors.push(`${label} -> ${r.status} ${JSON.stringify(r.json?.error || '')}`);
    return r;
  })();

  await t('register', () => api('/registration', { method: 'POST', body: { login, password } }));
  const auth = await t('login', () => api('/auth', { method: 'POST', body: { login, password } }));
  const token = auth.json.accessToken;
  let draftId = auth.json.user.draft.id;

  for (let i = 0; i < ITERATIONS; i++) {
    const created = await t('create', () => api('/tickets', {
      method: 'POST', token,
      body: { draftId, title: `Load ticket ${n}-${i}`, description: 'desc', category: 'Другое' },
    }));
    draftId = created.json?.newDraft?.id;
    if (!draftId) break;

    await t('list', () => api('/tickets', { token }));
    await t('search', () => api(`/tickets?search=Load&status=new`, { token }));
    await t('edit', () => api(`/tickets/${created.json.ticket.id}`, {
      method: 'PATCH', token, body: { status: 'in_work' },
    }));
    await t('delete', () => api(`/tickets/${created.json.ticket.id}`, { method: 'DELETE', token }));
    await t('me', () => api('/auth/me', { token }));
  }
  await t('logout', () => api('/logout', { method: 'POST', token, body: { refreshToken: auth.json.refreshToken } }));
  return { lat, errors };
}

(async () => {
  console.log(`Load test: ${USERS} users x ${ITERATIONS} iterations against ${BASE_URL}`);
  const started = Date.now();
  const all = await Promise.all(Array.from({ length: USERS }, (_, i) => userFlow(i)));
  const elapsed = (Date.now() - started) / 1000;

  const lat = all.flatMap(a => a.lat).sort((x, y) => x - y);
  const errors = all.flatMap(a => a.errors);
  const pct = p => lat[Math.floor(lat.length * p)]?.toFixed(1);

  console.log(`Requests : ${lat.length}`);
  console.log(`Duration : ${elapsed.toFixed(2)}s  (~${(lat.length / elapsed).toFixed(1)} req/s)`);
  console.log(`Latency  : p50 ${pct(0.5)}ms | p95 ${pct(0.95)}ms | p99 ${pct(0.99)}ms | max ${lat[lat.length - 1].toFixed(1)}ms`);
  console.log(`Errors   : ${errors.length}`);
  errors.slice(0, 20).forEach(e => console.log('   ', e));
  process.exit(errors.length === 0 ? 0 : 1);
})();