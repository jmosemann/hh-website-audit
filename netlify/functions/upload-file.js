import { getUploadStore } from './lib/storage.js';

const DEFAULT_MAX_BYTES = 2.5 * 1024 * 1024;

export default async function uploadFile(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || DEFAULT_MAX_BYTES);
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return json({ error: 'Invalid upload payload.' }, 400);
    }

    const name = cleanName(body.name || 'uploaded-file');
    const mimeType = String(body.mimeType || 'application/octet-stream').slice(0, 100);
    const size = Number(body.size || 0);
    const text = typeof body.text === 'string' ? body.text.slice(0, 24000) : '';
    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';

    if (!name) return json({ error: 'File name is required.' }, 400);
    if (size > maxBytes) {
      return json({
        error: `${name} is too large. The current upload limit is ${formatBytes(maxBytes)} per file. Save a smaller PDF or paste the page text instead.`
      }, 413);
    }

    if (!text && !dataUrl) {
      return json({ error: `${name} had no readable content.` }, 400);
    }

    if (dataUrl && !dataUrl.startsWith('data:application/pdf;base64,')) {
      return json({ error: 'Only PDF data URLs may be uploaded as binary files.' }, 400);
    }

    const id = makeId();
    const blobKey = `${new Date().toISOString().slice(0,10)}/${id}-${name}`;
    const record = {
      id,
      blobKey,
      name,
      mimeType,
      size,
      text,
      dataUrl,
      createdAt: new Date().toISOString()
    };

    const store = getUploadStore();
    await store.setJSON(blobKey, record, {
      metadata: { name, mimeType, size: String(size), createdAt: record.createdAt }
    });

    return json({
      ok: true,
      blobKey,
      name,
      mimeType,
      size,
      uploadedAt: record.createdAt
    });
  } catch (err) {
    return json({ error: err?.message || 'Upload failed.' }, 500);
  }
}

export const config = {
  path: '/api/upload-file',
  method: ['POST']
};

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
}

function cleanName(value) {
  return String(value || 'uploaded-file')
    .replace(/[^\w.\- ()]+/g, '-')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 160)
    .trim() || 'uploaded-file';
}

function formatBytes(bytes = 0) {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}
