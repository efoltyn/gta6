// Narrow portal release adapter: patch verified deployed bytes and retain the
// rest of the release. Publication uses GitHub's atomic tree/commit/ref tools.
// Usage: node tools/prepare-prison-names-release.mjs BASELINE_JSON OUTPUT_DIR
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Baseline JSON and output directory required');
const baseline = JSON.parse(readFileSync(input, 'utf8'));
const hash = s => createHash('sha256').update(s).digest('hex');
const files = { ...baseline.files };
for (const [file, content] of Object.entries(files)) {
  const entry = baseline.manifest.files.find(e => e.file === file);
  if (!entry || entry.sha256 !== hash(content) || entry.bytes !== Buffer.byteLength(content))
    throw new Error('Deployed bytes disagree with manifest: ' + file);
}
function replaceOnce(file, before, after) {
  if (files[file].split(before).length !== 2) throw new Error('Expected one match: ' + before);
  files[file] = files[file].replace(before, after);
}
const cars = 'src/systems/prisoncars.js';
for (const [oldName, newName] of [
  ['Southsiders', 'Sureños'], ['Black car', 'Black Guerrilla Family'],
  ['White car', 'Aryan Brotherhood'], ['Paisas', 'Border Brothers'],
  ['Asian car', 'Asian Boyz'], ['Others', 'Independents'],
]) {
  replaceOnce(cars, 'label:' + JSON.stringify(oldName), 'label:' + JSON.stringify(newName));
  replaceOnce(cars, 'phrase:' + JSON.stringify('the ' + oldName), 'phrase:' + JSON.stringify('the ' + newName));
}
const interact = 'src/systems/interact.js';
replaceOnce(interact, 'function gangShort(a){if(!a)return"";',
  'function gangShort(a){if(!a)return"";if(!(a.gang>=0))return"Independent";');
for (const [file, content] of Object.entries(files)) {
  new vm.Script(content, { filename: file });
  const entry = baseline.manifest.files.find(e => e.file === file);
  entry.sha256 = hash(content); entry.bytes = Buffer.byteLength(content);
  const target = path.join(output, file);
  mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, content);
}
if (/White car|Black car|Asian car/.test(files[cars])) throw new Error('Old car labels remain');
const CBZ = { onUpdate() {} };
vm.runInNewContext(files[cars], { CBZ });
const expected = ['Sureños', 'Black Guerrilla Family', 'Aryan Brotherhood', 'Border Brothers', 'Asian Boyz', 'Independents'];
expected.forEach((name, i) => {
  if (CBZ.prisonCars.label(i) !== name || CBZ.prisonCars.phrase(i) !== 'the ' + name)
    throw new Error('Runtime gang catalogue mismatch');
});
baseline.manifest.createdAt = new Date().toISOString();
baseline.manifest.totalBytes = baseline.manifest.files.reduce((sum, e) => sum + e.bytes, 0);
baseline.manifest.patch = { name: 'real-prison-gang-names', baseDeploymentCommit: baseline.parent, files: Object.keys(files) };
files['release-manifest.json'] = JSON.stringify(baseline.manifest, null, 2) + '\n';
writeFileSync(path.join(output, 'release-manifest.json'), files['release-manifest.json']);
const bundle = { parent: baseline.parent, tree_elements: Object.entries(files).map(([file, content]) => ({ path: file, mode: '100644', type: 'blob', content })) };
writeFileSync(path.join(output, 'publication.json'), JSON.stringify(bundle));
const receipt = { channel: 'web', status: 'prepared', repository: 'efoltyn/gta6', branch: 'gh-pages', url: 'https://efoltyn.github.io/gta6/prison-escape.html', baseDeploymentCommit: baseline.parent, manifestSha256: hash(files['release-manifest.json']), changedFiles: Object.keys(files), checks: ['deployed bytes matched manifest', 'JavaScript syntax valid', 'six runtime labels and phrases verified', 'old car labels absent'] };
writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
