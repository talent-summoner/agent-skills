# Contributing

This repository packages the Talent Summoner setup command and a copy of the sourcing skill. The canonical skill is maintained in the sister application repository; `skill-source.json` records the source revision and SHA-256. Update the application copy and export it here rather than editing this copy independently.

## Local development

Use Node.js 22.20 or newer with a compatible npm version. npm 12 requires Node.js 22.22.2, 24.15.0, or a supported newer release.

The npm package lives in `setup/`, so the repository root stays a dependency-free Claude Code plugin. Run the package checks from there:

```sh
cd setup
npm ci
npm run build
npm test
node scripts/verify-package.mjs
```

The build copies the root `skills/talent-summoner/SKILL.md`, `skill-source.json`, `README.md` and `LICENSE` into `setup/` for packing. The copies are ignored by Git; edit or export the root files instead.

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

The repository root is also a Claude Code plugin: `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `.mcp.json` and `assets/logo.png`. It uses the same `skills/talent-summoner/SKILL.md` and is not part of the npm package. Bump `version` in `plugin.json` when the skill or MCP connection changes, then validate:

```sh
node scripts/verify-plugin.mjs
npx @anthropic-ai/claude-code@2.1.293 plugin validate . --strict
```

The daily **Sync skill from production** workflow compares the live skill at `talentsummoner.com` with `skill-source.json`. When they differ, it pushes a `skill-sync/<commit>` branch with the export and a plugin patch bump, and opens a pull request for review.

See [preview QA](docs/preview-qa.md) for testing against a preview deployment and [releasing](docs/releasing.md) for the publishing procedure.
