const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Private build output is encrypted before becoming a public workflow artifact.
// The raw AES key is a repository secret, never a workflow input or log entry.
if (process.argv[2] === 'encrypt') {
  const key = Buffer.from(process.env.PCOREAI_BUILD_LOG_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('Diagnostic encryption key must contain 32 bytes');
  fs.mkdirSync('diagnostics', { recursive: true });
  for (const name of fs.readdirSync(process.env.RUNNER_TEMP)) {
    if (!/^pcoreai-[a-z]+\.log$/.test(name)) continue;
    const source = path.join(process.env.RUNNER_TEMP, name);
    if (!fs.lstatSync(source).isFile()) continue;
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(fs.readFileSync(source)), cipher.final()]);
    fs.writeFileSync(path.join('diagnostics', name + '.enc'), Buffer.concat([Buffer.from('PCORELOG1'), nonce, cipher.getAuthTag(), encrypted]));
  }
  console.log('Failure diagnostics encrypted. Raw private-source logs were not uploaded.');
} else if (process.argv[2] === 'decrypt') {
  const [, , , keyPath, source, destination] = process.argv;
  const key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
  const bytes = fs.readFileSync(source);
  if (key.length !== 32 || bytes.subarray(0, 9).toString() !== 'PCORELOG1') throw new Error('Invalid encrypted diagnostic');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(9, 21));
  decipher.setAuthTag(bytes.subarray(21, 37));
  const plain = Buffer.concat([decipher.update(bytes.subarray(37)), decipher.final()]);
  fs.writeFileSync(destination, plain, { flag: 'wx' });
} else throw new Error('Expected encrypt or decrypt');
