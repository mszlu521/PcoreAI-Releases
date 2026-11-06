const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const output = path.resolve('output');
const hash = (file, algorithm) => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
const validVersion = (version) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
function gh(args) { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

function collect() {
  const root = path.resolve('private-source');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const arch = process.env.TARGET_ARCH;
  assert.ok(validVersion(version), 'Invalid package version');
  assert.ok(['x64', 'arm64'].includes(arch), 'Invalid macOS architecture');
  assert.match(process.env.SOURCE_SHA || '', /^[0-9a-f]{40}$/);
  fs.mkdirSync(output, { recursive: true });
  const files = ['dmg', 'zip'].map((extension) => {
    const name = `PcoreAI-${version}-mac-${arch}.${extension}`;
    const source = path.join(root, 'release', name);
    const stat = fs.lstatSync(source);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 1024 * 1024, 'Invalid installer');
    fs.copyFileSync(source, path.join(output, name), fs.constants.COPYFILE_EXCL);
    return { name, file_size: stat.size, sha512: hash(source, 'sha512'), sha256: hash(source, 'sha256') };
  });
  fs.writeFileSync(path.join(output, `pcoreai-${version}-mac-${arch}-metadata.json`), JSON.stringify({
    version, platform: 'macos', architecture: arch, source_sha: process.env.SOURCE_SHA,
    signing: 'ad-hoc', notarized: false, files,
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(output, `PcoreAI-${version}-mac-${arch}.sha512`), files.map((file) => `${file.sha512}  ${file.name}`).join('\n') + '\n');
  console.log(`Collected verified ${arch} installers and SHA-512 checksums.`);
}

function publish() {
  const names = fs.readdirSync(output);
  const metadataNames = names.filter((name) => /^pcoreai-[0-9A-Za-z.-]+-mac-(?:x64|arm64)-metadata\.json$/.test(name));
  assert.equal(metadataNames.length, 2, 'Both architecture manifests are required');
  const metadata = metadataNames.map((name) => JSON.parse(fs.readFileSync(path.join(output, name), 'utf8')));
  assert.deepEqual(metadata.map((entry) => entry.architecture).sort(), ['arm64', 'x64']);
  const version = metadata[0].version;
  assert.ok(validVersion(version));
  const expected = new Set(metadataNames);
  for (const entry of metadata) {
    assert.equal(entry.version, version);
    assert.equal(entry.source_sha, process.env.SOURCE_SHA);
    assert.equal(entry.signing, 'ad-hoc');
    assert.equal(entry.notarized, false);
    assert.equal(entry.files.length, 2);
    for (const extension of ['dmg', 'zip']) {
      const name = `PcoreAI-${version}-mac-${entry.architecture}.${extension}`;
      const file = entry.files.find((item) => item.name === name);
      assert.ok(file, 'Missing installer');
      const target = path.join(output, name);
      const stat = fs.lstatSync(target);
      assert.ok(stat.isFile() && !stat.isSymbolicLink());
      assert.equal(stat.size, file.file_size);
      assert.equal(hash(target, 'sha512'), file.sha512);
      assert.equal(hash(target, 'sha256'), file.sha256);
      expected.add(name);
    }
    const checksumName = `PcoreAI-${version}-mac-${entry.architecture}.sha512`;
    assert.equal(fs.readFileSync(path.join(output, checksumName), 'utf8'), entry.files.map((file) => `${file.sha512}  ${file.name}`).join('\n') + '\n');
    expected.add(checksumName);
  }
  assert.deepEqual([...expected].sort(), names.sort(), 'Unexpected files must never be published');
  const tag = `v${version}`;
  const repo = process.env.GITHUB_REPOSITORY;
  assert.equal(repo, 'mszlu521/PcoreAI-Releases');
  const release = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,assets']));
  assert.equal(release.isDraft, false, 'The version must already have a published release');
  // A retry may reuse identical uploads, but must never replace different bytes.
  const pending = [];
  for (const name of expected) {
    const existing = release.assets.find((asset) => asset.name === name);
    const file = path.join(output, name);
    if (existing) {
      assert.equal(existing.state, 'uploaded');
      assert.equal(existing.size, fs.statSync(file).size);
      assert.equal(existing.digest, `sha256:${hash(file, 'sha256')}`, `Existing asset differs: ${name}`);
    } else pending.push(file);
  }
  if (pending.length) gh(['release', 'upload', tag, '--repo', repo, ...pending]);
  const uploaded = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'assets']));
  for (const name of expected) {
    const asset = uploaded.assets.find((item) => item.name === name);
    assert.ok(asset && asset.state === 'uploaded');
    assert.equal(asset.size, fs.statSync(path.join(output, name)).size);
    assert.equal(asset.digest, `sha256:${hash(path.join(output, name), 'sha256')}`);
  }
  console.log(`Published and verified Intel and Apple silicon installers for ${tag}.`);
}

if (require.main === module) {
  if (process.argv[2] === 'collect') collect();
  else if (process.argv[2] === 'publish') publish();
  else throw new Error('Expected collect or publish');
}
module.exports = { collect, publish };
