
import { inflateSync } from 'node:zlib';

export function extractPdfTextFromDataUrl(dataUrl = '', maxChars = 24000) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:application/pdf;base64,')) return '';

  try {
    const base64 = dataUrl.split(',')[1] || '';
    const buffer = Buffer.from(base64, 'base64');
    return extractPdfTextFromBuffer(buffer, maxChars);
  } catch {
    return '';
  }
}

export function extractPdfTextFromBuffer(buffer, maxChars = 24000) {
  if (!buffer || !buffer.length) return '';

  const raw = buffer.toString('latin1');
  const chunks = [];

  // Some PDFs include readable metadata or uncompressed streams.
  chunks.push(extractTextOperators(raw));

  // Most browser-saved PDFs use FlateDecode compressed content streams.
  const streamRegex = /(<<[\s\S]{0,2500}?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let count = 0;

  while ((match = streamRegex.exec(raw)) && count < 250) {
    count += 1;
    const dict = match[1] || '';
    const body = match[2] || '';
    let streamText = '';

    try {
      const streamBuffer = Buffer.from(body, 'latin1');
      if (/\/FlateDecode/.test(dict)) {
        streamText = inflateSync(streamBuffer).toString('latin1');
      } else {
        streamText = streamBuffer.toString('latin1');
      }
    } catch {
      continue;
    }

    const extracted = extractTextOperators(streamText);
    if (extracted) chunks.push(extracted);
  }

  return cleanPdfText(chunks.join('\n')).slice(0, maxChars);
}

function extractTextOperators(s = '') {
  const output = [];

  // Literal strings in text drawing operators: (Text) Tj and arrays [(Text) 20 (Text)] TJ
  const literalRegex = /\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")/g;
  let m;
  while ((m = literalRegex.exec(s))) {
    const value = decodePdfLiteral(m[0].replace(/\)\s*(?:Tj|'|")\s*$/, ')'));
    if (value) output.push(value);
  }

  const arrayRegex = /\[(.*?)\]\s*TJ/gs;
  while ((m = arrayRegex.exec(s))) {
    const arr = m[1] || '';
    const parts = [];
    const lit = arr.match(/\((?:\\.|[^\\()])*\)/g) || [];
    for (const part of lit) {
      const decoded = decodePdfLiteral(part);
      if (decoded) parts.push(decoded);
    }

    const hexes = arr.match(/<([0-9A-Fa-f\s]+)>/g) || [];
    for (const h of hexes) {
      const decoded = decodeHexPdfString(h);
      if (decoded) parts.push(decoded);
    }

    if (parts.length) output.push(parts.join(' '));
  }

  // Hex encoded strings: <FEFF...> Tj or <...> Tj
  const hexRegex = /<([0-9A-Fa-f\s]{4,})>\s*(?:Tj|'|")/g;
  while ((m = hexRegex.exec(s))) {
    const decoded = decodeHexPdfString(m[0].replace(/\s*(?:Tj|'|")\s*$/, ''));
    if (decoded) output.push(decoded);
  }

  return output.join('\n');
}

function decodePdfLiteral(token = '') {
  let s = token.trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);

  return s
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\\r?\n/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, ' ')
    .trim();
}

function decodeHexPdfString(token = '') {
  let hex = token.replace(/[<>\s]/g, '');
  if (!hex || hex.length < 4) return '';
  if (hex.length % 2) hex += '0';

  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }

  try {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const chars = [];
      for (let i = 2; i + 1 < bytes.length; i += 2) {
        chars.push(String.fromCharCode((bytes[i] << 8) | bytes[i + 1]));
      }
      return chars.join('').trim();
    }

    // Many PDF strings are UTF-16BE without BOM, especially if every other byte is zero.
    const zeroPairs = bytes.filter((b, i) => i % 2 === 0 && b === 0).length;
    if (zeroPairs > bytes.length / 4) {
      const chars = [];
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        chars.push(String.fromCharCode((bytes[i] << 8) | bytes[i + 1]));
      }
      return chars.join('').trim();
    }

    return Buffer.from(bytes).toString('latin1').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ').trim();
  } catch {
    return '';
  }
}

function cleanPdfText(value = '') {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[-–—_]{3,}$/.test(line))
    .join('\n')
    .trim();
}
