# Releasing the setup package

The application owns the canonical skill at `public/skills/talent-summoner/SKILL.md`. Before publishing, run `node scripts/export-agent-skill.mjs /absolute/path/to/agent-skills --check` from the application checkout, then record both repository SHAs and the tarball hash in release evidence.

Build and verify the exact tarball:

```sh
npm ci
npm run build
npm test
node scripts/verify-package.mjs
```

Update `package.json` and `package-lock.json` to the same release version, then tag the reviewed commit with that version prefixed by `v`. The [release workflow](../.github/workflows/release.yml) verifies on Linux and macOS and publishes the verified tarball using GitHub OIDC, without a long-lived npm publishing token. Prereleases publish to npm `next`; stable versions publish to `latest`.

The workflow checks registry availability with bounded retries. If an npm scan is still pending, rerun only the `availability` job after the scan clears. Do not republish the same version.

The tarball contains only the declared executable, skill, source manifest, and public package metadata. It has no install-time lifecycle scripts or Git dependencies.

## Stable 0.1.0 release record

Version `0.1.0` published from tag `v0.1.0` at commit `df603b8` in [workflow run 35820344513](https://github.com/talent-summoner/agent-skills/actions/runs/35820344513). Registry availability and the npm `latest` mapping were verified. The production MCP endpoint was live at application version `v0.1.56`; key creation, seven-tool discovery, and session listing passed. An isolated Claude Code production check covered installation, ICP draft/edit polling, fresh-process recovery, and key revocation.

The first prerelease used interactive npm 2FA. Later prereleases through `0.1.0-next.7` completed OIDC publication and availability checks. At the stable release, npm `next` resolved to `0.1.0-next.7`.
