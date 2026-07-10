# Dealer Website Audit Generator

Netlify-ready MVP for generating dealer website audits from three URLs:

- Homepage URL
- VDP / inventory URL
- Service URL

The app renders a Herohub-style audit preview and includes a browser-based PDF download.

## Version

`1.0.4`

This version switches Netlify Functions to the modern Request/Response syntax and config-based routes. This avoids the common Netlify Blobs `MissingBlobsEnvironmentError` seen with legacy Lambda-style handlers.

Netlify's current Functions docs recommend a default export that receives a Web API `Request` and returns a `Response`. The app now follows that pattern.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Do not use `npm run dev:vite` for the full app because Vite alone will not run Netlify Functions.

Open:

```text
http://localhost:8888/api/ping
```

Expected response:

```json
{
  "ok": true,
  "version": "1.0.4",
  "message": "Netlify Functions are running with modern Request/Response syntax."
}
```

## Environment variables

Required for real AI generation:

```env
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4.1-mini
```

Optional only if your local Netlify Blobs context is not injected:

```env
NETLIFY_BLOBS_SITE_ID=your_netlify_project_id
NETLIFY_BLOBS_TOKEN=your_netlify_personal_access_token
```

In production, Netlify Blobs should auto-configure from the modern function runtime. Keep any token server-side only.

## Netlify deploy

Push the project to GitHub and connect it to Netlify.

Build settings:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

The function routes are configured in the function files:

```text
/api/ping
/api/create-audit
/api/get-audit
/api/process-audit-background
```

## Troubleshooting

### `/api/ping` shows HTML

Functions are not running. Start with:

```bash
npm run dev
```

or confirm the site is deployed with the `netlify/functions` directory.

### Netlify Blobs says the environment is not configured

Use v1.0.4 or later. Earlier versions used legacy Lambda-style functions, which can trigger `MissingBlobsEnvironmentError`.

If it still happens locally:

1. Run `netlify link`
2. Restart `npm run dev`
3. Add `NETLIFY_BLOBS_SITE_ID` and `NETLIFY_BLOBS_TOKEN` to `.env`
4. Confirm `/api/ping` shows `functionSyntax: "modern-request-response"`

### Audit is stuck generating

Open Netlify function logs for:

```text
process-audit-background
```

If dealer sites block extraction, the app still generates a fallback/sample audit unless OpenAI generation fails completely.

## Notes

This MVP uses Netlify Blobs for audit JSON storage. For production accounts, edit history, teams, or higher volume, Supabase or another database may be a better long-term storage layer.
