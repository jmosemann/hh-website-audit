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
