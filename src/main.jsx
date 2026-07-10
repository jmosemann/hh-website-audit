import React from 'react';
import { createRoot } from 'react-dom/client';
import { Download, Loader2, ArrowRight, AlertTriangle } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import './styles.css';

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
    const pathMatch = window.location.pathname.match(/\/audits\/([^/]+)/);
    if (!pathMatch || audit || job) return;
    fetch(`/api/get-audit?id=${encodeURIComponent(pathMatch[1])}`)
      .then((r) => readJsonResponse(r, 'get-audit'))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || 'Audit not found.');
        if (data.status === 'complete' && data.audit) {
          setAudit(data.audit);
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
            setAudit(data.audit);
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
        setAudit(data.audit);
      } else {
        setJob({ id: data.id, status: data.status || 'queued', message: data.message || 'Audit queued…' });
        kickWorker(data);
      }

      window.history.pushState({}, '', `/audits/${data.id}`);
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
    if (!reportRef.current) return;
    setPdfBusy(true);
    try {
      const filename = `${slug(audit.dealerName || 'dealer')}-website-audit.pdf`;
      await html2pdf()
        .set({
          filename,
          margin: [0.25, 0.25, 0.35, 0.25],
          image: { type: 'jpeg', quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['.card', '.avoid-break'] }
        })
        .from(reportRef.current)
        .save();
    } finally {
      setPdfBusy(false);
    }
  }

  if (job && !audit) {
    return (
      <main className="home">
        <header className="home-head">
          <div className="brand"><a className="mark" href="/">HH</a><span>Dealer Website Audit Generator</span></div>
        </header>
        <section className="hero">
          <div className="form-card generating-card">
            <Loader2 className="spin" size={28} />
            <p className="eyebrow">Generating audit</p>
            <h2>{job.status === 'generating' ? 'Building the report…' : 'Audit queued…'}</h2>
            <p>{job.message || 'The background worker is extracting pages, generating the audit, and saving the result.'}</p>
            <p className="note">This can take 30–90 seconds depending on page extraction and OpenAI response time. You can keep this page open; it will update automatically.</p>
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
          <div className="brand"><a className="mark" href="/">HH</a><span>Dealer Website Audit Generator</span></div>
          <nav>
            <a href="#summary">Summary</a>
            <a href="#scorecard">Scorecard</a>
            <a href="#priorities">Priorities</a>
            <a href="#pricing">Pricing Review</a>
            <a href="#messaging">Messaging</a>
          </nav>
          <button onClick={downloadPdf} className="button dark" disabled={pdfBusy}>
            {pdfBusy ? <Loader2 className="spin" size={16} /> : <Download size={16} />} Download PDF
          </button>
        </div>
        <Audit audit={audit} refEl={reportRef} />
      </>
    );
  }

  return (
    <main className="home">
      <header className="home-head">
        <div className="brand"><div className="mark">HH</div><span>Dealer Website Audit Generator</span></div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Digital experience review</p>
          <h1>Generate a dealership website audit from three URLs.</h1>
          <p className="lede">
            Enter a homepage, VDP or inventory listing, and service page. The app creates a Herohub-style audit with
            scorecard, pricing transparency review, page findings, recommended messaging, and PDF export.
          </p>
          <div className="feature-grid">
            <div className="feature"><strong>Homepage</strong><span>Clarity, trust, local relevance and CTAs.</span></div>
            <div className="feature"><strong>VDP</strong><span>Merchandising, pricing, offers and quote path.</span></div>
            <div className="feature"><strong>Service</strong><span>Service proof, scheduling and ownership support.</span></div>
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
          <button className="button dark wide" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : null}
            {busy ? 'Generating audit…' : 'Generate audit'}
            {!busy ? <ArrowRight size={18} /> : null}
          </button>
          <p className="note">
            Add <code>OPENAI_API_KEY</code> in Netlify. Without it, the app returns a sample audit so the UI/PDF flow can be tested.
          </p>
        </form>
      </section>
    </main>
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
        ? ' This is a timeout. Make sure you deployed v1.0.2 or newer, which uses a background worker for audit generation.'
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

function Field({ label, value, onChange, placeholder, required }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input required={required} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Audit({ audit, refEl }) {
  return (
    <main className="report" ref={refEl}>
      <header className="report-hero">
        <div className="report-meta">
          <div className="brand"><div className="mark">HH</div><span>{audit.dealerName} Website Audit</span></div>
          <span>{new Date(audit.createdAt).toLocaleDateString()}</span>
        </div>
        <p className="eyebrow">{audit.subtitle || 'Digital experience review'}</p>
        <h1>{audit.headline}</h1>
        <p className="lede">{audit.intro}</p>
        {audit.sourceNotes?.length ? (
          <div className="source-note avoid-break">
            <AlertTriangle size={18} />
            <div><strong>Source notes</strong>{audit.sourceNotes.map((n) => <p key={n}>{n}</p>)}</div>
          </div>
        ) : null}
      </header>

      <Section id="summary" title="Overall takeaway">
        <Card><p>{audit.overallTakeaway}</p></Card>
        <div className="two-col">
          <Card>
            <p className="eyebrow">Pricing review</p>
            <div className="big-score">{audit.pricingReview.score}/5</div>
            <h3>{audit.pricingReview.label}</h3>
          </Card>
          <Card>
            <p>{audit.pricingReview.summary}</p>
            <div className="question-list">
              {audit.pricingReview.questions?.map((q) => <span key={q}>{q}</span>)}
            </div>
          </Card>
        </div>
        <Card><h3>{audit.executiveSummary.headline}</h3><p>{audit.executiveSummary.coreFinding}</p></Card>
      </Section>

      <Section id="scorecard" title="Scorecard" pageBreak>
        <div className="score-grid">
          {[
            ['Homepage clarity', audit.scorecard.homepageClarity],
            ['Homepage conversion', audit.scorecard.homepageConversion],
            ['VDP merchandising', audit.scorecard.vdpMerchandising],
            ['VDP pricing transparency', audit.scorecard.vdpPricingTransparency],
            ['Service page conversion', audit.scorecard.servicePageConversion],
            ['Trust', audit.scorecard.trust]
          ].map(([label, item]) => <Score key={label} label={label} item={item} />)}
        </div>
      </Section>

      <Section id="matters" title={audit.whatMattersMost.heading}>
        <p className="section-intro">{audit.whatMattersMost.intro}</p>
        {audit.whatMattersMost.items.map((item) => <Card key={item.heading}><h3>{item.heading}</h3><p>{item.body}</p></Card>)}
      </Section>

      <Section id="priorities" title="Recommended priorities" pageBreak>
        {audit.recommendedPriorities.map((p) => (
          <Card key={p.number}>
            <div className="priority"><span>{p.number}</span><div><h3>{p.heading}</h3><p>{p.body}</p></div></div>
          </Card>
        ))}
      </Section>

      <Section id="findings" title="Page findings" pageBreak>
        <Finding label="Homepage" finding={audit.pageFindings.homepage} />
        <Finding label="VDP / Inventory" finding={audit.pageFindings.vdp} />
        <Finding label="Service" finding={audit.pageFindings.service} />
      </Section>

      <Section id="pricing" title="Pricing transparency review" pageBreak>
        <Card>
          <h3>{audit.pricingTransparencyReview.rating}</h3>
          <p>{audit.pricingTransparencyReview.body}</p>
          <div className="three-col">
            <Mini title="Main risk drivers" items={audit.pricingTransparencyReview.mainRiskDrivers} />
            <Mini title="Recommended fix" text={audit.pricingTransparencyReview.recommendedFix} />
            <Mini title="Suggested disclosure" text={audit.pricingTransparencyReview.suggestedDisclosure} />
          </div>
          <div className="callout"><strong>More shopper-friendly version</strong><p>{audit.pricingTransparencyReview.shopperFriendlyVersion}</p></div>
        </Card>
      </Section>

      <Section id="messaging" title="Recommended messaging" pageBreak>
        <Message label="Homepage direction" block={audit.recommendedMessaging.homepageDirection} />
        <Message label="VDP direction" block={audit.recommendedMessaging.vdpDirection} />
        <Message label="Service direction" block={audit.recommendedMessaging.serviceDirection} />
      </Section>

      <Section id="opportunity" title="Longer-term opportunity" pageBreak>
        <Card>
          <h3>{audit.longerTermOpportunity.heading}</h3>
          <p>{audit.longerTermOpportunity.body}</p>
          <ul>{audit.longerTermOpportunity.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
      </Section>

      <Section id="bottom" title="Bottom line" pageBreak>
        <Card>
          <p>{audit.bottomLine.body}</p>
          <ol>{audit.bottomLine.fixes.map((f) => <li key={f}>{f}</li>)}</ol>
          <p className="disclaimer">{audit.disclaimer}</p>
        </Card>
      </Section>
    </main>
  );
}

function Section({ id, title, children, pageBreak }) {
  return <section id={id} className={pageBreak ? 'section page-break' : 'section'}><h2>{title}</h2>{children}</section>;
}

function Card({ children }) {
  return <div className="card avoid-break">{children}</div>;
}

function Score({ label, item }) {
  return <Card><div className="score-top"><h3>{label}</h3><span>{item.score}/5</span></div><p>{item.summary}</p></Card>;
}

function Finding({ label, finding }) {
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
  return <div className="mini"><h4>{title}</h4>{items ? <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul> : <p>{text}</p>}</div>;
}

function Message({ label, block }) {
  return (
    <Card>
      <p className="pill">{label}</p>
      <h3>{block.heading}</h3>
      <p>{block.body}</p>
      <div className="cta-list">{block.ctas.map((c) => <span key={c}>{c}</span>)}</div>
    </Card>
  );
}

function slug(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'audit';
}

createRoot(document.getElementById('root')).render(<App />);
