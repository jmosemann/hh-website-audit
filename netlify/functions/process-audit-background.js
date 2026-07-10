import { getStore } from '@netlify/blobs';
import { runAuditJob } from './lib/audit-core.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return send(405, { error: 'Method not allowed.' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return send(400, { error: 'Invalid JSON payload.' });
  }

  const { id, dealerName, urls, createdAt } = payload;
  if (!id || !urls?.homepage || !urls?.vdp || !urls?.service) {
    return send(400, { error: 'Missing id or URLs.' });
  }

  const store = getStore('dealer-audits');

  try {
    const current = await store.get(id, { type: 'json' });
    if (current?.status === 'complete') return send(202, { id, status: 'complete', message: 'Audit already complete.' });
    if (current?.status === 'generating') return send(202, { id, status: 'generating', message: 'Audit is already generating.' });

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

    return send(202, { id, status: 'complete', message: 'Audit generated.' });
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

    return send(202, { id, status: 'failed', error: err?.message || 'Audit generation failed.' });
  }
}

function send(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}
