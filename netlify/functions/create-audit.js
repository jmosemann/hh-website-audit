import { getStore } from '@netlify/blobs';
import { requireUrl } from './lib/audit-core.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return send(405, { error: 'Method not allowed.' });

  try {
    const body = JSON.parse(event.body || '{}');
    const urls = {
      homepage: requireUrl(body.homepageUrl, 'Homepage URL'),
      vdp: requireUrl(body.vdpUrl, 'VDP URL'),
      service: requireUrl(body.serviceUrl, 'Service URL')
    };
    const dealerName = typeof body.dealerName === 'string' ? body.dealerName.trim() : '';
    const id = makeId();
    const createdAt = new Date().toISOString();

    const job = {
      id,
      status: 'queued',
      message: 'Audit queued. The background worker is generating the report.',
      dealerName,
      urls,
      createdAt,
      updatedAt: createdAt
    };

    const store = getStore('dealer-audits');
    await store.setJSON(id, job, { metadata: { dealerName, createdAt, status: 'queued' } });

    const workerStarted = await triggerWorker(event, { id, dealerName, urls, createdAt });

    return send(202, {
      id,
      status: 'queued',
      dealerName,
      urls,
      createdAt,
      workerStarted,
      message: workerStarted
        ? 'Audit queued. Keep this page open while the app polls for completion.'
        : 'Audit queued, but the worker could not be auto-started. The browser will try to start it next.'
    });
  } catch (err) {
    return send(400, { error: err?.message || 'Could not create audit.' });
  }
}

async function triggerWorker(event, payload) {
  const endpoint = getBaseUrl(event) + '/.netlify/functions/process-audit-background';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timer);
    return res.ok || res.status === 202;
  } catch {
    return false;
  }
}

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL;
  if (process.env.DEPLOY_PRIME_URL) return process.env.DEPLOY_PRIME_URL;
  const host = event.headers?.host || 'localhost:8888';
  const proto = event.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
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
