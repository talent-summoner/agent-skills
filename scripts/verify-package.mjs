/**
 * [INPUT]: Built package, canonical skill/source manifest and npm/tar executables.
 * [OUTPUT]: Validated allowlisted npm tarball in artifacts/, with content-hash and single-bin checks.
 * [POS]: TS-881 public release gate shared by developer packaging and CI.
 * [PROTOCOL]: Do not include credentials or private app files. Publication is a separate explicit step.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runNpm } from './npm-cli.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.name, '@talent-summoner/setup');
assert.deepEqual(Object.keys(pkg.bin), ['talent-summoner-setup']);
assert.equal(pkg.bin['talent-summoner-setup'], 'dist/setup.mjs');
for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) {
  assert.equal(pkg.scripts?.[name], undefined, `Unexpected lifecycle hook: ${name}`);
}
for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/, `Unpinned dependency: ${name}`);
}
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [name, entry] of Object.entries(lock.packages ?? {})) {
  if (!name || entry.dev) continue;
  assert.equal(entry.hasInstallScript, undefined, `Dependency needs a lifecycle audit: ${name}`);
  assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), `Non-registry runtime dependency: ${name}`);
}

await mkdir('artifacts', { recursive: true });
const result = JSON.parse(runNpm(['pack', '--json', '--pack-destination', 'artifacts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
// npm 11 emits an array; npm 12 keys the result by package name.
const pack = Array.isArray(result) ? result[0] : Object.values(result)[0];
assert.ok(pack.filename && !pack.filename.includes('/'));
const archive = resolve('artifacts', pack.filename);
const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
const metadata = new Set(['package/package.json', 'package/README.md', 'package/LICENSE', 'package/skill-source.json', 'package/skills/talent-summoner/SKILL.md']);
for (const file of files) {
  assert.ok(metadata.has(file) || /^package\/dist\/[a-zA-Z0-9_/-]+\.mjs$/.test(file), `Unexpected packed file: ${file}`);
  assert.ok(!file.split('/').includes('..'));
}
for (const file of metadata) assert.ok(files.includes(file), `Missing packed file: ${file}`);
assert.ok(files.includes('package/dist/setup.mjs'));
const extract = (name) => execFileSync('tar', ['-xOf', archive, `package/${name}`]);
const source = JSON.parse(extract('skill-source.json').toString());
const skill = extract('skills/talent-summoner/SKILL.md');
assert.equal(createHash('sha256').update(skill).digest('hex'), source.sha256);
assert.match(source.sourceCommit, /^[0-9a-f]{40}$/);
assert.ok(skill.equals(await readFile('skills/talent-summoner/SKILL.md')));
assert.ok(extract('dist/setup.mjs').toString().startsWith('#!/usr/bin/env node'));
console.log(`Verified ${pack.filename}: ${files.length} allowlisted files, one bin, canonical skill hash.`);
