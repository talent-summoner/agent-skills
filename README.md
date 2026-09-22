# Talent Summoner setup

Connect your coding agent to Talent Summoner with an API key, the sourcing skill and MCP tools.

## Preview release

The preview installer is available as **`0.1.0-next.3`** on the npm `next` channel. The [release workflow](https://github.com/talent-summoner/agent-skills/actions/runs/35696423543) passed Linux/macOS package checks, GitHub OIDC publication and fresh-consumer registry installation. Production onboarding remains disabled until the production MCP endpoint ships.

From a dedicated QA directory, connect to a preview deployment:

```sh
npx @talent-summoner/setup@next --preview
```

Select Claude Code or Cursor, enter the preview website origin, create an API key on that website, then paste it into the hidden terminal prompt. Protected Vercel deployments also need their automation bypass secret. Never paste either secret into agent chat or add it to the command line.

The preview server and skill are named `talent-summoner-preview`, installed in the current project. Use an isolated client profile/account for QA: project configuration can coexist with user-level production tools. Verify that only preview sourcing tools are loaded before taking actions.

## Production setup

After the stable release and production endpoint are available, run from any directory:

```sh
npx @talent-summoner/setup
```

For now, use `@next --preview`: npm’s bootstrap `latest` alias still resolves to a prerelease. A stable release must verify the `latest` mapping before enabling customer onboarding.

The command selects supported clients once, links to API-key settings, checks the connection and installs the skill plus MCP configuration at user scope. Reconnect the client, then ask: **Use Talent Summoner to list my sourcing sessions.** Setup itself never starts sourcing or spends a Role.

The key is stored in the client's private configuration file, not an encrypted vault. Revoking it on the website stops access; deleting local configuration alone does not. Rerun setup to replace a key or update the skill.

Requirements: Node.js 22.20 or newer, compatible npm, and an interactive Linux/macOS terminal. npm 12 additionally requires Node 22.22.2, 24.15.0 or a supported newer release. Native Windows support is not yet verified. Initial client targets are Claude Code and Cursor; see release evidence before treating a platform as verified.

## Skill only

```sh
npx skills add talent-summoner/agent-skills -g
```

This installs instructions only. It does not configure MCP. Avoid installing multiple copies through different methods into the same client.

## Development

```sh
npm ci
npm run build
npm test
node scripts/verify-package.mjs
npm pack
npm exec --package=/absolute/path/talent-summoner-setup-0.1.0-next.3.tgz -- talent-summoner-setup --preview
```

The npm `next` tag selects an installer prerelease. `--preview` independently selects a non-production backend; no new package version is needed for every app preview. Preview credentials are runtime inputs, never built into the package.

The canonical skill is maintained with the application. `skill-source.json` records its source revision and SHA-256; before each release, run `node scripts/export-agent-skill.mjs ../agent-skills --check` from the application checkout and record both repository SHAs plus the tarball hash in its release evidence. Never edit the copy independently. The tarball contains only the declared executable, skill, source manifest and public package metadata.

## Publishing

Build and verify the exact tarball before publishing. The first prerelease was bootstrapped through interactive npm 2FA. Version `0.1.0-next.3` completed OIDC publication and is installable. This repository's `release.yml` is configured as a trusted publisher with direct publish permission for later releases. The workflow uses GitHub-hosted runners and OIDC, with no long-lived npm publishing token.

Version tags must match package.json. Prereleases publish to `next`; stable versions publish to `latest`. npm scans releases before installation becomes available. The workflow checks availability with bounded retries; a pending scan requires rerunning only the separate `availability` job, not the publish job or the same version.

No install-time lifecycle scripts or Git dependencies are needed. The explicit setup command runs the already-built executable.
