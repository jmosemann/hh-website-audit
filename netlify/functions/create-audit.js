import { getAuditStore } from './lib/storage.js';
import { requireUrl } from './lib/audit-core.js';

export default async function createAudit(req, context) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const urls = {
      homepage: requireUrl(body.homepageUrl, 'Homepage URL'),
      vdp: requireUrl(body.vdpUrl, 'VDP URL'),
      service: requireUrl(body.serviceUrl, 'Service URL')
    };

    const dealerName = typeof body.dealerName === 'string' ? body.dealerName.trim() : '';
    const manualContent = normalizeManualContent(body.manualContent || {
      homepage: body.homepageContent,
      vdp: body.vdpContent,
      service: body.serviceContent,
      notes: body.notes
    });
    const id = makeId();
    const createdAt = new Date().toISOString();

    const job = {
      id,
      status: 'queued',
      message: 'Audit queued. The background worker is generating the report.',
      dealerName,
      urls,
      manualContent,
      createdAt,
      updatedAt: createdAt
    };

    const store = getAuditStore();
    await store.setJSON(id, job, { metadata: { dealerName, createdAt, status: 'queued' } });

    const workerStarted = await triggerWorker(req, { id, dealerName, urls, manualContent, createdAt });

    return json({
      id,
      status: 'queued',
      dealerName,
      urls,
      manualContent,
      createdAt,
      workerStarted,
      message: workerStarted
        ? 'Audit queued. Keep this page open while the app polls for completion.'
        : 'Audit queued. If it does not begin within a few seconds, check the background function logs.'
    }, 202);
  } catch (err) {
    return json({ error: err?.message || 'Could not create audit.' }, 400);
  }
}

export const config = {
  path: '/api/create-audit',
  method: ['POST']
};

async function triggerWorker(req, payload) {
  const endpoint = new URL('/api/process-audit-background', req.url).toString();

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


function normalizeManualContent(input = {}) {
  const clean = (value) => typeof value === 'string' ? value.trim().slice(0, 24000) : '';
  const files = input.files || {};
  return {
    homepage: clean(input.homepage),
    vdp: clean(input.vdp),
    service: clean(input.service),
    notes: clean(input.notes),
    files: {
      homepage: normalizeFiles(files.homepage || input.homepageFiles),
      vdp: normalizeFiles(files.vdp || input.vdpFiles),
      service: normalizeFiles(files.service || input.serviceFiles)
    }
  };
}


function normalizeFiles(files = []) {
  const maxFiles = Number(process.env.MAX_UPLOAD_FILES || 5);
  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 2.5 * 1024 * 1024);

  return (Array.isArray(files) ? files : [])
    .slice(0, maxFiles)
    .map((file) => ({
      name: typeof file.name === 'string' ? file.name.slice(0, 180) : 'uploaded-file',
      mimeType: typeof file.mimeType === 'string' ? file.mimeType.slice(0, 80) : 'application/octet-stream',
      size: Number(file.size || 0),
      text: typeof file.text === 'string' ? file.text.slice(0, 24000) : '',
      blobKey: typeof file.blobKey === 'string' ? file.blobKey.slice(0, 300) : '',
      dataUrl: typeof file.dataUrl === 'string' && String(file.dataUrl).startsWith('data:application/pdf;base64,') && Number(file.size || 0) <= maxBytes
        ? file.dataUrl
        : ''
    }))
    .filter((file) => file.text || file.dataUrl || file.blobKey);
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}
