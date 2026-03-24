#!/usr/bin/env node
// CRX3 signing script using only Node.js built-in crypto.
// Usage: node scripts/sign-crx.js <input.zip> <key.pem> <output.crx>

const fs = require('fs');
const crypto = require('crypto');

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
  const keyPem = fs.readFileSync(keyPath, 'utf8').trim();

  const privateKey = crypto.createPrivateKey({ key: keyPem, format: 'pem' });
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

  // Print the Chrome extension ID (nibble-encoded crxId, a–p)
  const extId = Array.from(crxId)
    .flatMap(b => [b >> 4, b & 0xf])
    .map(n => String.fromCharCode(97 + n))
    .join('');

  console.log(`CRX3 written: ${outPath} (${crx.length} bytes)`);
  console.log(`Extension ID: ${extId}`);
}

const [, , zip, key, out] = process.argv;
if (!zip || !key || !out) {
  console.error('Usage: sign-crx.js <input.zip> <key.pem> <output.crx>');
  process.exit(1);
}
signCRX3(zip, key, out);
