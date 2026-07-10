# Dealer Website Audit Generator

A Netlify-ready web app that generates a Herohub-style dealership website audit from three URLs:

- Homepage URL
- VDP / inventory URL
- Service URL

The app creates a styled web preview and a downloadable PDF.

## What it includes

- React + Vite frontend
- Netlify Functions backend
- Netlify Blobs saved audit JSON
- OpenAI Responses API structured JSON audit generation
- Built-in simple HTML scraper
- Herohub-style editorial report layout
- Browser-based PDF export with `html2pdf.js`
- Sample audit fallback when `OPENAI_API_KEY` is not set

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
