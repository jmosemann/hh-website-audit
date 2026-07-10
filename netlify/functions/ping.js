export async function handler() {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      ok: true,
      version: '1.0.2',
      message: 'Netlify Functions are running.',
      backgroundEndpoint: '/api/process-audit-background',
      timestamp: new Date().toISOString()
    })
  };
}
