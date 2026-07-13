import { getUploadStore } from './storage.js';
import { extractPdfTextFromDataUrl } from './pdf-text.js';
const MAX_TEXT = Number(process.env.MAX_EXTRACT_TEXT || 12000);
const FETCH_TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS || 6500);

export async function runAuditJob({ dealerName, urls, manualContent = {}, createdAt }) {
  const sources = await extractAll(urls, manualContent);
  let audit;

  if (process.env.OPENAI_API_KEY) {
    try {
      audit = await generateAudit({ dealerName, urls, sources, createdAt });
    } catch (err) {
      audit = sampleAudit({ dealerName, urls, sources, createdAt });
      audit.sourceNotes = [
        `OpenAI generation failed, so a fallback audit was returned: ${err?.message || 'unknown error'}.`,
        ...(audit.sourceNotes || [])
      ];
    }
  } else {
    audit = sampleAudit({ dealerName, urls, sources, createdAt });
  }

  audit.urls = urls;
  audit.createdAt = createdAt;
  return { audit, sources };
}

export async function extractAll(urls, manualContent = {}) {
  const files = manualContent.files || {};
  const [homepage, vdp, service] = await Promise.all([
    extract(urls.homepage, manualContent.homepage, files.homepage),
    extract(urls.vdp, manualContent.vdp, files.vdp),
    extract(urls.service, manualContent.service, files.service)
  ]);

  const notes = cleanManual(manualContent.notes);
  if (notes) {
    homepage.manualNotes = notes;
    vdp.manualNotes = notes;
    service.manualNotes = notes;
  }

  return { homepage, vdp, service };
}

async function generateAudit({ dealerName, urls, sources, createdAt }) {
  const prompt = buildPrompt({ dealerName, urls, sources, createdAt });
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 240000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let data;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        input: [
          { role: 'system', content: 'You are Dealer Website Optimizer. Return only valid JSON matching the supplied schema. Do not invent facts.' },
          { role: 'user', content: buildOpenAIUserContent(prompt, sources) }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'dealer_audit',
            strict: true,
            schema: auditSchema
          }
        }
      })
    });

    data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || `OpenAI request failed with status ${response.status}`;
      throw new Error(message);
    }
  } finally {
    clearTimeout(timer);
  }

  const outputText = extractOpenAIText(data);
  if (!outputText) {
    throw new Error('OpenAI response did not include JSON text.');
  }

  return JSON.parse(outputText);
}

function extractOpenAIText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;

  const contentText = (data?.output || [])
    .flatMap((item) => item?.content || [])
    .map((part) => part?.text || part?.content || '')
    .filter(Boolean)
    .join('\n')
    .trim();

  if (contentText) return contentText;

  const choiceText = data?.choices?.[0]?.message?.content;
  return typeof choiceText === 'string' ? choiceText : '';
}

function buildPrompt({ dealerName, urls, sources, createdAt }) {
  return `
You are Dealer Website Optimizer, an AI-assisted website audit specialist for powersports, marine, golf car, and equipment dealerships.

Create a Herohub-style digital experience review using ONLY the supplied page content.
If USER-PROVIDED FALLBACK CONTENT or uploaded PDFs are present, treat their extracted text as valid source material provided by the user and prefer it over weak scraped text for that page.
If scraping is incomplete or blocked and no fallback content or extracted uploaded PDF text is supplied, note the limitation in sourceNotes, but do not mention sourceNotes in body copy.
Keep sourceNotes brief and factual. They are for internal traceability only and will not be shown in the client-facing report.
Do not make the audit headline or overall takeaway about blocked access when fallback text or extracted PDF text exists for the pages. Instead, audit the provided material directly and only mention access limits in sourceNotes.

Audit perspective:
- homepage clarity and conversion
- VDP/inventory merchandising
- pricing transparency
- service selling strength
- trust builders
- dealership differentiation
- local relevance
- practical next-step CTAs

Style:
- Direct, specific, dealer-ready.
- Avoid generic filler.
- Use dealership-specific facts from the supplied page text.
- Dealer-specific headline.
- Most scores should be 2–4 unless the page is truly exceptional.
- End with this exact disclaimer: This is a website pricing transparency and conversion-readiness review, not legal advice.

Preferred dealer name: ${dealerName || 'infer from content'}
Created at: ${createdAt}

URLs:
Homepage: ${urls.homepage}
VDP: ${urls.vdp}
Service: ${urls.service}

Homepage extraction:
${pageText(sources.homepage)}

VDP / inventory extraction:
${pageText(sources.vdp)}

Service extraction:
${pageText(sources.service)}
`.trim();
}

function pageText(p) {
  return `
URL: ${p.url}
HTTP status: ${p.status ?? 'unknown'}
Extraction ok: ${p.ok ? 'yes' : 'no'}
Title: ${p.title || 'not found'}
Meta description: ${p.metaDescription || 'not found'}
Error/limitation: ${p.error || 'none'}
Source mode: ${p.sourceMode || 'scraped'}
Manual notes: ${p.manualNotes || 'none'}
Uploaded files: ${fileSummary(p.uploadedFiles)}
Visible text:
${p.text || '[No usable text extracted]'}
`;
}


function buildOpenAIUserContent(prompt, sources) {
  const files = openAIFileInputs(sources);
  if (!files.length) return prompt;

  return [
    { type: 'input_text', text: `${prompt}\n\nUploaded PDFs are attached to this message. Use them as source material for the matching page. Do not quote source notes in the client-facing audit.` },
    ...files
  ];
}

function openAIFileInputs(sources) {
  const pages = [
    ['Homepage', sources.homepage],
    ['VDP / inventory', sources.vdp],
    ['Service', sources.service]
  ];

  return pages.flatMap(([pageLabel, source]) => (source?.uploadedFiles || [])
    .filter((file) => file?.dataUrl && file?.mimeType === 'application/pdf')
    .slice(0, Number(process.env.MAX_OPENAI_PDF_FILES_PER_PAGE || 3))
    .map((file) => ({
      type: 'input_file',
      filename: `${pageLabel} - ${file.name}`.slice(0, 220),
      file_data: file.dataUrl
    })));
}

function fileSummary(files = []) {
  if (!Array.isArray(files) || !files.length) return 'none';
  return files
    .map((file) => `${file.name || 'uploaded file'} (${file.mimeType || 'unknown'}, ${file.size || 0} bytes${file.dataUrl ? ', attached PDF' : ''}${file.text ? `, ${String(file.text).length} text chars extracted` : ''})`)
    .join('; ');
}

async function resolveUploadedFiles(files = []) {
  const selected = (Array.isArray(files) ? files : [])
    .slice(0, Number(process.env.MAX_UPLOAD_FILES || 5));

  const store = getUploadStore();
  const resolved = [];

  for (const file of selected) {
    if (file?.blobKey) {
      try {
        const record = await store.get(file.blobKey, { type: 'json' });
        if (record) {
          resolved.push({
            name: record.name || file.name || 'uploaded-file',
            mimeType: record.mimeType || file.mimeType || 'application/octet-stream',
            size: Number(record.size || file.size || 0),
            text: typeof record.text === 'string' && record.text ? record.text : extractPdfTextFromDataUrl(record.dataUrl || '', MAX_TEXT),
            dataUrl: typeof record.dataUrl === 'string' ? record.dataUrl : '',
            blobKey: file.blobKey
          });
          continue;
        }
      } catch {
        // Fall back to any inline content below.
      }
    }

    resolved.push(file);
  }

  return normalizeUploadedFiles(resolved);
}

function normalizeUploadedFiles(files = []) {
  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 2.5 * 1024 * 1024);
  return (Array.isArray(files) ? files : [])
    .slice(0, Number(process.env.MAX_UPLOAD_FILES || 5))
    .map((file) => ({
      name: clean(String(file?.name || 'uploaded-file')).slice(0, 180),
      mimeType: clean(String(file?.mimeType || 'application/octet-stream')).slice(0, 80),
      size: Number(file?.size || 0),
      text: typeof file?.text === 'string' && file.text
        ? clean(file.text).slice(0, MAX_TEXT)
        : extractPdfTextFromDataUrl(file?.dataUrl || '', MAX_TEXT),
      dataUrl: typeof file?.dataUrl === 'string' && file.dataUrl.startsWith('data:application/pdf;base64,') && Number(file?.size || 0) <= maxBytes ? file.dataUrl : '',
      blobKey: typeof file?.blobKey === 'string' ? file.blobKey : ''
    }))
    .filter((file) => file.text || file.dataUrl || file.blobKey);
}

async function extract(url, manualText = '', manualFiles = []) {
  const uploadedFiles = await resolveUploadedFiles(manualFiles);
  const fileText = uploadedFiles.filter((file) => file.text).map((file) => `UPLOADED FILE: ${file.name}\n${file.text}`).join('\n\n');
  const fallbackText = cleanManual([manualText, fileText].filter(Boolean).join('\n\n'));
  let scraped = { url, title: '', metaDescription: '', status: null, ok: false, text: '', error: '' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DealerAuditBot/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      scraped = { url, title: '', metaDescription: '', status: res.status, ok: false, text: '', error: `Expected HTML but received ${contentType || 'unknown content type'}.` };
    } else {
      const html = await res.text();
      const title = clean(match(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
      const metaDescription = clean(
        match(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
        match(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)
      );
      const text = htmlToText(html).slice(0, MAX_TEXT);
      scraped = { url, title, metaDescription, status: res.status, ok: res.ok && text.length > 250, text, error: res.ok ? undefined : `HTTP ${res.status}` };
    }
  } catch (err) {
    scraped = { url, title: '', metaDescription: '', status: null, ok: false, text: '', error: err?.message || 'Extraction failed.' };
  }

  if (!fallbackText && uploadedFiles.length === 0) return scraped;
  if (!fallbackText && uploadedFiles.length > 0) {
    return {
      ...scraped,
      ok: true,
      uploadedFiles,
      sourceMode: scraped.ok ? 'uploaded PDF + scraped' : 'uploaded PDF',
      error: scraped.ok
        ? 'Uploaded PDF source file was supplied and combined with scraped text.'
        : `Scraping may be incomplete or blocked; using uploaded PDF source file. ${scraped.error || ''}`.trim()
    };
  }

  const combined = [
    'USER-PROVIDED FALLBACK CONTENT:',
    fallbackText,
    scraped.text ? '\nSCRAPED PAGE TEXT, IF AVAILABLE:' : '',
    scraped.text || ''
  ].filter(Boolean).join('\n\n').slice(0, MAX_TEXT);

  return {
    ...scraped,
    ok: true,
    text: combined,
    uploadedFiles,
    sourceMode: scraped.ok ? 'user fallback/uploaded files + scraped' : 'user fallback/uploaded files',
    error: scraped.ok
      ? 'User-provided fallback content was supplied and combined with scraped text.'
      : `Scraping may be incomplete or blocked; using user-provided fallback content. ${scraped.error || ''}`.trim()
  };
}

function cleanManual(value = '') {
  return clean(String(value || '')).slice(0, MAX_TEXT);
}

function htmlToText(html) {
  return clean(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|header|footer|main|li|tr|h1|h2|h3|h4|h5|h6)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function clean(s = '') {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function match(s, r) {
  return s.match(r)?.[1] || '';
}

export function requireUrl(value, label) {
  if (!value || typeof value !== 'string') throw new Error(`${label} is required.`);
  const u = new URL(value.trim());
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`${label} must start with http:// or https://.`);
  return u.toString();
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
}

function send(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function sampleAudit({ dealerName, urls, sources, createdAt }) {
  const name = dealerName || inferName(sources.homepage.title) || inferName(sources.vdp.title) || 'Sample Dealer';
  const vdp = sources.vdp.title || 'reviewed inventory unit';
  return {
    dealerName: name,
    title: `${name} Website Audit`,
    subtitle: 'Digital experience review',
    headline: `Turn ${name} into a clearer path for inventory, pricing, service, trust, and shopper action.`,
    intro: 'This sample audit shows the finished report layout. Add OPENAI_API_KEY in Netlify to generate a dealer-specific audit from extracted page content.',
    urls,
    sourceNotes: [
      'OPENAI_API_KEY is not set, so this is a sample audit generated for UI and PDF testing.',
      ...Object.entries(sources).filter(([,p]) => p.sourceMode?.includes('user fallback')).map(([k]) => `${k} used user-provided fallback content.`),
      ...Object.entries(sources).filter(([,p]) => !p.ok).map(([k,p]) => `${k} extraction may be incomplete: ${p.error || 'limited visible text'}.`)
    ],
    overallTakeaway: `${name} has the right audit inputs in place: homepage, VDP/inventory, and service page. The production version evaluates clarity, merchandising, pricing transparency, service confidence, and conversion readiness using page-specific facts.`,
    pricingReview: {
      score: 3,
      label: 'Yellow-green — price visibility can be strong, but final-price confidence must be clear.',
      summary: 'The audit checks whether the VDP shows a real price, retail price, savings, offers, freight, setup, taxes, title, registration, accessories, payment assumptions, and a real out-the-door quote path.',
      questions: ['Is the advertised price the selling price or MSRP?', 'Are freight, setup, destination, and doc fees explained?', 'Are promotions included or additional?', 'Can shoppers request a clear out-the-door number?']
    },
    executiveSummary: { headline: 'Functional dealer structure. Needs sharper conversion messaging.', coreFinding: 'The generated audit turns homepage, VDP, and service-page facts into a practical plan with scorecard, pricing review, page findings, priorities, and stronger messaging.' },
    scorecard: {
      homepageClarity: { score: 3, summary: 'Homepage clarity depends on whether shoppers quickly understand brands, categories, location, and next steps.' },
      homepageConversion: { score: 3, summary: 'Conversion should guide shoppers toward inventory, financing, trade, parts, service, contact, and quote actions.' },
      vdpMerchandising: { score: 3, summary: `The VDP should explain why ${vdp} is desirable for the right buyer, not just list factory specs.` },
      vdpPricingTransparency: { score: 3, summary: 'The VDP should make price, fees, offers, payments, and out-the-door quote path easy to understand.' },
      servicePageConversion: { score: 3, summary: 'The service page should show capabilities, brands, common services, service proof, and what happens after a request.' },
      trust: { score: 3, summary: 'Trust should come from local relevance, service proof, dealership history, reviews, transparent pricing, and contact clarity.' }
    },
    whatMattersMost: {
      heading: 'What matters most',
      intro: 'These are the areas most likely to improve shopper confidence and lead conversion.',
      items: [
        { heading: 'Make the homepage dealer-specific', body: 'Clarify what the dealership sells, who it serves, why it is trusted locally, and which action the shopper should take next.' },
        { heading: 'Use the VDP to sell the unit', body: 'Explain buyer fit, local use cases, availability, price, accessories, trade, financing, and why to buy from this dealer.' },
        { heading: 'Make pricing easier to trust', body: 'Add a clean price stack and direct out-the-door quote CTA instead of vague quote language.' },
        { heading: 'Turn service into a buying reason', body: 'Show brands serviced, common jobs, technician proof, parts, scheduling process, and ownership support after the sale.' }
      ]
    },
    recommendedPriorities: [
      { number: '01', heading: 'Add out-the-door pricing language.', body: 'Place a clear price stack beside the VDP price and explain fees, freight, setup, taxes, title, registration, promotions, accessories, and payment assumptions.' },
      { number: '02', heading: 'Rewrite VDP copy around buyer fit.', body: 'Add customer-use language that explains who the unit is for and why it matters in the local market.' },
      { number: '03', heading: 'Strengthen the service page.', body: 'Add service categories, supported brands, common maintenance items, what-to-expect steps, and parts/accessory support.' },
      { number: '04', heading: 'Use trust signals closer to CTAs.', body: 'Move legacy, local proof, reviews, certifications, service proof, and department strengths nearer to quote and scheduling actions.' }
    ],
    pageFindings: {
      homepage: sampleFinding('The homepage should guide shoppers faster.'),
      vdp: sampleFinding('The VDP should move from listing to buyer-ready merchandising.'),
      service: sampleFinding('The service page should become a stronger ownership-support page.')
    },
    pricingTransparencyReview: {
      rating: 'Yellow-green — visible pricing is only valuable when final quote confidence is clear.',
      body: 'A strong VDP should show the price and make it clear what is included, what is extra, which offers apply, and how the customer can get an accurate final quote.',
      mainRiskDrivers: ['MSRP may not equal selling price.', 'Freight or destination may be unclear.', 'Setup or prep may be unclear.', 'Documentation fee may be missing.', 'Taxes, title, and registration may be excluded.', 'Promotions may not be explained.', 'Accessories and installation can change the final total.'],
      recommendedFix: 'Add plain-language pricing disclosure directly below the price and keep it consistent across VDP, quote tools, print views, payment estimates, and sales communication.',
      suggestedDisclosure: 'Advertised price may exclude taxes, title, registration, documentation charges, freight, setup, destination, accessories, accessory installation, finance products, and protection products unless specifically included in writing. Contact the dealer for an accurate out-the-door quote on this exact unit.',
      shopperFriendlyVersion: 'Want the real total before you visit? Contact us and we’ll confirm the selling price, fees, taxes, title/registration, financing options, trade value, accessories, and availability.'
    },
    recommendedMessaging: {
      homepageDirection: { heading: `${name} website direction`, body: `${name} should lead with local trust, key brands, inventory categories, financing, trade, parts, and service support, then guide shoppers toward the right next step.`, ctas: ['Shop New Inventory', 'Shop Pre-Owned', 'Value Your Trade', 'Schedule Service', 'Request Parts'] },
      vdpDirection: { heading: `${vdp} inventory direction`, body: 'The VDP should explain who the unit is for, what makes it desirable, how pricing works, what accessories matter, and how to confirm availability or request an out-the-door quote.', ctas: ['Request Out-the-Door Price', 'Confirm Availability', 'Ask About Promotions', 'Apply for Financing', 'Ask About Accessories'] },
      serviceDirection: { heading: `${name} service direction`, body: 'The service page should clearly promote supported brands, common services, parts, diagnostics, accessories, seasonal prep, and the scheduling process.', ctas: ['Schedule Service', 'Call Service', 'Request Parts', 'Ask About Maintenance', 'Ask About Accessories'] }
    },
    longerTermOpportunity: { heading: `Build ${name} into a clearer ownership hub.`, body: 'The strongest version of the site would not just show inventory. It would help customers buy, finance, trade, service, accessorize, and maintain the machines they own.', recommendations: ['Create buyer-fit blocks on VDPs.', 'Add a consistent price-stack component.', 'Create stronger category pages.', 'Add service menus and what-to-expect steps.', 'Move trust signals closer to lead forms.', 'Add local use-case language.', 'Cross-promote parts and accessories.', 'Let users request out-the-door pricing from every VDP.'] },
    bottomLine: { body: `${name} can improve conversion by making pricing easier to trust, making VDPs more buyer-specific, and turning service support into a visible reason to buy locally.`, fixes: ['Add Request Out-the-Door Price CTA.', 'Clarify price, fees, promotions, taxes, title, and registration.', 'Rewrite VDP copy around real buyer use cases.', 'Expand service content into a stronger ownership page.', 'Use trust signals near quote and service CTAs.'] },
    disclaimer: 'This is a website pricing transparency and conversion-readiness review, not legal advice.',
    createdAt
  };
}

function sampleFinding(heading) {
  return {
    heading,
    current: 'The page has useful functional content, but the final audit should make the diagnosis more specific based on live extracted page content.',
    working: ['Core page exists.', 'Shopper path is present.', 'Contact or lead path is available.', 'The page can support conversion with stronger copy.'],
    weak: ['Messaging may be too generic.', 'Pricing and CTA clarity may be incomplete.', 'Trust signals may be too far from the buying decision.', 'Service or ownership support may be underused.'],
    recommendations: ['Add specific headline language.', 'Clarify CTAs.', 'Connect page content to local buyer needs.', 'Promote trust, service, parts, and quote confidence.']
  };
}

function inferName(title) {
  if (!title) return '';
  return title.split('|')[0].split(' - ')[0].replace(/website audit/i, '').trim();
}

const auditSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dealerName','title','subtitle','headline','intro','urls','sourceNotes','overallTakeaway','pricingReview','executiveSummary','scorecard','whatMattersMost','recommendedPriorities','pageFindings','pricingTransparencyReview','recommendedMessaging','longerTermOpportunity','bottomLine','disclaimer','createdAt'],
  properties: {
    dealerName: { type: 'string' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    headline: { type: 'string' },
    intro: { type: 'string' },
    urls: { type: 'object', additionalProperties: false, required: ['homepage','vdp','service'], properties: { homepage: {type:'string'}, vdp:{type:'string'}, service:{type:'string'} } },
    sourceNotes: { type: 'array', items: { type: 'string' } },
    overallTakeaway: { type: 'string' },
    pricingReview: { type: 'object', additionalProperties:false, required:['score','label','summary','questions'], properties:{ score:{type:'number'}, label:{type:'string'}, summary:{type:'string'}, questions:{type:'array', items:{type:'string'}} } },
    executiveSummary: { type: 'object', additionalProperties:false, required:['headline','coreFinding'], properties:{ headline:{type:'string'}, coreFinding:{type:'string'} } },
    scorecard: { type:'object', additionalProperties:false, required:['homepageClarity','homepageConversion','vdpMerchandising','vdpPricingTransparency','servicePageConversion','trust'], properties:{ homepageClarity:scoreItem(), homepageConversion:scoreItem(), vdpMerchandising:scoreItem(), vdpPricingTransparency:scoreItem(), servicePageConversion:scoreItem(), trust:scoreItem() } },
    whatMattersMost: { type:'object', additionalProperties:false, required:['heading','intro','items'], properties:{ heading:{type:'string'}, intro:{type:'string'}, items:{type:'array', minItems:4, maxItems:6, items:{type:'object', additionalProperties:false, required:['heading','body'], properties:{heading:{type:'string'}, body:{type:'string'}}}}}},
    recommendedPriorities: { type:'array', minItems:4, maxItems:6, items:{type:'object', additionalProperties:false, required:['number','heading','body'], properties:{number:{type:'string'}, heading:{type:'string'}, body:{type:'string'}}}},
    pageFindings: { type:'object', additionalProperties:false, required:['homepage','vdp','service'], properties:{ homepage:pageFinding(), vdp:pageFinding(), service:pageFinding() } },
    pricingTransparencyReview: { type:'object', additionalProperties:false, required:['rating','body','mainRiskDrivers','recommendedFix','suggestedDisclosure','shopperFriendlyVersion'], properties:{ rating:{type:'string'}, body:{type:'string'}, mainRiskDrivers:{type:'array', minItems:5, maxItems:10, items:{type:'string'}}, recommendedFix:{type:'string'}, suggestedDisclosure:{type:'string'}, shopperFriendlyVersion:{type:'string'} } },
    recommendedMessaging: { type:'object', additionalProperties:false, required:['homepageDirection','vdpDirection','serviceDirection'], properties:{ homepageDirection:messaging(), vdpDirection:messaging(), serviceDirection:messaging() } },
    longerTermOpportunity: { type:'object', additionalProperties:false, required:['heading','body','recommendations'], properties:{ heading:{type:'string'}, body:{type:'string'}, recommendations:{type:'array', minItems:6, maxItems:12, items:{type:'string'}}}},
    bottomLine: { type:'object', additionalProperties:false, required:['body','fixes'], properties:{ body:{type:'string'}, fixes:{type:'array', minItems:5, maxItems:8, items:{type:'string'}}}},
    disclaimer: { type: 'string' },
    createdAt: { type: 'string' }
  }
};

function scoreItem(){ return { type:'object', additionalProperties:false, required:['score','summary'], properties:{ score:{type:'number'}, summary:{type:'string'} } }; }
function pageFinding(){ return { type:'object', additionalProperties:false, required:['heading','current','working','weak','recommendations'], properties:{ heading:{type:'string'}, current:{type:'string'}, working:{type:'array', minItems:4, maxItems:8, items:{type:'string'}}, weak:{type:'array', minItems:4, maxItems:8, items:{type:'string'}}, recommendations:{type:'array', minItems:4, maxItems:8, items:{type:'string'}} } }; }
function messaging(){ return { type:'object', additionalProperties:false, required:['heading','body','ctas'], properties:{ heading:{type:'string'}, body:{type:'string'}, ctas:{type:'array', minItems:4, maxItems:7, items:{type:'string'}} } }; }
