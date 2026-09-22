/*
[INPUT]: Built npm package and disposable consumer/profile directories.
[OUTPUT]: Proof that a hoisted tarball install resolves skills and writes five native project targets.
[POS]: Installed-artifact regression, beyond source-tree imports.
[PROTOCOL]: No real client profile or credential; ignore dependency lifecycle scripts.
*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('packed executable works for five clients with skills hoisted outside the scoped package', { timeout: 120000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-setup-packed-'));
  const consumer = join(root, 'consumer');
  const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^npm_/i.test(name)));
  const runNpm = (args) => process.env.npm_execpath
    ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], { encoding: 'utf8', env: npmEnv })
    : execFileSync('npm', args, { encoding: 'utf8', env: npmEnv });
  try {
    const packResult = JSON.parse(runNpm(['pack', '.', '--json', `--pack-destination=${root}`]));
    const packed = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0];
    runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumer, join(root, packed.filename)]);
    const installed = join(consumer, 'node_modules/@talent-summoner/setup');
    assert.equal(existsSync(join(installed, 'node_modules/skills')), false);
    assert.equal(existsSync(join(consumer, 'node_modules/skills/package.json')), true);
    const help = spawnSync(process.execPath, [join(installed, 'dist/setup.mjs'), '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--preview/);
    const moduleUrl = pathToFileURL(join(installed, 'dist/install.mjs')).href;
    const script = `import { installClients, targetPaths } from ${JSON.stringify(moduleUrl)};
      const clients = ['claude-code', 'github-copilot-cli', 'opencode', 'codex', 'cursor'];
      const results = await installClients({ clients, preview: true, cwd: process.cwd(),
        origin: 'https://example.com', key: 'synthetic-fixture', confirmOverwrite: async () => true });
      if (results.some((result) => !result.success)) throw new Error(JSON.stringify(results.map(({ client, status }) => ({ client, status }))));
      console.log(JSON.stringify(Object.fromEntries(clients.map((client) => [client, targetPaths(client, true, process.cwd())]))));`;
    const env = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: consumer, env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const targets = JSON.parse(child.stdout);
    assert.equal(targets['claude-code'].config, join(consumer, '.mcp.json'));
    assert.equal(targets['github-copilot-cli'].config, join(consumer, '.mcp.json'));
    assert.equal(targets.opencode.config, join(consumer, 'opencode.jsonc'));
    assert.equal(targets.codex.config, join(consumer, '.codex/config.toml'));
    assert.equal(targets.cursor.config, join(consumer, '.cursor/mcp.json'));
    for (const target of Object.values(targets)) {
      assert.equal(existsSync(join(target.skill, 'SKILL.md')), true);
      assert.match(readFileSync(target.config, 'utf8'), /Bearer synthetic-fixture/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
