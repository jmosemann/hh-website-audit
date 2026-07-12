import { getAuditStore } from './lib/storage.js';
import { runAuditJob } from './lib/audit-core.js';

export default async function processAuditBackground(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const { id, dealerName, urls, createdAt } = payload || {};
  if (!id || !urls?.homepage || !urls?.vdp || !urls?.service) {
    return json({ error: 'Missing id or URLs.' }, 400);
  }

  const store = getAuditStore();

  try {
    const current = await store.get(id, { type: 'json' });
    if (current?.status === 'complete') return json({ id, status: 'complete', message: 'Audit already complete.' }, 202);
    if (current?.status === 'generating') return json({ id, status: 'generating', message: 'Audit is already generating.' }, 202);

    await store.setJSON(id, {
      ...(current || {}),
      id,
      status: 'generating',
      message: 'Extracting pages and generating audit.',
      dealerName,
      urls,
      createdAt,
      updatedAt: new Date().toISOString()
    }, { metadata: { dealerName, createdAt, status: 'generating' } });

    const { audit, sources } = await runAuditJob({ dealerName, urls, createdAt });
    audit.id = id;

    await store.setJSON(id, {
      id,
      status: 'complete',
      audit,
      dealerName: audit.dealerName || dealerName,
      urls,
      sources,
      createdAt,
      updatedAt: new Date().toISOString()
    }, { metadata: { dealerName: audit.dealerName || dealerName, createdAt, status: 'complete' } });

    return json({ id, status: 'complete', message: 'Audit generated.' }, 202);
  } catch (err) {
    await store.setJSON(id, {
      id,
      status: 'failed',
      error: err?.message || 'Audit generation failed.',
      dealerName,
      urls,
      createdAt,
      updatedAt: new Date().toISOString()
    }, { metadata: { dealerName, createdAt, status: 'failed' } });

    return json({ id, status: 'failed', error: err?.message || 'Audit generation failed.' }, 202);
  }
}

export const config = {
  path: '/api/process-audit-background',
  method: ['POST'],
  background: true
};

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}
