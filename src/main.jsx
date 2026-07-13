import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const APP_VERSION = '1.0.16';

const ADOBE_FONT_URLS = [
  import.meta.env.VITE_ADOBE_FONTS_URL,
  import.meta.env.VITE_ADOBE_FONTS_CSS_URL,
  import.meta.env.VITE_HH_ADOBE_FONTS_URL
].filter(Boolean).join(',');

const DISPLAY_FONT_FAMILY =
  import.meta.env.VITE_SCANDIA_FONT_FAMILY ||
  import.meta.env.VITE_HH_DISPLAY_FONT_FAMILY ||
  '"Scandia", "scandia-web", "IBM Plex Sans", Arial, sans-serif';


const emptyForm = {
  dealerName: '',
  homepageUrl: '',
  vdpUrl: '',
  serviceUrl: '',
  homepageContent: '',
  vdpContent: '',
  serviceContent: '',
  notes: '',
  homepageFiles: [],
  vdpFiles: [],
  serviceFiles: []
};

function App() {
  const [form, setForm] = React.useState(emptyForm);
  const [audit, setAudit] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const reportRef = React.useRef(null);

  React.useEffect(() => {
    installBrandFonts();
  }, []);

  React.useEffect(() => {
    const pathMatch = window.location.pathname.match(/\/audits\/([^/]+)/);
    if (!pathMatch || audit || job) return;

    fetch(`/api/get-audit?id=${encodeURIComponent(pathMatch[1])}`)
      .then((r) => readJsonResponse(r, 'get-audit'))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || 'Audit not found.');
        if (data.status === 'complete' && data.audit) {
          setAudit(normalizeAudit(data.audit));
        } else {
          setJob({ id: data.id || pathMatch[1], status: data.status || 'queued', message: data.message || 'Audit is generating…' });
        }
      })
      .catch((err) => setError(err.message));
  }, [audit, job]);

  React.useEffect(() => {
    if (!job?.id || audit) return;

    let stopped = false;

    async function poll() {
      try {
        const res = await fetch(`/api/get-audit?id=${encodeURIComponent(job.id)}`);
        const { response, data } = await readJsonResponse(res, 'get-audit');
        if (!response.ok) throw new Error(data.error || 'Could not check audit status.');

        if (data.status === 'complete' && data.audit) {
          if (!stopped) {
            setAudit(normalizeAudit(data.audit));
            setJob(null);
          }
        } else if (data.status === 'failed') {
          if (!stopped) {
            setError(data.error || 'Audit generation failed.');
            setJob(null);
          }
        } else if (!stopped) {
          setJob((current) => current?.id === job.id ? { ...current, status: data.status, message: data.message } : current);
        }
      } catch (err) {
        if (!stopped) setError(err.message || 'Could not check audit status.');
      }
    }

    poll();
    const timer = setInterval(poll, 2500);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job?.id, audit]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const res = await fetch('/api/create-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });

      const { response, data } = await readJsonResponse(res, 'create-audit');
      if (!response.ok && response.status !== 202) throw new Error(data.error || 'Could not create audit.');

      if (data.audit) {
        setAudit(normalizeAudit(data.audit));
      } else {
        setJob({ id: data.id, status: data.status || 'queued', message: data.message || 'Audit queued…' });
        kickWorker(data);
      }

      if (data.id) window.history.pushState({}, '', `/audits/${data.id}`);
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 30);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function kickWorker(data) {
    if (!data?.id || !data?.urls) return;

    fetch('/api/process-audit-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        id: data.id,
        dealerName: data.dealerName || form.dealerName,
        urls: data.urls,
        manualContent: data.manualContent || {
          homepage: form.homepageContent,
          vdp: form.vdpContent,
          service: form.serviceContent,
          notes: form.notes,
          files: {
            homepage: form.homepageFiles,
            vdp: form.vdpFiles,
            service: form.serviceFiles
          }
        },
        createdAt: data.createdAt
      })
    }).catch(() => {});
  }

  async function downloadPdf() {
    if (!reportRef.current || !audit) return;

    setPdfBusy(true);
    document.body.classList.add('exporting-pdf');

    try {
      await new Promise((resolve) => setTimeout(resolve, 180));
      await waitForFonts();

      // Native browser print produces cleaner text rendering and better page breaks
      // than canvas-based PDF libraries. Choose "Save as PDF" in the print dialog.
      window.print();
    } finally {
      setTimeout(() => {
        document.body.classList.remove('exporting-pdf');
        setPdfBusy(false);
      }, 600);
    }
  }

  if (job && !audit) {
    return (
      <main className="app-shell">
        <AppHeader />
        <section className="landing-grid single">
          <div className="form-card generating-card">
            <LoaderIcon className="spin" size={30} />
            <p className="eyebrow">Generating audit</p>
            <h1 className="compact-title">{job.status === 'generating' ? 'Building the report…' : 'Audit queued…'}</h1>
            <p>{job.message || 'The background worker is extracting pages, generating the audit, and saving the result.'}</p>
            <p className="note">This can take 30–90 seconds depending on page extraction and OpenAI response time. Keep this page open; it updates automatically.</p>
            {error && <div className="error">{error}</div>}
          </div>
        </section>
      </main>
    );
  }

  if (audit) {
    return (
      <>
        <div className="topbar no-print">
          <LogoMark small />
          <nav>
            <a href="#summary">Summary</a>
            <a href="#scorecard">Scorecard</a>
            <a href="#priorities">Priorities</a>
            <a href="#pricing">Pricing</a>
            <a href="#messaging">Messaging</a>
          </nav>
          <button onClick={downloadPdf} className="button primary" disabled={pdfBusy}>
            {pdfBusy ? <LoaderIcon className="spin" size={16} /> : <DownloadIcon size={16} />} {pdfBusy ? 'Preparing…' : 'Export PDF'}
          </button>
        </div>
        <Audit audit={audit} refEl={reportRef} />
      </>
    );
  }

  return (
    <main className="app-shell">
      <AppHeader />

      <section className="landing-grid">
        <div className="landing-copy">
          <p className="eyebrow">Digital experience review</p>
          <h1>Generate a branded dealer website audit from three URLs.</h1>
          <p className="lede">
            Enter a homepage, VDP or inventory listing, and service page. The app creates a Herohub-style audit with a
            scorecard, pricing transparency review, page findings, recommended messaging, and polished PDF export.
          </p>
          <div className="feature-grid">
            <Feature title="Homepage" text="Clarity, trust, local relevance and CTAs." />
            <Feature title="VDP" text="Merchandising, pricing, offers and quote path." />
            <Feature title="Service" text="Service proof, scheduling and ownership support." />
          </div>
        </div>

        <form onSubmit={submit} className="form-card">
          <p className="eyebrow">Create audit</p>
          <h2>Enter dealer URLs</h2>
          <Field label="Dealer name, optional" value={form.dealerName} onChange={(v) => setForm({ ...form, dealerName: v })} placeholder="Example: Schaeffer’s Motorsports" />
          <Field required label="Homepage URL" value={form.homepageUrl} onChange={(v) => setForm({ ...form, homepageUrl: v })} placeholder="https://www.dealer.com/" />
          <Field required label="VDP / inventory URL" value={form.vdpUrl} onChange={(v) => setForm({ ...form, vdpUrl: v })} placeholder="https://www.dealer.com/inventory/unit" />
          <Field required label="Service URL" value={form.serviceUrl} onChange={(v) => setForm({ ...form, serviceUrl: v })} placeholder="https://www.dealer.com/service" />

          <details className="fallback-panel">
            <summary>
              Scraping blocked? Paste page content instead
              <span>Optional fallback</span>
            </summary>
            <p>
              Some dealer sites block server-side extraction. When that happens, upload saved page PDFs or paste visible page
              text into these fields. PDF text is extracted before upload and used as audit source material; text files are read and added
              to the fallback content automatically.
            </p>
            <FileUpload
              label="Homepage PDF or text files"
              files={form.homepageFiles}
              onChange={(files) => setForm({ ...form, homepageFiles: files })}
            />
            <TextArea label="Homepage fallback content" value={form.homepageContent} onChange={(v) => setForm({ ...form, homepageContent: v })} placeholder="Paste homepage text, visible section notes, dealer facts, CTAs, brands, address, phone, review snippets…" />
            <FileUpload
              label="VDP / inventory PDF or text files"
              files={form.vdpFiles}
              onChange={(files) => setForm({ ...form, vdpFiles: files })}
            />
            <TextArea label="VDP / inventory fallback content" value={form.vdpContent} onChange={(v) => setForm({ ...form, vdpContent: v })} placeholder="Paste unit title, price, savings, fees, stock number, availability, specs, CTAs, disclaimers…" />
            <FileUpload
              label="Service page PDF or text files"
              files={form.serviceFiles}
              onChange={(files) => setForm({ ...form, serviceFiles: files })}
            />
            <TextArea label="Service page fallback content" value={form.serviceContent} onChange={(v) => setForm({ ...form, serviceContent: v })} placeholder="Paste service copy, service brands, common services, scheduling info, phone numbers, service proof…" />
            <TextArea label="Additional audit notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} placeholder="Optional instructions, dealer context, or anything the scrape might miss." rows={4} />
          </details>

          {error && <div className="error">{error}</div>}
          <button className="button primary wide" disabled={busy}>
            {busy ? <LoaderIcon className="spin" size={18} /> : null}
            {busy ? 'Generating audit…' : 'Generate audit'}
            {!busy ? <ArrowRightIcon size={18} /> : null}
          </button>
        </form>
      </section>
    </main>
  );
}

function Audit({ audit, refEl }) {
  const sourceNotes = cleanList(audit.sourceNotes);
  const date = safeDate(audit.createdAt);

  return (
    <main className="report-shell">
      <article className="report" ref={refEl}>
        <header className="report-cover avoid-break">
          <div className="report-cover-top">
            <LogoMark />
            <div className="prepared-meta">
              <span>Prepared by Herohub</span>
              <span>{date}</span>
            </div>
          </div>

          <p className="eyebrow">{cleanText(audit.subtitle) || 'Digital experience review'}</p>
          <h1 className="report-title">{cleanText(audit.title) || (cleanText(audit.dealerName) ? `${audit.dealerName} Website Audit` : 'Dealer Website Audit')}</h1>
          <h2 className="report-headline">{cleanText(audit.headline)}</h2>
          {cleanText(audit.intro) && <p className="report-intro">{audit.intro}</p>}

          {audit.urls && (
            <div className="url-strip no-print-clone">
              <UrlChip label="Homepage" url={audit.urls.homepage} />
              <UrlChip label="VDP" url={audit.urls.vdp} />
              <UrlChip label="Service" url={audit.urls.service} />
            </div>
          )}

          {/* Source notes are kept in the audit JSON for internal traceability, but hidden from the client-facing report. */}
        </header>

        <Section id="summary" eyebrow="01" title="Overall takeaway">
          <Card>
            <p>{audit.overallTakeaway}</p>
          </Card>

          <div className="two-col">
            <Card tone="accent">
              <p className="eyebrow">Pricing review</p>
              <div className="big-score">{audit.pricingReview?.score ?? '—'}/5</div>
              <h3>{audit.pricingReview?.label}</h3>
            </Card>
            <Card>
              <p>{audit.pricingReview?.summary}</p>
              <TagList items={audit.pricingReview?.questions} />
            </Card>
          </div>

          <Card>
            <p className="eyebrow">Executive summary</p>
            <h3>{audit.executiveSummary?.headline}</h3>
            <p>{audit.executiveSummary?.coreFinding}</p>
          </Card>
        </Section>

        <Section id="scorecard" eyebrow="02" title="Scorecard">
          <div className="score-list">
            <Score label="Homepage clarity" item={audit.scorecard?.homepageClarity} />
            <Score label="Homepage conversion" item={audit.scorecard?.homepageConversion} />
            <Score label="VDP merchandising" item={audit.scorecard?.vdpMerchandising} />
            <Score label="VDP pricing transparency" item={audit.scorecard?.vdpPricingTransparency} />
            <Score label="Service page conversion" item={audit.scorecard?.servicePageConversion} />
            <Score label="Trust" item={audit.scorecard?.trust} />
          </div>
        </Section>

        <Section id="matters" eyebrow="03" title={audit.whatMattersMost?.heading || 'What matters most'}>
          {cleanText(audit.whatMattersMost?.intro) && <p className="section-intro">{audit.whatMattersMost.intro}</p>}
          <div className="stack">
            {(audit.whatMattersMost?.items || []).filter(hasHeadingOrBody).map((item) => (
              <Card key={item.heading || item.body}>
                <h3>{item.heading}</h3>
                <p>{item.body}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="priorities" eyebrow="04" title="Recommended priorities">
          <div className="priority-list">
            {(audit.recommendedPriorities || []).filter(hasHeadingOrBody).map((priority, idx) => (
              <PriorityCard key={`${priority.number || idx}-${priority.heading}`} priority={priority} fallbackNumber={idx + 1} />
            ))}
          </div>
        </Section>

        <Section id="findings" eyebrow="05" title="Page findings">
          <Finding label="Homepage" finding={audit.pageFindings?.homepage} />
          <Finding label="VDP / Inventory" finding={audit.pageFindings?.vdp} />
          <Finding label="Service" finding={audit.pageFindings?.service} />
        </Section>

        <Section id="pricing" eyebrow="06" title="Pricing transparency review">
          <Card>
            <h3>{audit.pricingTransparencyReview?.rating}</h3>
            <p>{audit.pricingTransparencyReview?.body}</p>
            <div className="three-col">
              <Mini title="Main risk drivers" items={audit.pricingTransparencyReview?.mainRiskDrivers} />
              <Mini title="Recommended fix" text={audit.pricingTransparencyReview?.recommendedFix} />
              <Mini title="Suggested disclosure" text={audit.pricingTransparencyReview?.suggestedDisclosure} />
            </div>
            {cleanText(audit.pricingTransparencyReview?.shopperFriendlyVersion) && (
              <div className="callout">
                <strong>More shopper-friendly version</strong>
                <p>{audit.pricingTransparencyReview.shopperFriendlyVersion}</p>
              </div>
            )}
          </Card>
        </Section>

        <Section id="messaging" eyebrow="07" title="Recommended messaging">
          <Message label="Homepage direction" block={audit.recommendedMessaging?.homepageDirection} />
          <Message label="VDP direction" block={audit.recommendedMessaging?.vdpDirection} />
          <Message label="Service direction" block={audit.recommendedMessaging?.serviceDirection} />
        </Section>

        <Section id="opportunity" eyebrow="08" title="Longer-term opportunity">
          <Card>
            <h3>{audit.longerTermOpportunity?.heading}</h3>
            <p>{audit.longerTermOpportunity?.body}</p>
            <BulletList items={audit.longerTermOpportunity?.recommendations} />
          </Card>
        </Section>

        <Section id="bottom" eyebrow="09" title="Bottom line">
          <Card tone="lime">
            <p>{audit.bottomLine?.body}</p>
            <BulletList ordered items={audit.bottomLine?.fixes} />
            {cleanText(audit.disclaimer) && <p className="disclaimer">{audit.disclaimer}</p>}
          </Card>
        </Section>
      </article>
    </main>
  );
}

function AppHeader() {
  return (
    <header className="app-header">
      <LogoMark small />
      <div className="app-version">v{APP_VERSION}</div>
    </header>
  );
}

function LogoMark({ small = false }) {
  return (
    <a href="/" className={small ? 'logo-wrap small' : 'logo-wrap'} aria-label="Herohub home">
      <img src="/herohub-logo.png" alt="Herohub" />
      {small && <span>Dealer Website Audit Generator</span>}
    </a>
  );
}

function UrlChip({ label, url }) {
  if (!url) return null;
  return (
    <a className="url-chip" href={url} target="_blank" rel="noreferrer">
      <strong>{label}</strong>
      <span>{shortUrl(url)}</span>
      <ExternalLinkIcon size={12} />
    </a>
  );
}

function Feature({ title, text }) {
  return (
    <div className="feature">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}


function FileUpload({ label, files = [], onChange }) {
  const [localError, setLocalError] = React.useState('');

  async function handleFiles(event) {
    const selected = Array.from(event.target.files || []);
    setLocalError('');

    try {
      const prepared = await readAuditFiles(selected);
      onChange(prepared);
    } catch (err) {
      setLocalError(err.message || 'Could not read uploaded files.');
      onChange([]);
    }
  }

  return (
    <label className="field file-field">
      <span>{label}</span>
      <input
        type="file"
        accept=".pdf,.txt,.text,.md,.html,.htm,application/pdf,text/plain,text/markdown,text/html"
        multiple
        onChange={handleFiles}
      />
      <small className="file-hint">Upload saved page PDFs or text/HTML files. PDF text is extracted first, then the file reference is stored so the audit request stays small. Keep each file under 2.5 MB.</small>
      {localError && <small className="file-error">{localError}</small>}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>
              {file.name} <span>{formatBytes(file.size)}{file.blobKey ? ' · uploaded' : ''}{file.textChars ? ` · ${file.textChars.toLocaleString()} text chars` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

async function readAuditFiles(files) {
  const maxFiles = 5;
  const maxBytes = 2.5 * 1024 * 1024;
  const selected = files.slice(0, maxFiles);

  const prepared = [];
  for (const file of selected) {
    if (file.size > maxBytes) {
      throw new Error(`${file.name} is too large. Keep each uploaded file under 2.5 MB, or paste the page text into the fallback box.`);
    }

    const type = file.type || inferMimeType(file.name);
    if (type === 'application/pdf') {
      const [dataUrl, extractedText] = await Promise.all([
        readAsDataUrl(file),
        extractPdfTextInBrowser(file).catch(() => '')
      ]);

      const uploaded = await uploadAuditFile({
        name: file.name,
        mimeType: 'application/pdf',
        size: file.size,
        dataUrl,
        text: extractedText
      });

      prepared.push({
        name: uploaded.name || file.name,
        mimeType: 'application/pdf',
        size: uploaded.size || file.size,
        blobKey: uploaded.blobKey,
        textChars: uploaded.textChars || extractedText.length || 0
      });
    } else {
      const text = (await file.text()).slice(0, 24000);
      prepared.push({
        name: file.name,
        mimeType: type,
        size: file.size,
        text
      });
    }
  }

  return prepared;
}

async function uploadAuditFile(filePayload) {
  const res = await fetch('/api/upload-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filePayload)
  });

  const { response, data } = await readJsonResponse(res, 'upload-file');
  if (!response.ok) {
    throw new Error(data.error || `Could not upload ${filePayload.name}.`);
  }

  if (!data.blobKey) {
    throw new Error(`Upload completed, but no file reference was returned for ${filePayload.name}.`);
  }

  return data;
}


async function extractPdfTextInBrowser(file) {
  // Client-side PDF text extraction is the most reliable fallback for blocked dealer sites.
  // It avoids relying on the model to read attached PDFs and keeps the audit grounded in text.
  try {
    const pdfjs = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';

    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    const maxPages = Math.min(pdf.numPages || 0, 12);

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = [];
      let lastY = null;
      let line = [];

      for (const item of content.items || []) {
        const text = String(item.str || '').trim();
        if (!text) continue;
        const y = Math.round(item.transform?.[5] || 0);
        if (lastY !== null && Math.abs(y - lastY) > 5 && line.length) {
          lines.push(line.join(' ').replace(/\s+/g, ' ').trim());
          line = [];
        }
        line.push(text);
        lastY = y;
      }

      if (line.length) lines.push(line.join(' ').replace(/\s+/g, ' ').trim());
      if (lines.length) pages.push(`PDF PAGE ${pageNumber}\n${lines.join('\n')}`);
    }

    return pages.join('\n\n').slice(0, 24000);
  } catch {
    return '';
  }
}

function inferMimeType(name = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function Field({ label, value, onChange, placeholder, required }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input required={required} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 5 }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Section({ id, eyebrow, title, children, pageBreak }) {
  if (!children) return null;
  return (
    <section id={id} className={pageBreak ? 'audit-section print-page-break' : 'audit-section'}>
      <div className="section-heading">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Card({ children, tone = '' }) {
  return <div className={`audit-card avoid-break ${tone ? `tone-${tone}` : ''}`}>{children}</div>;
}

function Score({ label, item }) {
  if (!item) return null;
  return (
    <div className="score-row avoid-break">
      <h3>{label}</h3>
      <div className="score-pill">{item.score ?? '—'}/5</div>
      <p>{item.summary}</p>
    </div>
  );
}

function PriorityCard({ priority, fallbackNumber }) {
  const number = cleanText(priority.number) || String(fallbackNumber).padStart(2, '0');
  return (
    <div className="priority-card avoid-break">
      <div className="priority-number">{number}</div>
      <div>
        <h3>{priority.heading}</h3>
        <p>{priority.body}</p>
      </div>
    </div>
  );
}

function Finding({ label, finding }) {
  if (!finding) return null;

  return (
    <Card>
      <p className="pill">{label}</p>
      <h3>{finding.heading}</h3>
      <p>{finding.current}</p>
      <div className="three-col">
        <Mini title="What is working" items={finding.working} />
        <Mini title="What is weak" items={finding.weak} />
        <Mini title="Recommended changes" items={finding.recommendations} />
      </div>
    </Card>
  );
}

function Mini({ title, items, text }) {
  const cleaned = cleanList(items);
  const cleanTextValue = cleanText(text);

  if (!cleaned.length && !cleanTextValue) return null;

  return (
    <div className="mini avoid-break">
      <h4>{title}</h4>
      {cleaned.length ? <BulletList items={cleaned} /> : <p>{cleanTextValue}</p>}
    </div>
  );
}

function Message({ label, block }) {
  if (!block) return null;
  const ctas = cleanList(block.ctas);

  return (
    <div className="message-card avoid-break">
      <p className="pill">{label}</p>
      <h3>{block.heading}</h3>
      <p>{block.body}</p>
      <TagList items={ctas} />
    </div>
  );
}

function BulletList({ items, ordered = false }) {
  const cleaned = cleanList(items);
  if (!cleaned.length) return null;

  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className="audit-list">
      {cleaned.map((item) => <li key={item}>{item}</li>)}
    </Tag>
  );
}

function TagList({ items }) {
  const cleaned = cleanList(items);
  if (!cleaned.length) return null;

  return (
    <div className="tag-list">
      {cleaned.map((item) => <span key={item}>{item}</span>)}
    </div>
  );
}

async function readJsonResponse(response, endpointName) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';

  try {
    const data = text ? JSON.parse(text) : {};
    return { response, data };
  } catch {
    const preview = text.trim().slice(0, 180).replace(/\s+/g, ' ');
    const looksLikeHtml = preview.startsWith('<') || contentType.includes('text/html');

    if (looksLikeHtml) {
      const timeoutHint = response.status === 504
        ? ' This is a timeout. Make sure the deployed version uses the background worker for audit generation.'
        : '';

      throw new Error(
        `${endpointName} returned HTML instead of JSON. Netlify Functions may not be running, the route may not be deployed, or the function timed out.${timeoutHint} ` +
        `Run with "npm run dev" through Netlify Dev, not "npm run dev:vite". ` +
        `Also test /api/ping in the browser; it should return JSON. Status ${response.status}.`
      );
    }

    const uploadHint = response.status >= 500
      ? ' If this happened after adding PDFs, one or more uploads may still be too large or the deployed functions may be from an older version. Try uploading smaller PDFs or check /api/ping.'
      : '';
    throw new Error(`${endpointName} returned invalid JSON. Status ${response.status}. Response preview: ${preview}.${uploadHint}`);
  }
}

function normalizeAudit(audit) {
  const safe = audit || {};
  return {
    ...safe,
    sourceNotes: cleanList(safe.sourceNotes),
    pricingReview: {
      score: safe.pricingReview?.score ?? 0,
      label: safe.pricingReview?.label || '',
      summary: safe.pricingReview?.summary || '',
      questions: cleanList(safe.pricingReview?.questions)
    }
  };
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanList(items) {
  return (items || [])
    .map((item) => cleanText(item))
    .filter(Boolean)
    .filter((item) => item !== '-' && item !== '•');
}

function hasHeadingOrBody(item) {
  return cleanText(item?.heading) || cleanText(item?.body);
}

function safeDate(dateString) {
  const parsed = dateString ? new Date(dateString) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toLocaleDateString();
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function slug(input) {
  return cleanText(input).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'audit';
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname}${path ? path.slice(0, 34) : ''}${path.length > 34 ? '…' : ''}`;
  } catch {
    return url;
  }
}


function installBrandFonts() {
  if (typeof document === 'undefined') return;

  if (DISPLAY_FONT_FAMILY) {
    document.documentElement.style.setProperty('--font-display', DISPLAY_FONT_FAMILY);
  }

  const urls = String(ADOBE_FONT_URLS || '')
    .split(/[\n,]+/)
    .map((url) => url.trim())
    .filter(Boolean)
    .filter((url, index, arr) => arr.indexOf(url) === index)
    .filter((url) => /^https:\/\/use\.typekit\.net\/[a-z0-9_-]+\.css(\?.*)?$/i.test(url) || /^https?:\/\//i.test(url));

  urls.forEach((url) => {
    const existing = document.querySelector(`link[data-herohub-font-url="${CSS.escape(url)}"]`);
    if (existing) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.setAttribute('data-herohub-font-url', url);
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  });
}

async function waitForFonts() {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;

  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 2500))
    ]);
  } catch {
    // Font loading should not block PDF generation.
  }
}


function SvgIcon({ size = 18, className = '', children }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function DownloadIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </SvgIcon>
  );
}

function LoaderIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </SvgIcon>
  );
}

function ArrowRightIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M5 12h14" />
      <path d="M13 5l7 7-7 7" />
    </SvgIcon>
  );
}

function AlertIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </SvgIcon>
  );
}

function ExternalLinkIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </SvgIcon>
  );
}

createRoot(document.getElementById('root')).render(<App />);
