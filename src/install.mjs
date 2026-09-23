/*
[INPUT]: Verified connection, chosen clients, bundled skill, and explicit replacement decision.
[OUTPUT]: Native private MCP entries and copied client skills with per-client results and physical destination checks.
[POS]: Client-neutral installer orchestration over pinned add-mcp and skills APIs.
[PROTOCOL]: Preflight all targets; never put credentials in subprocess arguments, environment, or output.
*/
import { agents, upsertServer } from 'add-mcp';
import { parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml } from '@iarna/toml';
import { load as parseYaml } from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, mkdirSync, openSync, closeSync, chmodSync, appendFileSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseOrigin, SetupVerificationError } from './verify.mjs';
import { compatibleClients, skillAgent, skillPath } from './clients.mjs';

const USER_MESSAGES = Object.freeze({
  'unsafe-target': 'The displayed configuration path is a symlink or unexpected file type. Check it before retrying.',
  'malformed-config': 'The displayed MCP configuration is malformed. Repair it before retrying.',
  'unrecognized-config': 'The displayed MCP configuration has an unrecognized layout. Check it before retrying.',
  'unexpected-skill': 'The displayed skill target is not a directory. Check it before retrying.',
  'tracked-config': 'The project MCP configuration is tracked by Git. Remove it from the index before installing a key.',
  'shared-config': 'Claude Code and Copilot CLI need a shared .mcp.json here. Move the servers from .github/mcp.json into .mcp.json under mcpServers, then retry.',
  'private-config': 'Could not restrict access to the displayed MCP configuration file. Check its permissions and retry.',
  cancelled: 'Installation cancelled; nothing changed.',
});
const GENERIC_MESSAGE = 'Setup could not finish. Check the selected AI agent configuration and permissions, then retry.';
const VERIFICATION_MESSAGES = new Set([
  'MCP verification failed or the seven expected tools were unavailable. Check the endpoint and retry.',
  'MCP redirected to another origin; no credentials were sent there.',
  'MCP redirected unexpectedly. Check the website origin.',
  'The API key was rejected. Create a key on the displayed website origin and retry.',
  'The deployment appears protected. Use its preview protection bypass secret, or check access to the preview URL.',
]);
export class SetupUserError extends Error {
  constructor(code) {
    super(USER_MESSAGES[code] || GENERIC_MESSAGE);
    this.code = code;
  }
}

export function describeSetupFailure(error) {
  if (error instanceof SetupUserError && Object.hasOwn(USER_MESSAGES, error.code)) {
    return { message: error.message, exitCode: error.code === 'cancelled' ? 0 : 1 };
  }
  if (error instanceof SetupVerificationError && VERIFICATION_MESSAGES.has(error.message)) {
    return { message: error.message, exitCode: 1 };
  }
  return { message: GENERIC_MESSAGE, exitCode: 1 };
}
const bundledSkill = fileURLToPath(new URL('../skills/talent-summoner/SKILL.md', import.meta.url));
const require = createRequire(import.meta.url);
const skillsPackagePath = require.resolve('skills/package.json');
const skillsBin = join(dirname(skillsPackagePath), JSON.parse(readFileSync(skillsPackagePath, 'utf8')).bin.skills);

export function targetPaths(client, preview, cwd = process.cwd()) {
  if (!compatibleClients(preview).some(({ id }) => id === client)) throw new Error('Unsupported client or scope.');
  const agent = agents[client];
  const options = { local: preview, cwd };
  const config = agent.resolveConfigPath?.(agent, options) || (preview ? join(cwd, agent.localConfigPath) : agent.configPath);
  return { config, skill: skillPath(client, preview, cwd) };
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseConfig(path, format) {
  if (!existsSync(path)) return {};
  const source = readFileSync(path, 'utf8');
  if (!source.trim()) return {};
  try {
    let parsed;
    if (format === 'json') {
      const errors = [];
      parsed = parseJsonc(source, errors, { allowTrailingComma: true });
      if (errors.length) throw new Error('Invalid JSONC');
    } else if (format === 'toml') parsed = parseToml(source);
    else if (format === 'yaml') parsed = parseYaml(source);
    else throw new Error('Unsupported format');
    if (!object(parsed)) throw new SetupUserError('unrecognized-config');
    return parsed;
  } catch (error) {
    if (error instanceof SetupUserError) throw error;
    throw new SetupUserError('malformed-config');
  }
}

function serverMap(client, preview, current) {
  if (client === 'opencode') {
    if (current.mcp === undefined) return {};
    if (!object(current.mcp)) throw new SetupUserError('unrecognized-config');
    const nested = current.mcp.servers;
    if (nested !== undefined && !object(nested)) throw new SetupUserError('unrecognized-config');
    return { ...current.mcp, ...(nested && !('type' in nested || 'url' in nested || 'command' in nested) ? nested : {}) };
  }
  if (client === 'github-copilot-cli' && preview && current.mcpServers === undefined) {
    const values = Object.values(current);
    if (values.length && values.every((value) => object(value) &&
      ['command', 'url', 'type'].some((key) => typeof value[key] === 'string'))) return current;
    if (object(current.servers) && Object.values(current.servers).some((value) => object(value) &&
      ['command', 'url', 'type'].some((key) => typeof value[key] === 'string'))) {
      throw new SetupUserError('unrecognized-config');
    }
  }
  const agent = agents[client];
  const keys = (preview && agent.localConfigKey || agent.configKey).split('.');
  let value = current;
  for (const key of keys) {
    if (value[key] === undefined) return {};
    value = value[key];
    if (!object(value)) throw new SetupUserError('unrecognized-config');
  }
  return value;
}

function regularFileOrAbsent(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new SetupUserError('unsafe-target');
}

export function inspectTarget(client, preview, cwd = process.cwd()) {
  const paths = targetPaths(client, preview, cwd);
  regularFileOrAbsent(paths.config);
  const current = parseConfig(paths.config, agents[client].format);
  const entries = serverMap(client, preview, current);
  if (existsSync(paths.skill) && !lstatSync(paths.skill).isDirectory()) throw new SetupUserError('unexpected-skill');
  return { ...paths, existingServer: Object.hasOwn(entries, preview ? 'talent-summoner-preview' : 'talent-summoner'), existingSkill: existsSync(paths.skill) };
}

function setPrivateConfigAccess(path) {
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600);
    return;
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$path = $env:TALENT_SUMMONER_CONFIG_PATH',
    '$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User',
    '$acl = Get-Acl -LiteralPath $path',
    '$acl.SetAccessRuleProtection($true, $false)',
    'foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }',
    '$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))',
    'Set-Acl -LiteralPath $path -AclObject $acl',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, TALENT_SUMMONER_CONFIG_PATH: path },
    stdio: 'ignore', windowsHide: true,
  });
  if (result.status !== 0) throw new SetupUserError('private-config');
}

function protectConfig(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600));
  setPrivateConfigAccess(path);
}

function git(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'ignore' }).status === 0;
}

export function protectPreviewProject(cwd, configPaths) {
  const entries = configPaths.map((path) => {
    const relativePath = relative(cwd, path);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new SetupUserError('unsafe-target');
    return `/${relativePath.split(sep).join('/')}`;
  });
  if (git(cwd, ['rev-parse', '--is-inside-work-tree'])) {
    for (const path of configPaths) {
      if (git(cwd, ['ls-files', '--error-unmatch', '--', path])) {
        throw new SetupUserError('tracked-config');
      }
    }
  }
  const ignore = join(cwd, '.gitignore');
  regularFileOrAbsent(ignore);
  const content = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  const missing = entries.filter((entry) => !content.split(/\r?\n/).includes(entry));
  if (missing.length) appendFileSync(ignore, `${content && !content.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

export async function preparePreviewSkill(origin) {
  const previewOrigin = parseOrigin(origin);
  const directory = await mkdtemp(join(tmpdir(), 'talent-summoner-skill-'));
  const skill = join(directory, 'talent-summoner-preview');
  mkdirSync(skill, { mode: 0o700 });
  const source = await readFile(bundledSkill, 'utf8');
  if (!source.startsWith('---\nname: talent-summoner\n')) throw new Error('Bundled skill has an unexpected frontmatter.');
  const rendered = source.replace('name: talent-summoner\n', 'name: talent-summoner-preview\n').replace(
    '\n# Talent Summoner\n',
    `\n# Talent Summoner Preview\n\nThis skill is for the current project preview only. Use only the \`talent-summoner-preview\` MCP server at ${previewOrigin}/api/mcp. Before any sourcing or Role action, confirm that this preview server is connected. If only production tools are available, stop and ask the user to reconnect the preview server. Never substitute production tools.\n`,
  );
  await writeFile(join(skill, 'SKILL.md'), rendered, { mode: 0o600 });
  return { directory, skill };
}

export async function installSkill(client, preview, cwd = process.cwd(), { runner = spawnSync, origin } = {}) {
  let prepared;
  try {
    if (preview) prepared = await preparePreviewSkill(origin);
    const source = prepared?.skill || dirname(bundledSkill);
    const args = [skillsBin, 'add', source, '--agent', skillAgent(client), '--copy', '--yes', '--json'];
    if (!preview) args.push('--global');
    const allowedEnv = ['HOME', 'PATH', 'TMPDIR', 'TMP', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'CLAUDE_CONFIG_DIR', 'GROK_HOME', 'LANG', 'LC_ALL',
      'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'];
    const env = Object.fromEntries(allowedEnv.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
    const result = runner(process.execPath, args, { cwd, stdio: 'pipe', encoding: 'utf8', env });
    if (result.status !== 0) throw new Error('Skill installation failed. Check client permissions and retry.');
    let records;
    try { records = JSON.parse(result.stdout); } catch { throw new Error('Skill installation result was invalid.'); }
    const expected = targetPaths(client, preview, cwd).skill;
    if (!Array.isArray(records) || !records.some((record) => record.name === (preview ? 'talent-summoner-preview' : 'talent-summoner') &&
      record.status === 'installed' && realpathSync(resolve(cwd, record.path)) === realpathSync(expected))) throw new Error('Skill installation path did not match the protected target.');
  } finally {
    if (prepared) await rm(prepared.directory, { recursive: true, force: true });
  }
}

export async function installClients({ clients, preview, cwd = process.cwd(), origin, key, bypass, confirmOverwrite, skillInstaller = installSkill, serverInstaller = upsertServer }) {
  const name = preview ? 'talent-summoner-preview' : 'talent-summoner';
  if (preview && clients.includes('claude-code') && existsSync(join(cwd, '.github/mcp.json')) && !existsSync(join(cwd, '.mcp.json'))) {
    throw new SetupUserError('shared-config');
  }
  const inspected = clients.map((client) => ({ client, ...inspectTarget(client, preview, cwd) }));
  const replacements = inspected.filter((target) => target.existingServer || target.existingSkill);
  if (replacements.length && !(await confirmOverwrite(replacements))) throw new SetupUserError('cancelled');
  if (preview) protectPreviewProject(cwd, inspected.map((target) => target.config));
  const results = [];
  for (const target of inspected) {
    let mcpConfigured = false;
    try {
      if (targetPaths(target.client, preview, cwd).config !== target.config) throw new Error('Configuration target changed during setup.');
      protectConfig(target.config);
      const headers = { Authorization: `Bearer ${key}` };
      if (bypass) headers['x-vercel-protection-bypass'] = bypass;
      const result = serverInstaller(target.client, name, { type: 'http', url: `${origin}/api/mcp`, headers }, { local: preview, cwd });
      if (!result.success) throw new Error('Native MCP configuration failed.');
      mcpConfigured = true;
      if (resolve(result.path) !== resolve(target.config) || result.extraPaths?.length) throw new Error('Unexpected native configuration path.');
      setPrivateConfigAccess(target.config);
    } catch {
      results.push({ client: target.client, success: false, mcpConfigured, status: mcpConfigured ? 'mcp-configured-setup-incomplete' : 'mcp-not-configured', config: target.config, skill: target.skill });
      continue;
    }
    try {
      await skillInstaller(target.client, preview, cwd, { origin });
      results.push({ client: target.client, success: true, mcpConfigured: true, status: 'installed', config: target.config, skill: target.skill });
    } catch {
      results.push({ client: target.client, success: false, mcpConfigured: true, status: 'mcp-configured-skill-failed', config: target.config, skill: target.skill });
    }
  }
  return results;
}
