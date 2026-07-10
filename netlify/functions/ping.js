export async function handler() {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      ok: true,
      message: 'Netlify Functions are running.',
      timestamp: new Date().toISOString()
    })
  };
}
