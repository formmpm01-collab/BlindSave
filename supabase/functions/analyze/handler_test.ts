import { strict as assert } from 'node:assert';

Deno.env.set('ALLOWED_ORIGINS', 'https://blindsave.example');
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-public-key');
const { handleRequest } = await import('./handler.ts');
const input = {
  annualKwh: { p1: 1000, p2: 1000, p3: 1500 }, power: { p1: 4.6, p2: 4.6 },
  currentRates: { p1: .2, p2: .15, p3: .1, powerP1: .1, powerP2: .02, monthlyFee: 0 },
};
const tariff = {
  id: '11111111-1111-4111-8111-111111111111', provider: 'Public supplier', name: 'Fixed price',
  energy_p1: .1, energy_p2: .1, energy_p3: .1, power_p1: .08, power_p2: .02, monthly_fee: 0,
  commitment_months: 0, renewable: true, conditions: 'Fixed price for twelve months.',
  source_url: 'https://example.org/terms', verified_at: new Date().toISOString(), is_demo: false,
};
function request(body: unknown = input, headers: Record<string, string> = {}) {
  return new Request('http://localhost/analyze', {
    method: 'POST', headers: { origin: 'https://blindsave.example', 'content-type': 'application/json', authorization: 'Bearer test-token', ...headers },
    body: JSON.stringify(body),
  });
}
async function withBackend(options: { authenticated?: boolean; quota?: boolean; rows?: unknown[] }, test: (calls: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((resource: RequestInfo | URL) => {
    const url = resource instanceof Request ? resource.url : resource.toString();
    calls.push(url);
    if (url.includes('/auth/v1/user')) return Promise.resolve(Response.json(options.authenticated === false ? { message: 'Invalid token' } : { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', aud: 'authenticated', role: 'authenticated' }, { status: options.authenticated === false ? 401 : 200 }));
    if (url.includes('/rpc/consume_analysis_quota')) return Promise.resolve(Response.json(options.quota ?? true));
    if (url.includes('/rest/v1/tariffs')) return Promise.resolve(Response.json(options.rows ?? [tariff]));
    throw new Error('Unexpected network request');
  }) as typeof fetch;
  try { await test(calls); } finally { globalThis.fetch = original; }
}

Deno.test('preflight only allows configured origins', async () => {
  const valid = await handleRequest(new Request('http://localhost/analyze', { method: 'OPTIONS', headers: { origin: 'https://blindsave.example' } }));
  assert.equal(valid.status, 204);
  assert.equal(valid.headers.get('access-control-allow-origin'), 'https://blindsave.example');
  const invalid = await handleRequest(request(input, { origin: 'https://other.example' }));
  assert.equal(invalid.status, 403); await invalid.body?.cancel();
});
Deno.test('rejects missing authentication and unsupported content types', async () => {
  const noAuth = await handleRequest(request(input, { authorization: '' }));
  assert.equal(noAuth.status, 401); await noAuth.body?.cancel();
  const wrongType = await handleRequest(request(input, { 'content-type': 'text/plain' }));
  assert.equal(wrongType.status, 415); await wrongType.body?.cancel();
});
Deno.test('rejects a forged JWT before querying the database', () => withBackend({ authenticated: false }, async calls => {
  const response = await handleRequest(request());
  assert.equal(response.status, 401); await response.body?.cancel();
  assert.equal(calls.length, 1);
}));
Deno.test('rate limit stops the request before catalog access', () => withBackend({ quota: false }, async calls => {
  const response = await handleRequest(request());
  assert.equal(response.status, 429); await response.body?.cancel();
  assert.equal(calls.length, 2);
}));
Deno.test('strict schema rejects identifiers without echoing them', () => withBackend({}, async calls => {
  const response = await handleRequest(request({ ...input, email: 'private@example.org' }));
  assert.equal(response.status, 422);
  assert.equal((await response.text()).includes('private@example.org'), false);
  assert.equal(calls.length, 2);
}));
Deno.test('enforces byte limit without relying on content-length', () => withBackend({}, async () => {
  const response = await handleRequest(request({ text: 'x'.repeat(9000) }));
  assert.equal(response.status, 413); await response.body?.cancel();
}));
Deno.test('empty production catalog never falls back to demonstration', () => withBackend({ rows: [] }, async () => {
  const response = await handleRequest(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'no_verified_tariffs' });
}));
Deno.test('successful comparison uses reviewed catalog and does not persist consumption', () => withBackend({}, async calls => {
  const response = await handleRequest(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.tariffs.length, 1);
  assert.ok(Math.abs(body.analysis.recommendations[0].breakdown.total - (350 + 167.9)) < .00001);
  assert.equal(calls.length, 3);
  assert.ok(calls[2].includes('is_demo=eq.false'));
  assert.ok(calls[2].includes('verified_at=gte.'));
  assert.ok(calls[2].includes('valid_until=gte.'));
}));
