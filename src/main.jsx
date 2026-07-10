import React from 'react';
import { createRoot } from 'react-dom/client';
import { Download, Loader2, ArrowRight, AlertTriangle, ExternalLink } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import './styles.css';

const APP_VERSION = '1.0.6';

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
  serviceUrl: ''
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
        createdAt: data.createdAt
      })
    }).catch(() => {});
  }

  async function downloadPdf() {
    if (!reportRef.current || !audit) return;

    setPdfBusy(true);
    document.body.classList.add('exporting-pdf');

    try {
      const filename = `${slug(audit.dealerName || audit.title || 'dealer')}-website-audit.pdf`;

      await new Promise((resolve) => setTimeout(resolve, 180));
      await waitForFonts();

      await html2pdf()
        .set({
          filename,
          margin: [0.32, 0.35, 0.38, 0.35],
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            letterRendering: true,
            scrollY: 0,
            backgroundColor: '#ffffff'
          },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait', compress: true },
          pagebreak: {
            mode: ['css', 'legacy'],
            before: ['.print-page-break'],
            avoid: ['.avoid-break', '.audit-card', '.score-row', '.priority-card', '.message-card']
          }
        })
        .from(reportRef.current)
        .save();
    } finally {
      document.body.classList.remove('exporting-pdf');
      setPdfBusy(false);
    }
  }

  if (job && !audit) {
    return (
      <main className="app-shell">
        <AppHeader />
        <section className="landing-grid single">
          <div className="form-card generating-card">
            <Loader2 className="spin" size={30} />
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
            {pdfBusy ? <Loader2 className="spin" size={16} /> : <Download size={16} />} {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
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
          {error && <div className="error">{error}</div>}
          <button className="button primary wide" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : null}
            {busy ? 'Generating audit…' : 'Generate audit'}
            {!busy ? <ArrowRight size={18} /> : null}
          </button>
          <p className="note">
            Version {APP_VERSION}. Add <code>OPENAI_API_KEY</code> in Netlify. Without it, the app returns a sample audit so the UI/PDF flow can be tested.
          </p>
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

          {sourceNotes.length > 0 && (
            <div className="source-note avoid-break">
              <AlertTriangle size={18} />
              <div>
                <strong>Source notes</strong>
                {sourceNotes.map((note) => <p key={note}>{note}</p>)}
              </div>
            </div>
          )}
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

        <Section id="scorecard" eyebrow="02" title="Scorecard" pageBreak>
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

        <Section id="priorities" eyebrow="04" title="Recommended priorities" pageBreak>
          <div className="priority-list">
            {(audit.recommendedPriorities || []).filter(hasHeadingOrBody).map((priority, idx) => (
              <PriorityCard key={`${priority.number || idx}-${priority.heading}`} priority={priority} fallbackNumber={idx + 1} />
            ))}
          </div>
        </Section>

        <Section id="findings" eyebrow="05" title="Page findings" pageBreak>
          <Finding label="Homepage" finding={audit.pageFindings?.homepage} />
          <Finding label="VDP / Inventory" finding={audit.pageFindings?.vdp} />
          <Finding label="Service" finding={audit.pageFindings?.service} />
        </Section>

        <Section id="pricing" eyebrow="06" title="Pricing transparency review" pageBreak>
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

        <Section id="messaging" eyebrow="07" title="Recommended messaging" pageBreak>
          <Message label="Homepage direction" block={audit.recommendedMessaging?.homepageDirection} />
          <Message label="VDP direction" block={audit.recommendedMessaging?.vdpDirection} />
          <Message label="Service direction" block={audit.recommendedMessaging?.serviceDirection} />
        </Section>

        <Section id="opportunity" eyebrow="08" title="Longer-term opportunity" pageBreak>
          <Card>
            <h3>{audit.longerTermOpportunity?.heading}</h3>
            <p>{audit.longerTermOpportunity?.body}</p>
            <BulletList items={audit.longerTermOpportunity?.recommendations} />
          </Card>
        </Section>

        <Section id="bottom" eyebrow="09" title="Bottom line" pageBreak>
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
      <ExternalLink size={12} />
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

function Field({ label, value, onChange, placeholder, required }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input required={required} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
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

    throw new Error(`${endpointName} returned invalid JSON. Status ${response.status}. Response preview: ${preview}`);
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


createRoot(document.getElementById('root')).render(<App />);
