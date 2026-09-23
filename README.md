# Talent Summoner for AI agents

Connect your AI agent to [Talent Summoner](https://talentsummoner.com) to source and review hiring candidates. The Model Context Protocol (MCP) connection gives your AI agent sourcing tools, and the companion skill guides it through the workflow.

## Quick start

1. Sign in to Talent Summoner and [create an API key](https://talentsummoner.com/settings/apikeys).
2. For guided setup, use an interactive macOS, Linux, or WSL terminal with Node.js 22.20 or newer:

   ```sh
   npx @talent-summoner/setup
   ```

3. Select your AI agents, paste the key into the hidden terminal prompt, and let setup check the connection. It installs the MCP connection and skill for the AI agents you select.
4. Open or restart each AI agent, approve the connection if prompted, and ask: **“Show my Talent Summoner sourcing sessions.”**

Keep your API key out of AI agent chats, shell commands, and Git. Setup itself does not start sourcing or use a Role.

Using Windows PowerShell or Command Prompt? See [install the skill separately](#install-the-skill-separately).

## What you can do

- Draft an ideal candidate profile before searching: “Draft the ideal candidate profile for a senior React engineer in Berlin. Let me review it before searching.”
- Search for candidates, refine the criteria, and find more candidates in the same session.
- Review and shortlist candidates, and request work-email lookups.
- Prepare outreach drafts for shortlisted candidates.

Your AI agent asks before unlocking a Role for a session. You review and confirm outreach on the Talent Summoner website before sending.

## Manage your connection

Rerun `npx @talent-summoner/setup` to replace a key or update the skill. To disconnect, [revoke the key](https://talentsummoner.com/settings/apikeys), then remove the `talent-summoner` MCP entry and skill from your AI agent. Setup displays their locations during installation.

If your AI agent does not show the tools after setup, restart it and check its MCP connection or workspace approval. [Report a setup issue](https://github.com/talent-summoner/agent-skills/issues/new) if the connection still fails.

## Install the skill separately

With Node.js, npm, and Git available, the skill can also be installed from Windows PowerShell or Command Prompt. The guided setup command exits on native Windows, so configure the Talent Summoner MCP server in your AI agent separately. Use this command if you already have an MCP connection or are setting one up yourself:

```sh
npx skills add talent-summoner/agent-skills -g
```

This command installs the skill instructions. It does not set up the MCP connection. Use one skill installation method per AI agent to avoid duplicate entries.

For a manual MCP connection, add an HTTP server at `https://talentsummoner.com/api/mcp` in your AI agent's MCP settings and authenticate with your API key as a Bearer token.

## Contributing

See the [contributor guide](https://github.com/talent-summoner/agent-skills/blob/main/CONTRIBUTING.md) for local development and releases.
