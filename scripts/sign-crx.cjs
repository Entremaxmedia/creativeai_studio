#!/usr/bin/env node
// CRX3 signing script using only Node.js built-in crypto.
// Usage: node scripts/sign-crx.cjs <input.zip> <key.pem> <output.crx>

const fs = require('fs');
const crypto = require('crypto');

// Normalize a PEM key regardless of how it was stored in GitHub Secrets.
// Handles: CRLF endings, literal \n strings, missing line breaks, extra spaces.
function normalizePem(raw) {
  // Replace literal \n strings and CRLF with real newlines, strip extra whitespace
  let s = raw.replace(/\\n/g, '\n').replace(/\r/g, '').trim();

  // If the entire key is on one line (no newlines in body), reconstruct it
  const headerMatch = s.match(/-----BEGIN ([^-]+)-----/);
  const footerMatch = s.match(/-----END ([^-]+)-----/);
  if (!headerMatch || !footerMatch) {
    throw new Error('PEM key missing BEGIN/END markers. Check CRX_PRIVATE_KEY secret.');
  }

  const header = `-----BEGIN ${headerMatch[1]}-----`;
  const footer = `-----END ${footerMatch[1]}-----`;

  // Extract raw base64 body (everything between header and footer, no whitespace)
  const body = s
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');

  // Re-wrap at 64 chars per line (standard PEM)
  const wrapped = body.match(/.{1,64}/g).join('\n');
  return `${header}\n${wrapped}\n${footer}\n`;
}

function varint(n) {
  const bytes = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n & 0x7f);
  return Buffer.from(bytes);
}

function field(num, data) {
  const tag = varint((num << 3) | 2);
  return Buffer.concat([tag, varint(data.length), data]);
}

function signCRX3(zipPath, keyPath, outPath) {
  const zip = fs.readFileSync(zipPath);
  const rawKey = fs.readFileSync(keyPath, 'utf8');

  let keyPem;
  try {
    keyPem = normalizePem(rawKey);
  } catch (e) {
    console.error('Key normalization failed:', e.message);
    process.exit(1);
  }

  console.log('Key header:', keyPem.split('\n')[0]);

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey({ key: keyPem, format: 'pem' });
  } catch (e) {
    console.error('Failed to parse private key:', e.message);
    console.error('Key length:', keyPem.length, 'chars,', keyPem.split('\n').length, 'lines');
    process.exit(1);
  }

  const publicKeyDer = crypto.createPublicKey(privateKey)
    .export({ type: 'spki', format: 'der' });

  // CRX ID = first 16 bytes of SHA-256 of the public key DER
  const crxId = crypto.createHash('sha256').update(publicKeyDer).digest().slice(0, 16);

  // SignedData protobuf: field 1 = crx_id
  const signedData = field(1, crxId);

  // What gets signed: prefix + signedData length (LE u32) + signedData + zip
  const prefix = Buffer.from('CRX3 SignedData\x00');
  const sdLen = Buffer.alloc(4);
  sdLen.writeUInt32LE(signedData.length);
  const toBeSigned = Buffer.concat([prefix, sdLen, signedData, zip]);

  const signature = crypto.sign('sha256', toBeSigned, {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });

  // AsymmetricKeyProof protobuf: field 1 = public_key, field 2 = signature
  const proof = Buffer.concat([field(1, publicKeyDer), field(2, signature)]);

  // CrxFileHeader protobuf: field 2 = proof, field 10000 = signed_header_data
  const header = Buffer.concat([field(2, proof), field(10000, signedData)]);

  // Assemble: magic | version (3) | headerSize | header | zip
  const magic = Buffer.from('Cr24');
  const version = Buffer.alloc(4); version.writeUInt32LE(3);
  const headerSize = Buffer.alloc(4); headerSize.writeUInt32LE(header.length);
  const crx = Buffer.concat([magic, version, headerSize, header, zip]);

  fs.writeFileSync(outPath, crx);

  // Print the Chrome extension ID (nibble-encoded crxId, a-p)
  const extId = Array.from(crxId)
    .flatMap(b => [b >> 4, b & 0xf])
    .map(n => String.fromCharCode(97 + n))
    .join('');

  console.log(`CRX3 written: ${outPath} (${crx.length} bytes)`);
  console.log(`Extension ID: ${extId}`);
}

const [, , zip, key, out] = process.argv;
if (!zip || !key || !out) {
  console.error('Usage: sign-crx.cjs <input.zip> <key.pem> <output.crx>');
  process.exit(1);
}
signCRX3(zip, key, out);
