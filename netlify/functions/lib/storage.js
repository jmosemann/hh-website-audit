import { getStore } from '@netlify/blobs';

const STORE_NAME = 'dealer-audits';
const UPLOAD_STORE_NAME = 'dealer-audit-uploads';

export function getAuditStore() {
  const siteID =
    process.env.NETLIFY_BLOBS_SITE_ID ||
    process.env.NETLIFY_SITE_ID ||
    process.env.SITE_ID ||
    process.env.SITE_ID_OVERRIDE;

  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.NETLIFY_AUTH_TOKEN ||
    process.env.NETLIFY_API_TOKEN;

  // In modern Netlify Functions, getStore(STORE_NAME) is auto-configured.
  // The explicit fallback is only for local/dev environments that do not inject Blobs context.
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token, consistency: 'strong' });
  }

  return getStore({ name: STORE_NAME, consistency: 'strong' });
}


export function getUploadStore() {
  const siteID =
    process.env.NETLIFY_BLOBS_SITE_ID ||
    process.env.NETLIFY_SITE_ID ||
    process.env.SITE_ID ||
    process.env.SITE_ID_OVERRIDE;

  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.NETLIFY_AUTH_TOKEN ||
    process.env.NETLIFY_API_TOKEN;

  if (siteID && token) {
    return getStore({ name: UPLOAD_STORE_NAME, siteID, token, consistency: 'strong' });
  }

  return getStore({ name: UPLOAD_STORE_NAME, consistency: 'strong' });
}

export function getBlobConfigStatus() {
  const siteID =
    process.env.NETLIFY_BLOBS_SITE_ID ||
    process.env.NETLIFY_SITE_ID ||
    process.env.SITE_ID ||
    process.env.SITE_ID_OVERRIDE;

  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.NETLIFY_AUTH_TOKEN ||
    process.env.NETLIFY_API_TOKEN;

  return {
    hasExplicitSiteID: Boolean(siteID),
    hasExplicitToken: Boolean(token),
    explicitConfigReady: Boolean(siteID && token),
    functionSyntax: 'modern-request-response'
  };
}
