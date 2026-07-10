# Dealer Website Audit Generator

A Netlify-ready web app that generates a Herohub-style dealership website audit from three URLs:

- Homepage URL
- VDP / inventory URL
- Service URL

The app creates a styled web preview and a downloadable PDF.

## What it includes

- React + Vite frontend
- Netlify Functions backend with background audit generation
- Netlify Blobs saved audit JSON
- OpenAI Responses API structured JSON audit generation
- Built-in simple HTML scraper
- Herohub-style editorial report layout
- Browser-based PDF export with `html2pdf.js`
- Sample audit fallback when `OPENAI_API_KEY` is not set
- Background worker to avoid synchronous 504 timeouts during crawling/OpenAI generation

## Local setup

```bash
npm install
cp .env.example .env
```

Add your OpenAI API key:

```bash
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4.1-mini
```

Run locally:

```bash
npm run dev
```

Important: use `npm run dev`, which starts Netlify Dev. Do **not** use `npm run dev:vite` for testing audit generation because Vite alone does not run Netlify Functions.

After it starts, test this URL in your browser:

```text
http://localhost:8888/api/ping
```

It should return JSON:

```json
{ "ok": true, "message": "Netlify Functions are running." }
```

Netlify Dev usually serves the app at:

```text
http://localhost:8888
```

## Deploy to Netlify

1. Push this folder to GitHub.
2. Create a new Netlify site from the repo.
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Add environment variables in Netlify:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` optional

The included `netlify.toml` configures the build, functions folder, and SPA redirects.

## Important production note

Dealer websites often block server-side scraping or render key content with JavaScript. This MVP uses a simple HTML extractor. For production reliability, replace or extend the `extract()` function in:

```text
netlify/functions/create-audit.js
```

with Browserless, Firecrawl, Apify, ScrapingBee, or another rendered-page crawler.

The generator now uses a queued/background workflow:

```text
/api/create-audit returns quickly with an audit ID
↓
process-audit-background extracts pages and generates the audit
↓
/api/get-audit is polled until the report is complete
```

This avoids 504 errors from doing page extraction and OpenAI generation inside one synchronous request.

## PDF output

Open any generated audit and click **Download PDF**. The app uses the rendered audit HTML and print-friendly CSS to create a PDF in the browser.

## Audit format

The report includes:

- Digital experience review
- Dealer-specific headline
- Overall takeaway
- Pricing review
- Executive summary
- Scorecard
- What matters most
- Recommended priorities
- Page findings
- Pricing transparency review
- Recommended messaging
- Longer-term opportunity
- Bottom line
- Disclaimer


## Troubleshooting: `Unexpected token '<', "<HTML>..." is not valid JSON`

That error means the frontend expected JSON from the audit API, but received an HTML page instead. Usually one of these is happening:

1. The app is running with Vite only instead of Netlify Dev.
   - Use `npm run dev`
   - Do not use `npm run dev:vite` for full app testing.

2. The deployed site did not deploy the Netlify Functions.
   - In Netlify, open the site and check **Functions**.
   - You should see `create-audit`, `get-audit`, and `ping`.

3. The API route is falling through to the SPA HTML page.
   - Visit `/api/ping`.
   - If you see the app HTML instead of JSON, Netlify Functions are not being served.

4. A server error page is being returned as HTML.
   - Check Netlify Function logs for `create-audit`.
   - Confirm `OPENAI_API_KEY` is set in Netlify environment variables.


## Troubleshooting: `create-audit returned HTML instead of JSON... Status 504`

A 504 on `/api/create-audit` usually means the older synchronous version was still deployed or cached. Version 1.0.2 changes `create-audit` so it returns quickly and runs the long work in `process-audit-background`.

Check these items:

1. Redeploy the full v1.0.2 folder, not only selected files.
2. In Netlify, confirm the Functions list includes:
   - `create-audit`
   - `get-audit`
   - `ping`
   - `process-audit-background`
3. Visit `/api/ping`; it should return JSON.
4. Submit a test audit. The page should move to a "Generating audit" screen instead of waiting on the create request.
5. Check Netlify Function logs for `process-audit-background` if the audit stays queued.

If you still see 504 from `/api/create-audit`, the deployed site is not using this version of `create-audit.js`.
