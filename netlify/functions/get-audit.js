import { getAuditStore } from './lib/storage.js';

export default async function getAudit(req) {
  if (req.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return json({ error: 'Missing audit id.' }, 400);

    const store = getAuditStore();
    const record = await store.get(id, { type: 'json' });
    if (!record) return json({ error: 'Audit not found.' }, 404);

    if (record.status === 'complete') {
      return json({ id, status: 'complete', audit: record.audit || record });
    }

    return json({
      id,
      status: record.status || 'complete',
      message: record.message || '',
      error: record.error || ''
    });
  } catch (err) {
    return json({ error: err?.message || 'Could not load audit.' }, 500);
  }
}

export const config = {
  path: '/api/get-audit',
  method: ['GET']
};

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}
