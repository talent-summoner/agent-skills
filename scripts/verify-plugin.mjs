/**
 * [INPUT]: Root Claude Code plugin files (.claude-plugin/, .mcp.json, icon), the OpenAI package sources (openai/plugin.json, openai/mcp.json) and the exported skill with skill-source.json.
 * [OUTPUT]: Exit 0 when the marketplace entry, both manifests, both MCP configurations, icon and skill hash agree, the OpenAI files hold no secret-like field and the root carries no package.json; otherwise one line per failure.
 * [POS]: Plugin CI gate beside setup/scripts/verify-package.mjs; also run by the skill-sync workflow before it pushes.
 * [PROTOCOL]: Read-only; no network.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const MCP_URL = 'https://talentsummoner.com/api/mcp';
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
// The OpenAI package declares connection settings only; the client secret and reviewer access go in the portal.
const SECRET_KEY = /secret|password|credential|api_?key|access_?token|refresh_?token|^token$|^headers$|reviewer_instructions/i;
const REPOSITORY = 'https://github.com/talent-summoner/agent-skills';
const SKILL = 'skills/talent-summoner/SKILL.md';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const marketplace = readJson('.claude-plugin/marketplace.json');
const claude = readJson('.claude-plugin/plugin.json');
const mcp = readJson('.mcp.json');
const source = readJson('skill-source.json');

const entry = marketplace.plugins?.find((plugin) => plugin.name === claude.name);
check(entry?.source === './', 'marketplace.json must list the plugin with source "./"');
check(claude.repository === REPOSITORY, `.claude-plugin/plugin.json repository must be ${REPOSITORY}`);
check(existsSync(claude.icon ?? ''), 'plugin.json icon file is missing');
// Claude Code installs npm dependencies for a plugin whose root has a package.json and a lockfile.
check(!existsSync('package.json'), 'Keep package.json out of the plugin root; the npm package lives in setup/');

const servers = Object.entries(mcp.mcpServers ?? {});
check(servers.length === 1, '.mcp.json must define exactly one server');
check(
  servers.every(([, server]) => server.type === 'http' && server.url === MCP_URL),
  `.mcp.json must point at ${MCP_URL} over HTTP`
);

// OpenAI (ChatGPT and Codex) package sources; scripts/build-openai-plugin.mjs zips them with skills/ and assets/.
const openai = readJson('openai/plugin.json');
const openaiMcp = readJson('openai/mcp.json');
const extension = openai.extensions?.['com.openai'] ?? {};
const listing = extension.interface ?? {};
const same = (actual, expected, field) =>
  check(actual === expected, `openai/plugin.json ${field} must match .claude-plugin/plugin.json (${expected})`);
check(openai.$schema === PLUGIN_SCHEMA, `openai/plugin.json $schema must be ${PLUGIN_SCHEMA}`);
same(openai.name, claude.name, 'name');
same(openai.version, claude.version, 'version');
same(openai.homepage, claude.homepage, 'homepage');
same(openai.repository, claude.repository, 'repository');
same(openai.license, claude.license, 'license');
same(openai.author?.name, claude.author?.name, 'author.name');
same(openai.author?.url, claude.author?.url, 'author.url');
same(listing.displayName, claude.displayName, 'interface.displayName');
same(listing.websiteURL, claude.homepage, 'interface.websiteURL');
same(listing.supportURL, claude.supportUrl, 'interface.supportURL');
same(listing.privacyPolicyURL, claude.privacyPolicyUrl, 'interface.privacyPolicyURL');
same(listing.termsOfServiceURL, claude.termsOfServiceUrl, 'interface.termsOfServiceURL');
same(listing.logo, claude.icon, 'interface.logo');
same(listing.composerIcon, claude.icon, 'interface.composerIcon');
// Directory submission limits (developers.openai.com/plugins/deploy/submission-errors).
check((openai.description ?? '').length <= 1024, 'openai/plugin.json description must be 1,024 characters or fewer');
for (const field of ['displayName', 'shortDescription']) {
  check(/^[^\n]{1,30}$/.test(listing[field] ?? ''), `openai/plugin.json interface.${field} must be one line of 1-30 characters`);
}
const prompts = [listing.defaultPrompt ?? []].flat();
check(prompts.length <= 3 && prompts.every((prompt) => prompt.length <= 128), 'interface.defaultPrompt allows 3 prompts of 128 characters');
check(!('apps' in extension) && !('hooks' in extension), 'Directory submissions reject apps and hooks in openai/plugin.json');

const claudeServerNames = servers.map(([name]) => name);
const openaiServers = Object.entries(openaiMcp.mcpServers ?? {});
check(openaiMcp.$schema === MCP_SCHEMA, `openai/mcp.json $schema must be ${MCP_SCHEMA}`);
check(
  openaiServers.length === 1 && openaiServers[0][0] === claudeServerNames[0],
  'openai/mcp.json must define the same single server as .mcp.json'
);
const [, openaiServer] = openaiServers[0] ?? [];
check(
  openaiServer?.type === 'streamable-http' && openaiServer.url === MCP_URL,
  `openai/mcp.json must point at ${MCP_URL} over streamable-http`
);
// ChatGPT discovers our OAuth server and signs in with its Client ID Metadata
// Document (CIMD), so the package declares no client and carries no credentials.
check(
  openaiServer?.extensions?.['com.openai']?.auth === undefined,
  'openai/mcp.json must not declare an OAuth client; ChatGPT uses CIMD discovery'
);
const secretFields = (value, path) =>
  value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => [
        ...(SECRET_KEY.test(key) ? [`${path}.${key}`] : []),
        ...secretFields(child, `${path}.${key}`),
      ])
    : [];
for (const field of [...secretFields(openai, 'openai/plugin.json'), ...secretFields(openaiMcp, 'openai/mcp.json')]) {
  check(false, `${field} looks like a secret or credential; enter it in the OpenAI portal instead`);
}

const skillHash = createHash('sha256').update(readFileSync(SKILL)).digest('hex');
check(skillHash === source.sha256, `${SKILL} does not match skill-source.json`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(`Verified plugin ${claude.name}@${claude.version}: Claude and OpenAI manifests, MCP servers and skill hash.`);
