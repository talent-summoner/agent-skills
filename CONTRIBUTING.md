# Contributing

This repository packages the Talent Summoner setup command and a copy of the sourcing skill. The canonical skill is maintained in the sister application repository; `skill-source.json` records the source revision and SHA-256. Update the application copy and export it here rather than editing this copy independently.

## Local development

Use Node.js 22.20 or newer with a compatible npm version. npm 12 requires Node.js 22.22.2, 24.15.0, or a supported newer release.

```sh
npm ci
npm run build
npm test
node scripts/verify-package.mjs
```

The package verifier checks the built tarball, bundled skill hash, executable, dependencies, and package contents. Setup runs from the built executable; consumers do not run an install-time lifecycle script.

After committing a skill change in the application repository, export it from that checkout by passing the path to this repository:

```sh
node scripts/export-agent-skill.mjs /absolute/path/to/agent-skills
```

Before a release, run the matching check from the application checkout:

```sh
node scripts/export-agent-skill.mjs /absolute/path/to/agent-skills --check
```

## Plugin manifests

The repository root is also a Claude Code and Cursor plugin: `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` for Claude Code, `.cursor-plugin/plugin.json` for Cursor, the shared `.mcp.json` and `assets/logo.png`. They use the same `skills/talent-summoner/SKILL.md` and are not part of the npm package. Bump `version` in both `plugin.json` files when the skill or MCP connection changes, then validate:

```sh
node scripts/verify-plugin.mjs
npx @anthropic-ai/claude-code@2.1.293 plugin validate . --strict
```

The daily **Sync skill from production** workflow compares the live skill at `talentsummoner.com` with `skill-source.json`. When they differ, it pushes a `skill-sync/<commit>` branch with the export and a plugin patch bump, and opens a pull request for review.

See [preview QA](docs/preview-qa.md) for testing against a preview deployment and [releasing](docs/releasing.md) for the publishing procedure.
