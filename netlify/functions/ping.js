import { getBlobConfigStatus } from './lib/storage.js';

export default async function ping() {
  return Response.json({
    ok: true,
    version: '1.0.13',
    message: 'Netlify Functions are running with PDF upload fallback support for blocked scrapes.',
    storage: 'Netlify Blobs',
    backgroundEndpoint: '/api/process-audit-background',
    blobs: getBlobConfigStatus(),
    timestamp: new Date().toISOString()
  }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}

export const config = {
  path: '/api/ping',
  method: ['GET']
};
