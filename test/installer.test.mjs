/*
[INPUT]: Temporary projects, synthetic keys, and stub HTTP MCP responses.
[OUTPUT]: Regression proof for native config merging, private files, safe failures, and skill invocation.
[POS]: Installer integration tests without touching a real client profile or paid tool.
[PROTOCOL]: Use disposable roots and inspect only synthetic credentials.
*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describeSetupFailure, installClients, installSkill, inspectTarget, protectPreviewProject, preparePreviewSkill, SetupUserError } from '../src/install.mjs';
import { EXPECTED_TOOLS, parseOrigin, verifyConnection, SetupVerificationError } from '../src/verify.mjs';

function project() { return mkdtempSync(join(tmpdir(), 'ts-setup-test-')); }
function cleanup(path) { rmSync(path, { recursive: true, force: true }); }

test('rejects malformed origins', () => {
  for (const value of ['http://example.com', 'https://u:p@example.com', 'https://example.com/a', 'https://example.com/?x=1', 'https://example.com/#x']) {
    assert.throws(() => parseOrigin(value));
  }
  assert.equal(parseOrigin('https://example.com'), 'https://example.com');
});

test('SDK initializes and lists exactly seven tools without calling them', async () => {
  const methods = [];
  const fakeFetch = async (_input, init) => {
    assert.equal(init.redirect, 'manual');
    const message = JSON.parse(init.body);
    methods.push(message.method);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '1' } }
      : { tools: EXPECTED_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' } })) };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  await verifyConnection({ origin: 'https://example.com', key: 'dummy-key', fetchImpl: fakeFetch });
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list']);
});

test('refuses cross-origin credential redirects and hides response payload', async () => {
  const fakeFetch = async () => new Response('sensitive-body', { status: 302, headers: { location: 'https://attacker.invalid/steal' } });
  await assert.rejects(verifyConnection({ origin: 'https://example.com', key: 'dummy-key', fetchImpl: fakeFetch }), (error) => !error.message.includes('dummy-key') && !error.message.includes('sensitive-body'));
});

test('classifies API-key rejection and deployment protection safely', async () => {
  const unauthorized = async () => new Response('raw-auth-error', { status: 401, headers: { 'content-type': 'application/json' } });
  await assert.rejects(verifyConnection({ origin: 'https://example.com', key: 'dummy-key', fetchImpl: unauthorized }), /API key was rejected/);
  const protectedPage = async () => new Response('protected html', { status: 401, headers: { 'content-type': 'text/html' } });
  await assert.rejects(verifyConnection({ origin: 'https://example.com', key: 'dummy-key', fetchImpl: protectedPage }), /deployment appears protected/);
  const ssoRedirect = async () => new Response(null, { status: 307, headers: { location: '/_vercel/sso' } });
  await assert.rejects(verifyConnection({ origin: 'https://example.com', key: 'dummy-key', fetchImpl: ssoRedirect }), /deployment appears protected/);
});

test('native library preserves unrelated servers and private permissions on rerun', async () => {
  const cwd = project();
  try {
    mkdirSync(join(cwd, '.cursor'));
    writeFileSync(join(cwd, '.cursor/mcp.json'), JSON.stringify({ custom: 1, mcpServers: { other: { command: 'local' } } }), { mode: 0o644 });
    const options = { clients: ['claude-code', 'cursor'], preview: true, cwd, origin: 'https://preview.example.com', key: 'dummy-key', confirmOverwrite: async () => true, skillInstaller: async () => {} };
    const first = await installClients(options);
    assert.ok(first.every((entry) => entry.success));
    const second = await installClients(options);
    assert.ok(second.every((entry) => entry.success));
    const cursor = JSON.parse(readFileSync(join(cwd, '.cursor/mcp.json')));
    assert.equal(cursor.custom, 1);
    assert.deepEqual(cursor.mcpServers.other, { command: 'local' });
    assert.equal(cursor.mcpServers['talent-summoner-preview'].headers.Authorization, 'Bearer dummy-key');
    assert.deepEqual(Object.keys(cursor.mcpServers).sort(), ['other', 'talent-summoner-preview']);
    for (const path of [join(cwd, '.mcp.json'), join(cwd, '.cursor/mcp.json')]) assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { cleanup(cwd); }
});

test('skill failure reports a configured MCP entry and rerun completes it', async () => {
  const cwd = project();
  try {
    let firstAttempt = true;
    const options = {
      clients: ['claude-code', 'cursor'], preview: true, cwd,
      origin: 'https://preview.example.com', key: 'synthetic-fixture',
      confirmOverwrite: async () => true,
      skillInstaller: async (client) => {
        if (client === 'claude-code' && firstAttempt) throw new Error('raw-error-with-synthetic-fixture');
      },
    };
    const first = await installClients(options);
    assert.deepEqual(first.map((result) => result.status), ['mcp-configured-skill-failed', 'installed']);
    assert.equal(first[0].mcpConfigured, true);
    assert.equal(JSON.stringify(first).includes('raw-error-with-synthetic-fixture'), false);
    const config = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    assert.equal(config.mcpServers['talent-summoner-preview'].headers.Authorization, 'Bearer synthetic-fixture');
    firstAttempt = false;
    const second = await installClients(options);
    assert.deepEqual(second.map((result) => result.status), ['installed', 'installed']);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8')).mcpServers), ['talent-summoner-preview']);
  } finally { cleanup(cwd); }
});

test('server failure reports no MCP entry and does not attempt the skill', async () => {
  const cwd = project();
  try {
    let skillCalled = false;
    const results = await installClients({
      clients: ['claude-code'], preview: true, cwd,
      origin: 'https://preview.example.com', key: 'synthetic-fixture',
      confirmOverwrite: async () => true,
      serverInstaller: () => ({ success: false }),
      skillInstaller: async () => { skillCalled = true; },
    });
    assert.equal(results[0].status, 'mcp-not-configured');
    assert.equal(results[0].mcpConfigured, false);
    assert.equal(skillCalled, false);
    assert.equal(readFileSync(join(cwd, '.mcp.json'), 'utf8'), '');
  } finally { cleanup(cwd); }
});

test('malformed config and existing content refusal happen before writes', async () => {
  const cwd = project();
  try {
    writeFileSync(join(cwd, '.mcp.json'), 'not-json');
    assert.throws(() => inspectTarget('claude-code', true, cwd), /malformed JSON/);
    await assert.rejects(installClients({ clients: ['claude-code'], preview: true, cwd, origin: 'https://example.com', key: 'dummy', confirmOverwrite: async () => true }), /malformed JSON/);
    assert.equal(readFileSync(join(cwd, '.mcp.json'), 'utf8'), 'not-json');
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { 'talent-summoner-preview': { url: 'custom' } } }));
    await assert.rejects(installClients({ clients: ['claude-code'], preview: true, cwd, origin: 'https://example.com', key: 'dummy', confirmOverwrite: async () => false }), /cancelled/);
    assert.equal(JSON.parse(readFileSync(join(cwd, '.mcp.json'))).mcpServers['talent-summoner-preview'].url, 'custom');
    assert.equal(existsSync(join(cwd, '.gitignore')), false);
  } finally { cleanup(cwd); }
});

test('known preflight and cancellation messages are safe; unknown errors stay generic', () => {
  const malformed = describeSetupFailure(new SetupUserError('malformed-config'));
  assert.match(malformed.message, /malformed JSON/);
  assert.equal(malformed.exitCode, 1);
  const tracked = describeSetupFailure(new SetupUserError('tracked-config'));
  assert.match(tracked.message, /tracked by Git/);
  const cancelled = describeSetupFailure(new SetupUserError('cancelled'));
  assert.deepEqual(cancelled, { message: 'Installation cancelled; nothing changed.', exitCode: 0 });
  const raw = 'raw-error-with-synthetic-fixture';
  assert.equal(describeSetupFailure(new Error(raw)).message.includes(raw), false);
  assert.equal(describeSetupFailure(new SetupVerificationError(raw)).message.includes(raw), false);
});

test('preview project excludes credentials and refuses tracked config', () => {
  const cwd = project();
  try {
    spawnSync('git', ['init', '-q', cwd]);
    protectPreviewProject(cwd, [join(cwd, '.mcp.json')]);
    assert.match(readFileSync(join(cwd, '.gitignore'), 'utf8'), /\/\.mcp\.json/);
    spawnSync('git', ['-C', cwd, 'add', '-f', '.mcp.json']); // absent path does nothing
    writeFileSync(join(cwd, '.mcp.json'), '{}');
    spawnSync('git', ['-C', cwd, 'add', '-f', '.mcp.json']);
    assert.throws(() => protectPreviewProject(cwd, [join(cwd, '.mcp.json')]), /tracked/);
  } finally { cleanup(cwd); }
});

test('skill CLI receives only local source, client and scope flags', async () => {
  const cwd = project();
  try {
    const calls = [];
    await installSkill('claude-code', true, cwd, { origin: 'https://preview.example.com', runner: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(1, 2), ['add']);
    assert.ok(calls[0].args.includes('--copy'));
    assert.ok(calls[0].args.includes('--yes'));
    assert.ok(calls[0].args.includes('--agent'));
    assert.ok(!calls[0].args.includes('--global'));
    assert.ok(!JSON.stringify(calls[0].args).includes('dummy-key'));
    assert.equal(calls[0].options.env.TALENT_SUMMONER_API_KEY, undefined);
    const rendered = await preparePreviewSkill('https://preview.example.com');
    assert.match(readFileSync(join(rendered.skill, 'SKILL.md'), 'utf8'), /name: talent-summoner-preview/);
    assert.match(readFileSync(join(rendered.skill, 'SKILL.md'), 'utf8'), /Never substitute production tools/);
    assert.match(readFileSync(join(rendered.skill, 'SKILL.md'), 'utf8'), /https:\/\/preview.example.com\/api\/mcp/);
    cleanup(rendered.directory);
  } finally { cleanup(cwd); }
});

test('pinned skills executable installs preview copies for both clients and preserves other skills', async () => {
  const cwd = project();
  try {
    mkdirSync(join(cwd, '.agents/skills/custom'), { recursive: true });
    writeFileSync(join(cwd, '.agents/skills/custom/SKILL.md'), 'custom content');
    await installSkill('claude-code', true, cwd, { origin: 'https://preview.example.com' });
    await installSkill('cursor', true, cwd, { origin: 'https://preview.example.com' });
    assert.ok(existsSync(join(cwd, '.claude/skills/talent-summoner-preview/SKILL.md')));
    assert.ok(existsSync(join(cwd, '.agents/skills/talent-summoner-preview/SKILL.md')));
    assert.equal(readFileSync(join(cwd, '.agents/skills/custom/SKILL.md'), 'utf8'), 'custom content');
  } finally { cleanup(cwd); }
});
