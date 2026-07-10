import { getStore } from '@netlify/blobs';
import OpenAI from 'openai';

const MAX_TEXT = 24000;

export async function handler(event) {
  if (event.httpMethod !== 'POST') return send(405, { error: 'Method not allowed.' });

  try {
    const body = JSON.parse(event.body || '{}');
    const urls = {
      homepage: requireUrl(body.homepageUrl, 'Homepage URL'),
      vdp: requireUrl(body.vdpUrl, 'VDP URL'),
      service: requireUrl(body.serviceUrl, 'Service URL')
    };
    const dealerName = typeof body.dealerName === 'string' ? body.dealerName.trim() : '';
    const id = makeId();
    const createdAt = new Date().toISOString();

    const sources = {
      homepage: await extract(urls.homepage),
      vdp: await extract(urls.vdp),
      service: await extract(urls.service)
    };

    const audit = process.env.OPENAI_API_KEY
      ? await generateAudit({ dealerName, urls, sources, createdAt })
      : sampleAudit({ dealerName, urls, sources, createdAt });

    audit.id = id;
    audit.urls = urls;
    audit.createdAt = createdAt;

    const store = getStore('dealer-audits');
    await store.setJSON(id, audit, { metadata: { dealerName: audit.dealerName, createdAt } });

    return send(200, { id, audit });
  } catch (err) {
    return send(400, { error: err?.message || 'Could not create audit.' });
  }
}

async function generateAudit({ dealerName, urls, sources, createdAt }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = buildPrompt({ dealerName, urls, sources, createdAt });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input: [
      { role: 'system', content: 'You are Dealer Website Optimizer. Return only valid JSON matching the supplied schema. Do not invent facts.' },
      { role: 'user', content: prompt }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'dealer_audit',
        strict: true,
        schema: auditSchema
      }
    }
  });
  return JSON.parse(response.output_text);
}

function buildPrompt({ dealerName, urls, sources, createdAt }) {
  return `
You are Dealer Website Optimizer, an AI-assisted website audit specialist for powersports, marine, golf car, and equipment dealerships.

Create a Herohub-style digital experience review using ONLY the supplied page content. If scraping is incomplete or blocked, add sourceNotes and do not pretend to see the missing content.

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
Visible text:
${p.text || '[No usable text extracted]'}
`;
}

async function extract(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
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
      return { url, title: '', metaDescription: '', status: res.status, ok: false, text: '', error: `Expected HTML but received ${contentType || 'unknown content type'}.` };
    }
    const html = await res.text();
    const title = clean(match(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const metaDescription = clean(
      match(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      match(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)
    );
    const text = htmlToText(html).slice(0, MAX_TEXT);
    return { url, title, metaDescription, status: res.status, ok: res.ok && text.length > 250, text, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { url, title: '', metaDescription: '', status: null, ok: false, text: '', error: err?.message || 'Extraction failed.' };
  }
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

function requireUrl(value, label) {
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
