# Herohub Dealer Website Audit Generator

Netlify-ready app for generating Herohub-branded dealer website audits from three URLs:

- Homepage URL
- VDP / inventory URL
- Service URL

The app generates a web preview and a downloadable PDF with a Herohub-styled audit layout.

## Version

`1.0.13`

This version includes the Herohub branding update plus v1.0.10 PDF polish:

- Herohub logo in the app header and PDF cover
- Herohub color palette
- IBM Plex Sans from Google Fonts
- Scandia font-family support with Adobe Fonts kit URL support and a safe fallback
- Smaller, more professional report headline sizing
- Cleaner print/PDF export styles
- Empty bullet filtering
- Better page-break handling
- Larger PDF top margins so page headings do not sit too close to the page edge
- Square SVG favicon so the browser icon is not squeezed
- Removed the OPENAI_API_KEY helper note from the visible landing page
- More polished scorecard, priority cards, callouts, and section headers


## Blocked scraping fallback

Some dealer sites block server-side page extraction. Version `1.0.13` supports two fallback options in the audit form:

- Upload saved page PDFs or text/HTML files for the homepage, VDP, and service page
- Paste fallback text/notes for each page
- Add additional audit notes

When uploaded files or pasted content are supplied, the backend treats them as user-provided source material. Text/HTML files are read into the fallback text. PDF files are attached to the OpenAI request as source files so the model can evaluate the visible PDF content when scraping is blocked.

Recommended workflow for blocked sites:

1. Open the dealership page in your browser.
2. Save the page as a PDF or print to PDF.
3. Upload the homepage, VDP, and service PDFs in the fallback panel.
4. Add any pricing, CTA, service, or dealership notes that may not appear in the PDF.
5. Generate the audit.

Limits:

- Keep each uploaded file under 4 MB by default.
- Upload up to 5 files per page field by default.
- These limits can be changed with `MAX_UPLOAD_BYTES` and `MAX_UPLOAD_FILES`.

The app still attempts normal extraction first, then combines any successful scrape with uploaded/pasted fallback content.

## Brand colors

```css
--hh-ink: #131515;
--hh-navy: #20364E;
--hh-teal: #00BFB3;
--hh-teal-dark: #00766e;
--hh-lime: #d8f1a0;
--hh-white: #ffffff;
```

## Fonts

IBM Plex Sans is loaded in `index.html` from Google Fonts.

Scandia can be used in either of two ways.

### Option A: Adobe Fonts kit URL

Create an Adobe Fonts web project/kit that includes Scandia, then add your kit CSS URL as a frontend environment variable:

```env
VITE_ADOBE_FONTS_URL=https://use.typekit.net/yourkitid.css
```

If your Adobe kit exposes Scandia under a specific CSS family name, set it here:

```env
VITE_SCANDIA_FONT_FAMILY="scandia-web", "Scandia", "IBM Plex Sans", Arial, sans-serif
```

The app injects the Adobe Fonts stylesheet at runtime and sets `--font-display` from `VITE_SCANDIA_FONT_FAMILY`. Because these are `VITE_` variables, they are baked into the frontend at build time. After changing them, rebuild or redeploy the site.

### Option B: Self-hosted licensed files

Scandia is also configured in `src/styles.css`, but the actual font files are **not included** in this package. Scandia is a licensed commercial font, so only add it if your license allows web embedding.

Place your licensed files here:

```text
public/fonts/Scandia-Regular.woff2
public/fonts/Scandia-Medium.woff2
public/fonts/Scandia-Bold.woff2
```

The app falls back to IBM Plex Sans if Scandia is not available.

## Herohub logo and favicon

The full Herohub logo is included here:

```text
public/herohub-logo.png
```

The browser favicon is now a square SVG icon so it does not appear squeezed in browser tabs:

```text
public/favicon.svg
```

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

Expected response includes:

```json
{
  "ok": true,
  "version": "1.0.13"
}
```

## Environment variables

Required for real AI generation:

```env
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4.1-mini
```

Optional server-side tuning:

```env
MAX_EXTRACT_TEXT=12000
EXTRACT_TIMEOUT_MS=6500
OPENAI_TIMEOUT_MS=240000
SITE_URL=https://your-site.netlify.app
```

Optional frontend branding/font variables:

```env
VITE_ADOBE_FONTS_URL=https://use.typekit.net/yourkitid.css
VITE_SCANDIA_FONT_FAMILY="scandia-web", "Scandia", "IBM Plex Sans", Arial, sans-serif
```

Any `VITE_` variable change requires a rebuild/redeploy.

Netlify Blobs should auto-configure in production when using Netlify Functions. The app still supports explicit fallback variables if your local setup needs them, but they should not be exposed in frontend code:

```env
NETLIFY_BLOBS_SITE_ID=
NETLIFY_BLOBS_TOKEN=
```


## Fast-install change in v1.0.8

This version removes heavy client/server dependencies from the project install:

- Removed `openai` package; Netlify Functions call the OpenAI Responses API with native `fetch`.
- Removed `lucide-react`; icons are inline SVG components.
- Removed `html2pdf.js`; PDF export now uses the browser print engine. Choose **Save as PDF** in the print dialog.
- Added `.npmrc` plus Netlify npm config flags to disable audit/fund/progress output during install.
- Added `.node-version` set to Node 20.

This should reduce the chance of Netlify appearing to hang at `Installing npm packages`.

## Netlify deploy

Push the project to GitHub and connect it to Netlify.

Build settings:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

Function routes are configured in the function files:

```text
/api/ping
/api/create-audit
/api/get-audit
/api/process-audit-background
```

## PDF export notes

The app uses the browser print engine for PDF export. Before export, the app temporarily applies `body.exporting-pdf`, which:

- reduces oversized heading scale
- switches wide grids into PDF-safe layouts
- removes URL chips from the PDF cover
- avoids clipping and fixed-height behavior
- improves page-break handling
- filters empty bullet items before rendering

If a PDF still looks off, first check whether any new component has fixed height, `overflow: hidden`, or text clamping.

## Troubleshooting

### `/api/ping` shows HTML

Functions are not running. Start the app with:

```bash
npm run dev
```

and make sure Netlify CLI is installed through the package dependencies.

### `create-audit returned HTML instead of JSON`

The frontend reached an HTML page instead of the function JSON response. Usually that means:

- functions are not running locally
- the function route was not deployed
- an older app version is still deployed
- the function timed out

Test `/api/ping`. It should return JSON and show version `1.0.13`.

### Netlify Blobs environment error

Use the modern function runtime included in this package. In production, the Blobs context should be injected by Netlify. If local development still needs manual configuration, set:

```env
NETLIFY_BLOBS_SITE_ID=
NETLIFY_BLOBS_TOKEN=
```

### PDF text is cut off

This version increases the browser print top margin and removes overly aggressive `break-inside: avoid` rules that can contribute to cut-off text. If you customize further, avoid:

- fixed heights on report cards
- `overflow: hidden`
- `line-clamp`
- `text-overflow`
- very wide grids inside report cards
- large unbreakable URLs in print

## Project structure

```text
public/
  herohub-logo.png
  fonts/
    README.md

src/
  main.jsx
  styles.css

netlify/functions/
  create-audit.js
  get-audit.js
  ping.js
  process-audit-background.js
  lib/
    audit-core.js
    storage.js
```


## Fast-install change in v1.0.8

This version removes heavy client/server dependencies from the project install:

- Removed `openai` package; Netlify Functions call the OpenAI Responses API with native `fetch`.
- Removed `lucide-react`; icons are inline SVG components.
- Removed `html2pdf.js`; PDF export now uses the browser print engine. Choose **Save as PDF** in the print dialog.
- Added `.npmrc` plus Netlify npm config flags to disable audit/fund/progress output during install.
- Added `.node-version` set to Node 20.

This should reduce the chance of Netlify appearing to hang at `Installing npm packages`.

## Netlify deploy appears stuck on npm deprecated warnings

The warnings for `node-domexception` or `glob` are npm dependency warnings, not build failures. In v1.0.7, `netlify-cli` was removed from project dependencies to make Netlify production installs lighter. Use `npx netlify dev` locally through `npm run dev`; Netlify production builds do not need the CLI dependency.

### Deploy hangs at `Installing npm packages`

Those lines occur before `npm run build`; Netlify is still installing dependencies. Try **Clear cache and deploy site** in Netlify, confirm the repo contains v1.0.8, and check that `.npmrc`, `.node-version`, `package-lock.json`, and `netlify.toml` are all committed.

If it still sits for more than 10–15 minutes without a new log line, cancel that deploy, clear cache, and redeploy.


## v1.0.10 PDF Flow Fixes

This version removes hard page breaks between major audit sections. Browser-generated PDFs now use natural document flow, which prevents the large blank areas that appeared when a short section was forced onto a new page.

PDF/print changes:
- Removed forced page breaks before Scorecard, Priorities, Page Findings, Pricing, Messaging, Longer-Term Opportunity, and Bottom Line.
- Increased top print margin to reduce tight page starts.
- Allowed long cards to split naturally when needed.
- Kept small cards, score rows, and priority cards together when possible.
- Reduced print-only section spacing for a more professional report flow.


## v1.0.14 PDF pagination refinements

This version improves browser-generated PDF output by:
- increasing print margins,
- reducing section spacing in print,
- removing outer page-finding card borders that could appear clipped across page breaks,
- allowing long sections to flow naturally,
- keeping small cards and bullet items together where practical.

Use the browser print dialog and choose **Save as PDF**.


## v1.0.14 upload fix

PDF fallback uploads are now stored with a separate `/api/upload-file` function before the audit is created. This keeps `/api/create-audit` small and prevents the `Internal Error` / invalid JSON issue caused by sending large base64 PDFs directly in the audit request.

Default upload limit:

```env
MAX_UPLOAD_BYTES=2621440
```

Keep saved page PDFs under about 2.5 MB each, or paste the page text into the fallback fields.
