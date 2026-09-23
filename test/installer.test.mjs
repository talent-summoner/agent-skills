/*
[INPUT]: Temporary projects, synthetic keys, and stub HTTP MCP responses.
[OUTPUT]: Regression proof for native config merging, private files, safe failures, skill invocation and aliased project paths.
[POS]: Installer integration tests without touching a real client profile or paid tool.
[PROTOCOL]: Use disposable roots and inspect only synthetic credentials.
*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describeSetupFailure, installClients, installSkill, inspectTarget, protectPreviewProject, preparePreviewSkill, setPrivateConfigAccess, targetPaths, SetupUserError } from '../src/install.mjs';
import { clientChoices, compatibleClients, skillAgent } from '../src/clients.mjs';
import { parse as parseToml } from '@iarna/toml';
import { parse as parseJsonc } from 'jsonc-parser';
import { EXPECTED_TOOLS, parseOrigin, verifyConnection, SetupVerificationError } from '../src/verify.mjs';

function project() { return mkdtempSync(join(tmpdir(), 'ts-setup-test-')); }
function cleanup(path) { rmSync(path, { recursive: true, force: true }); }
function assertPrivateConfig(path) {
  if (process.platform !== 'win32') {
    assert.equal(statSync(path).mode & 0o777, 0o600, path);
    return;
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$acl = [IO.File]::GetAccessControl($env:TALENT_SUMMONER_TEST_CONFIG_PATH)',
    'if (-not $acl.AreAccessRulesProtected) { exit 1 }',
    '$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))',
    'if ($rules.Count -eq 0) { exit 1 }',
    'foreach ($rule in $rules) { if ($rule.IdentityReference.Value -ne $sid -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { exit 1 } }',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, TALENT_SUMMONER_TEST_CONFIG_PATH: path },
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, `${path}: ${result.stderr || result.error || 'unexpected ACL'}`);
}

if (process.platform === 'win32') test('Windows restricts existing configuration file ACLs', () => {
  const cwd = project();
  try {
    const config = join(cwd, '.mcp.json');
    writeFileSync(config, '{}');
    try { setPrivateConfigAccess(config); }
    catch (error) { assert.fail(`ACL update failed: ${error.cause || error}`); }
    assertPrivateConfig(config);
  } finally { cleanup(cwd); }
});

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
    for (const path of [join(cwd, '.mcp.json'), join(cwd, '.cursor/mcp.json')]) assertPrivateConfig(path);
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
    assert.throws(() => inspectTarget('claude-code', true, cwd), /malformed/);
    await assert.rejects(installClients({ clients: ['claude-code'], preview: true, cwd, origin: 'https://example.com', key: 'dummy', confirmOverwrite: async () => true }), /malformed/);
    assert.equal(readFileSync(join(cwd, '.mcp.json'), 'utf8'), 'not-json');
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { 'talent-summoner-preview': { url: 'custom' } } }));
    await assert.rejects(installClients({ clients: ['claude-code'], preview: true, cwd, origin: 'https://example.com', key: 'dummy', confirmOverwrite: async () => false }), /cancelled/);
    assert.equal(JSON.parse(readFileSync(join(cwd, '.mcp.json'))).mcpServers['talent-summoner-preview'].url, 'custom');
    assert.equal(existsSync(join(cwd, '.gitignore')), false);
  } finally { cleanup(cwd); }
});

test('known preflight and cancellation messages are safe; unknown errors stay generic', () => {
  const malformed = describeSetupFailure(new SetupUserError('malformed-config'));
  assert.match(malformed.message, /malformed/);
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
      mkdirSync(join(cwd, '.claude/skills/talent-summoner-preview'), { recursive: true });
      return { status: 0, stdout: JSON.stringify([{ name: 'talent-summoner-preview', status: 'installed', path: join(cwd, '.claude/skills/talent-summoner-preview') }]) };
    } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(1, 2), ['add']);
    assert.ok(calls[0].args.includes('--copy'));
    assert.ok(calls[0].args.includes('--yes'));
    assert.ok(calls[0].args.includes('--agent'));
    assert.ok(calls[0].args.includes('--json'));
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

test('configured relative skill homes reach the pinned CLI and match the protected destination', async () => {
  const cwd = project();
  const previous = { GROK_HOME: process.env.GROK_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  try {
    for (const [client, variable, directory] of [
      ['grok-build', 'GROK_HOME', 'grok-profile'],
      ['claude-code', 'CLAUDE_CONFIG_DIR', 'claude-profile'],
    ]) {
      process.env[variable] = `./${directory}`;
      let forwarded;
      await installSkill(client, false, cwd, { runner: (command, args, options) => {
        forwarded = options.env[variable];
        return spawnSync(command, args, options);
      } });
      assert.equal(forwarded, `./${directory}`);
      assert.ok(existsSync(join(cwd, directory, 'skills/talent-summoner/SKILL.md')), client);
      delete process.env[variable];
    }
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    cleanup(cwd);
  }
});

test('pinned skill CLI accepts a project reached through a filesystem alias', async () => {
  const root = project();
  const physical = join(root, 'physical');
  const alias = join(root, 'alias');
  try {
    mkdirSync(physical);
    symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
    for (const client of ['claude-code', 'cursor']) {
      await installSkill(client, true, alias, { origin: 'https://preview.example.com' });
      assert.ok(existsSync(join(targetPaths(client, true, physical).skill, 'SKILL.md')));
    }
  } finally { cleanup(root); }
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

test('every offered preview client receives authenticated native config and a copied skill', async () => {
  const cwd = project();
  try {
    const clients = compatibleClients(true).map(({ id }) => id);
    const results = await installClients({
      clients, preview: true, cwd, origin: 'https://preview.example.com', key: 'synthetic-fixture',
      confirmOverwrite: async () => true,
    });
    assert.equal(results.length, clients.length);
    for (const result of results) {
      assert.equal(result.status, 'installed', result.client);
      assertPrivateConfig(result.config);
      assert.match(readFileSync(result.config, 'utf8'), /Bearer synthetic-fixture/, result.client);
      assert.ok(existsSync(join(result.skill, 'SKILL.md')), result.client);
    }
  } finally { cleanup(cwd); }
});

test('upstream discovery preselects compatible clients and leaves manual choices when none are found', async () => {
  const all = compatibleClients(false).map(({ id }) => id);
  const preview = compatibleClients(true).map(({ id }) => id);
  for (const id of ['claude-code', 'github-copilot-cli', 'opencode', 'codex', 'cursor', 'vscode', 'goose']) assert.ok(all.includes(id));
  for (const id of ['claude-code', 'github-copilot-cli', 'opencode', 'codex', 'cursor', 'vscode']) assert.ok(preview.includes(id));
  for (const id of ['goose', 'fx', 'claude-desktop']) assert.ok(!preview.includes(id));
  assert.ok(!all.includes('fx'));
  assert.equal(skillAgent('github-copilot-cli'), 'github-copilot');
  assert.equal(skillAgent('vscode'), 'github-copilot');
  const mixed = await clientChoices(true, '/tmp/fixture', {
    global: async () => ['cursor', 'goose', 'fx'],
    project: () => ['opencode', 'claude-desktop'],
  });
  assert.deepEqual(mixed.filter((choice) => choice.checked).map((choice) => choice.value).sort(), ['cursor', 'opencode']);
  const none = await clientChoices(false, '/tmp/fixture', { global: async () => [], project: () => [] });
  assert.ok(none.length > 5);
  assert.ok(none.every((choice) => !choice.checked));
  const failedDiscovery = await clientChoices(false, '/tmp/fixture', { global: async () => { throw new Error('not installed'); }, project: () => [] });
  assert.ok(failedDiscovery.every((choice) => !choice.checked));
});

test('native VS Code, Codex and OpenCode project formats preserve unrelated entries and protect credentials', async () => {
  for (const client of ['vscode', 'codex', 'opencode']) {
    const cwd = project();
    try {
      const config = client === 'vscode' ? join(cwd, '.vscode/mcp.json') : client === 'codex' ? join(cwd, '.codex/config.toml') : join(cwd, 'opencode.jsonc');
      mkdirSync(join(cwd, client === 'vscode' ? '.vscode' : client === 'codex' ? '.codex' : '.'), { recursive: true });
      const seed = client === 'vscode'
        ? '{ // keep comment\n "custom": true, "servers": {"other": {"command": "local"}}\n}'
        : client === 'codex'
          ? '[mcp_servers.other]\ncommand = "local"\n[custom]\nkeep = true\n'
          : '{ // keep comment\n "custom": true, "mcp": {"other": {"type":"local","command":["local"]}}\n}';
      writeFileSync(config, seed, { mode: 0o644 });
      const options = { clients: [client], preview: true, cwd, origin: 'https://preview.example.com', key: 'synthetic-fixture', confirmOverwrite: async () => true, skillInstaller: async () => {} };
      const first = await installClients(options);
      assert.equal(first[0].status, 'installed', client);
      assert.equal(first[0].config, config);
      assertPrivateConfig(config);
      const updated = readFileSync(config, 'utf8');
      const parsed = client === 'codex' ? parseToml(updated) : parseJsonc(updated);
      const servers = client === 'vscode' ? parsed.servers : client === 'codex' ? parsed.mcp_servers : parsed.mcp;
      assert.ok(servers.other, client);
      const entry = servers['talent-summoner-preview'];
      assert.equal(client === 'codex' ? entry.http_headers.Authorization : entry.headers.Authorization, 'Bearer synthetic-fixture');
      assert.equal(client === 'codex' ? parsed.custom.keep : parsed.custom, true);
      assert.match(readFileSync(join(cwd, '.gitignore'), 'utf8'), new RegExp(`/${client === 'vscode' ? '\\.vscode/mcp\\.json' : client === 'codex' ? '\\.codex/config\\.toml' : 'opencode\\.jsonc'}`));
      const second = await installClients(options);
      assert.equal(second[0].status, 'installed', client);
      assert.deepEqual(Object.keys(client === 'vscode' ? parseJsonc(readFileSync(config, 'utf8')).servers : client === 'codex' ? parseToml(readFileSync(config, 'utf8')).mcp_servers : parseJsonc(readFileSync(config, 'utf8')).mcp).sort(), ['other', 'talent-summoner-preview']);
    } finally { cleanup(cwd); }
  }
});

test('malformed native formats, custom skill content and tracked preview config stop before credential writes', async () => {
  for (const [client, relativePath, malformed] of [
    ['vscode', '.vscode/mcp.json', '{ "servers": [] }'],
    ['codex', '.codex/config.toml', '[mcp_servers'],
    ['opencode', 'opencode.jsonc', '{ "mcp": [] }'],
  ]) {
    const cwd = project();
    try {
      const config = join(cwd, relativePath);
      mkdirSync(join(cwd, client === 'vscode' ? '.vscode' : client === 'codex' ? '.codex' : '.'), { recursive: true });
      writeFileSync(config, malformed);
      const options = { clients: [client], preview: true, cwd, origin: 'https://preview.example.com', key: 'synthetic-fixture', confirmOverwrite: async () => true, skillInstaller: async () => {} };
      await assert.rejects(installClients(options), /malformed|unrecognized/);
      assert.equal(readFileSync(config, 'utf8'), malformed);
      assert.equal(existsSync(join(cwd, '.gitignore')), false);
      const emptyConfig = client === 'codex' ? '# empty config\n' : '{}';
      writeFileSync(config, emptyConfig);
      const skill = inspectTarget(client, true, cwd).skill;
      mkdirSync(skill, { recursive: true });
      writeFileSync(join(skill, 'SKILL.md'), 'custom content');
      await assert.rejects(installClients({ ...options, confirmOverwrite: async () => false }), /cancelled/);
      assert.equal(readFileSync(join(skill, 'SKILL.md'), 'utf8'), 'custom content');
      spawnSync('git', ['init', '-q', cwd]);
      spawnSync('git', ['-C', cwd, 'add', '-f', relativePath]);
      await assert.rejects(installClients(options), /tracked by Git/);
      assert.equal(readFileSync(config, 'utf8'), emptyConfig);
    } finally { cleanup(cwd); }
  }
});

test('Claude and Copilot CLI share .mcp.json with exact protected writer paths', async () => {
  const cwd = project();
  try {
    const config = join(cwd, '.mcp.json');
    writeFileSync(config, JSON.stringify({ mcpServers: { other: { command: 'local' } } }), { mode: 0o644 });
    const clients = ['claude-code', 'github-copilot-cli'];
    assert.equal(targetPaths(clients[0], true, cwd).config, config);
    assert.equal(targetPaths(clients[1], true, cwd).config, config);
    const results = await installClients({ clients, preview: true, cwd, origin: 'https://preview.example.com', key: 'synthetic-fixture', confirmOverwrite: async () => true, skillInstaller: async () => {} });
    assert.ok(results.every((result) => result.success));
    assert.ok(results.every((result) => result.config === config));
    assertPrivateConfig(config);
    const parsed = JSON.parse(readFileSync(config, 'utf8'));
    assert.deepEqual(parsed.mcpServers.other, { command: 'local' });
    assert.equal(parsed.mcpServers['talent-summoner-preview'].headers.Authorization, 'Bearer synthetic-fixture');
    assert.deepEqual(Object.keys(parsed.mcpServers).sort(), ['other', 'talent-summoner-preview']);
  } finally { cleanup(cwd); }
});

test('Copilot CLI uses legacy .github/mcp.json alone; Claude shared-path conflict stops before writes', async () => {
  const cwd = project();
  try {
    const legacy = join(cwd, '.github/mcp.json');
    mkdirSync(join(cwd, '.github'));
    writeFileSync(legacy, JSON.stringify({ mcpServers: { other: { command: 'local' } } }), { mode: 0o644 });
    assert.equal(targetPaths('github-copilot-cli', true, cwd).config, legacy);
    const options = { preview: true, cwd, origin: 'https://preview.example.com', key: 'synthetic-fixture', confirmOverwrite: async () => true, skillInstaller: async () => {} };
    await assert.rejects(installClients({ ...options, clients: ['claude-code', 'github-copilot-cli'] }), /shared \.mcp\.json/);
    assert.equal(existsSync(join(cwd, '.mcp.json')), false);
    if (process.platform !== 'win32') assert.equal(statSync(legacy).mode & 0o777, 0o644);
    const results = await installClients({ ...options, clients: ['github-copilot-cli'] });
    assert.equal(results[0].status, 'installed');
    assert.equal(results[0].config, legacy);
    assertPrivateConfig(legacy);
    assert.equal(JSON.parse(readFileSync(legacy, 'utf8')).mcpServers['talent-summoner-preview'].headers.Authorization, 'Bearer synthetic-fixture');
    assert.match(readFileSync(join(cwd, '.gitignore'), 'utf8'), /\/\.github\/mcp\.json/);
  } finally { cleanup(cwd); }
});

test('Copilot CLI refuses a VS Code servers wrapper before changing its project file', async () => {
  const cwd = project();
  try {
    const config = join(cwd, '.mcp.json');
    const original = JSON.stringify({ servers: { remote: { url: 'https://example.com/mcp' } } });
    writeFileSync(config, original, { mode: 0o644 });
    await assert.rejects(installClients({
      clients: ['github-copilot-cli'], preview: true, cwd,
      origin: 'https://preview.example.com', key: 'synthetic-fixture',
      confirmOverwrite: async () => true, skillInstaller: async () => {},
    }), /unrecognized layout/);
    assert.equal(readFileSync(config, 'utf8'), original);
    if (process.platform !== 'win32') assert.equal(statSync(config).mode & 0o777, 0o644);
    assert.equal(existsSync(join(cwd, '.gitignore')), false);
  } finally { cleanup(cwd); }
});
