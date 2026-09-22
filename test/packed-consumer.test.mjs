/*
[INPUT]: Built npm package and disposable consumer/profile directories.
[OUTPUT]: Proof that a hoisted tarball install resolves skills and writes its actual global targets.
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

test('packed executable works with skills hoisted outside the scoped package', { timeout: 120000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-setup-packed-'));
  const consumer = join(root, 'consumer');
  const profile = join(root, 'profile');
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
      const results = await installClients({ clients: ['claude-code', 'cursor'], preview: false,
        origin: 'https://example.com', key: 'synthetic-fixture', confirmOverwrite: async () => true });
      if (results.some((result) => !result.success)) throw new Error('fixture install failed');
      console.log(JSON.stringify({ claude: targetPaths('claude-code', false), cursor: targetPaths('cursor', false) }));`;
    const env = { HOME: profile, PATH: process.env.PATH, CLAUDE_CONFIG_DIR: join(profile, 'isolated-claude') };
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: consumer, env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const targets = JSON.parse(child.stdout);
    assert.equal(targets.claude.skill, join(profile, 'isolated-claude/skills/talent-summoner'));
    assert.equal(targets.cursor.skill, join(profile, '.agents/skills/talent-summoner'));
    assert.equal(targets.claude.config, join(profile, '.claude.json'));
    assert.equal(targets.cursor.config, join(profile, '.cursor/mcp.json'));
    for (const target of Object.values(targets)) {
      assert.equal(existsSync(join(target.skill, 'SKILL.md')), true);
      assert.equal(JSON.parse(readFileSync(target.config, 'utf8')).mcpServers['talent-summoner'].headers.Authorization, 'Bearer synthetic-fixture');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
