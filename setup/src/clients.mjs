/*
[INPUT]: Pinned add-mcp@2.4.0 catalog/discovery and skills@1.7.0 CLI compatibility.
[OUTPUT]: Supported client choices, explicit skill aliases and expected skill destinations.
[POS]: Small compatibility layer for the skill CLI's missing catalog/path API.
[PROTOCOL]: Keep IDs and non-universal paths in sync with the pinned skills release; MCP paths come from add-mcp.
*/
import { agents, detectGlobalAgents, detectProjectAgents } from 'add-mcp';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const skillIds = new Set([
  'antigravity', 'claude-code', 'cline', 'codex', 'cursor', 'gemini-cli',
  'github-copilot', 'goose', 'grok', 'kilo', 'kimi-code-cli', 'kiro-cli',
  'opencode', 'pi', 'windsurf', 'zed',
]);
const aliases = Object.freeze({
  'cline-cli': 'cline',
  'github-copilot-cli': 'github-copilot',
  'grok-build': 'grok',
  'kilo-code': 'kilo',
  'kimi-code': 'kimi-code-cli',
  vscode: 'github-copilot',
});
// skills@1.7.0 sends universal agents to .agents/skills even when their catalog declares another globalSkillsDir.
const nonUniversal = Object.freeze({
  'claude-code': { project: '.claude/skills', global: (home, cwd) => resolve(cwd, process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'), 'skills') },
  goose: { project: '.goose/skills', global: (home) => join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'goose/skills') },
  grok: { project: '.grok/skills', global: (home, cwd) => resolve(cwd, process.env.GROK_HOME?.trim() || join(home, '.grok'), 'skills') },
  'kiro-cli': { project: '.kiro/skills', global: (home) => join(home, '.kiro/skills') },
  pi: { project: '.pi/skills', global: (home) => join(home, '.pi/agent/skills') },
  windsurf: { project: '.windsurf/skills', global: (home) => join(home, '.codeium/windsurf/skills') },
});

export function skillAgent(client) {
  return aliases[client] || client;
}

export function compatibleClients(preview = false) {
  return Object.entries(agents)
    .filter(([id, agent]) => id !== 'fx' && skillIds.has(skillAgent(id)) &&
      agent.supportedTransports.includes('http') && (!preview || agent.localConfigPath))
    .map(([id, agent]) => ({ id, name: agent.displayName, skill: skillAgent(id) }));
}

export async function clientChoices(preview, cwd = process.cwd(), discovery = { global: detectGlobalAgents, project: detectProjectAgents }) {
  const [global, project] = await Promise.allSettled([
    discovery.global(), preview ? discovery.project(cwd) : Promise.resolve([]),
  ]);
  const detected = new Set([
    ...(global.status === 'fulfilled' ? global.value : []),
    ...(project.status === 'fulfilled' ? project.value : []),
  ]);
  return compatibleClients(preview).map(({ id, name }) => ({ name, value: id, checked: detected.has(id) }));
}

export function skillPath(client, preview, cwd = process.cwd()) {
  const skill = skillAgent(client);
  if (!skillIds.has(skill)) throw new Error('Unsupported skill client.');
  const home = homedir();
  const specific = nonUniversal[skill];
  const base = preview
    ? join(cwd, specific?.project || '.agents/skills')
    : specific ? specific.global(home, cwd) : join(home, '.agents/skills');
  return join(base, preview ? 'talent-summoner-preview' : 'talent-summoner');
}
