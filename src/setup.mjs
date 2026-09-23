#!/usr/bin/env node
/*
[INPUT]: One upstream-backed client selection, website origin, and masked secrets.
[OUTPUT]: Terminal-sized client selection, prominent API-key guidance, then verified installation with file destinations.
[POS]: Sole public executable of @talent-summoner/setup.
[PROTOCOL]: No secret flags, logging, child arguments/environment, or paid tool calls.
*/
import { checkbox, confirm, input, password } from '@inquirer/prompts';
import { styleText } from 'node:util';
import { describeSetupFailure, installClients, targetPaths } from './install.mjs';
import { clientChoices } from './clients.mjs';
import { parseOrigin, verifyConnection } from './verify.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: talent-summoner-setup [--preview]\nProduction installs to user scope; --preview installs in the current project.');
  process.exit(0);
}
if (args.some((arg) => arg !== '--preview') || args.filter((arg) => arg === '--preview').length > 1) {
  console.error('Unknown or repeated option. Usage: talent-summoner-setup [--preview]. Enter API keys only in the masked prompt.');
  process.exit(2);
}

const preview = args.includes('--preview');
if (process.platform === 'win32') {
  console.error('Native Windows configuration is not yet supported. Run in macOS, Linux, or WSL.');
  process.exit(2);
}
try {
  const choices = await clientChoices(preview);
  const clients = await checkbox({
    message: 'Install for which apps?',
    choices,
    required: true,
    // Reserve room for the question, validation and keyboard hints when opening.
    pageSize: Math.min(choices.length, Math.max(1, (process.stdout.rows ?? 13) - 6)),
    loop: false,
  });
  const origin = preview
    ? parseOrigin(await input({ message: 'Preview website HTTPS origin:', validate: (value) => { try { parseOrigin(value); return true; } catch { return 'Enter an HTTPS origin with no path, query, fragment, or username.'; } } }))
    : 'https://talentsummoner.com';
  const name = preview ? 'talent-summoner-preview' : 'talent-summoner';
  console.log(styleText('bold', '\nNext: Create an API key'));
  console.log('Open this page, sign in, and create a key:');
  console.log(`${origin}/settings/apikeys\n`);
  const key = await password({ message: 'Paste your API key here (hidden):', mask: '*', validate: (value) => value && !/^Bearer\s/i.test(value) && !/\s/.test(value) ? true : 'Paste only the raw key, with no spaces or Bearer prefix.' });
  let bypass;
  if (preview && await confirm({ message: 'Does this preview need a Vercel protection bypass secret?', default: false })) {
    bypass = await password({ message: 'Vercel protection bypass secret (hidden):', mask: '*', validate: (value) => value ? true : 'Enter the bypass secret.' });
  }
  console.log('Checking your Talent Summoner connection…');
  await verifyConnection({ origin, key, bypass });
  console.log(`\nInstallation files (${preview ? 'this project' : 'your user account'}):`);
  for (const client of clients) {
    const paths = targetPaths(client, preview);
    console.log(`${client}:\n  MCP: ${paths.config}\n  Skill: ${paths.skill}`);
  }
  const results = await installClients({
    clients, preview, origin, key, bypass,
    confirmOverwrite: async (targets) => confirm({
      message: `Replace existing Talent Summoner server/skill for ${targets.map((target) => target.client).join(', ')}? Custom content at those targets will be replaced.`,
      default: false,
    }),
  });
  for (const result of results) {
    if (result.status === 'installed') console.log(`${result.client}: installed`);
    else if (result.status === 'mcp-configured-skill-failed') {
      console.log(`${result.client}: MCP configured; skill failed. Rerun setup to finish. To stop access, revoke the key at ${origin}/settings/apikeys and remove the ${name} MCP entry from ${result.config}.`);
    } else if (result.mcpConfigured) {
      console.log(`${result.client}: MCP entry was written, but setup could not finish. Check ${result.config}, then rerun or revoke the key and remove the entry.`);
    } else console.log(`${result.client}: MCP entry was not configured; check permissions/configuration and rerun.`);
  }
  if (results.some((result) => !result.success)) process.exitCode = 1;
  else console.log('Open or restart any app you set up, then ask: “Show my Talent Summoner sourcing sessions.”');
} catch (error) {
  const failure = describeSetupFailure(error);
  if (failure.exitCode === 0) console.log(failure.message);
  else console.error(failure.message);
  process.exitCode = failure.exitCode;
}
