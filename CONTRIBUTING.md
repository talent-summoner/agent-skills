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

See [preview QA](docs/preview-qa.md) for testing against a preview deployment and [releasing](docs/releasing.md) for the publishing procedure.
