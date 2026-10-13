import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const MCP_URL = 'https://talentsummoner.com/api/mcp';
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

const servers = Object.entries(mcp.mcpServers ?? {});
check(servers.length === 1, '.mcp.json must define exactly one server');
check(
  servers.every(([, server]) => server.type === 'http' && server.url === MCP_URL),
  `.mcp.json must point at ${MCP_URL} over HTTP`
);

const skillHash = createHash('sha256').update(readFileSync(SKILL)).digest('hex');
check(skillHash === source.sha256, `${SKILL} does not match skill-source.json`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(`Verified plugin ${claude.name}@${claude.version}: manifests, MCP server and skill hash.`);
