import { createClient } from '@supabase/supabase-js';
import { analysisInputSchema, analyze, type Tariff } from '../_shared/engine.ts';

const allowedOrigins = new Set((Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean));
const MAX_BYTES = 8192;
async function readBoundedJson(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new Error('too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error('too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get('origin') ?? '';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !allowedOrigins.has(origin)) return respond(403, { error: 'origin_not_allowed' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return respond(405, { error: 'method_not_allowed' });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return respond(415, { error: 'json_required' });
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return respond(401, { error: 'authentication_required' });
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !user) return respond(401, { error: 'invalid_session' });
    const { data: quota, error: quotaError } = await client.rpc('consume_analysis_quota');
    if (quotaError) return respond(503, { error: 'quota_unavailable' });
    if (!quota) return respond(429, { error: 'rate_limit' });
    let raw: unknown;
    try { raw = await readBoundedJson(request); } catch (error) {
      return respond(error instanceof Error && error.message === 'too_large' ? 413 : 400, { error: 'invalid_body' });
    }
    const input = analysisInputSchema.safeParse(raw);
    if (!input.success) return respond(422, { error: 'invalid_numeric_input' });
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const oldestVerification = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const { data: rows, error } = await client.from('tariffs').select('*')
      .eq('status', 'published').eq('is_demo', false).eq('territory', 'peninsula_baleares')
      .lte('valid_from', today).gte('valid_until', today)
      .gte('verified_at', oldestVerification).lte('verified_at', now.toISOString())
      .gte('price_guarantee_months', 12).order('id').limit(100);
    if (error) return respond(503, { error: 'catalog_unavailable' });
    if (!rows?.length) return respond(503, { error: 'no_verified_tariffs' });
    const tariffs: Tariff[] = rows.map(row => ({
      id: row.id, provider: row.provider, name: row.name,
      rates: { p1: row.energy_p1, p2: row.energy_p2, p3: row.energy_p3, powerP1: row.power_p1, powerP2: row.power_p2, monthlyFee: row.monthly_fee },
      commitmentMonths: row.commitment_months, renewable: row.renewable, conditions: row.conditions,
      sourceUrl: row.source_url, verifiedAt: row.verified_at, isDemo: row.is_demo,
    }));
    const result = analyze(input.data, tariffs, now);
    // No inserts of consumption, files, results or request bodies. Never log body or auth headers.
    return respond(200, { tariffs, calculatedAt: result.calculatedAt, analysis: result });
  } catch {
    return respond(500, { error: 'analysis_unavailable' });
  }
}
