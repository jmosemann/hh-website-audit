import { getStore } from '@netlify/blobs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') return send(405, { error: 'Method not allowed.' });
    const id = event.queryStringParameters?.id;
    if (!id) return send(400, { error: 'Missing audit id.' });

    const store = getStore('dealer-audits');
    const audit = await store.get(id, { type: 'json' });
    if (!audit) return send(404, { error: 'Audit not found.' });
    return send(200, { audit });
  } catch (err) {
    return send(500, { error: err?.message || 'Could not load audit.' });
  }
}

function send(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
