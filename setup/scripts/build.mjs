/*
[INPUT]: Reviewed installer source in src/; the repository-root skill export, skill-source.json, README.md and LICENSE.
[OUTPUT]: Prebuilt executable and helpers in dist/, plus package-local copies of the root skill files for the npm tarball.
[POS]: Explicit maintainer build; consumers never run a lifecycle build. The package lives in setup/ so the repository root stays a dependency-free Claude Code plugin.
[PROTOCOL]: Keep dist source-only, deterministic, and executable. Never edit the copies; export to the repository root instead.
*/
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

await mkdir('dist', { recursive: true });
for (const name of ['setup.mjs', 'install.mjs', 'clients.mjs', 'verify.mjs']) {
  await copyFile(join('src', name), join('dist', name));
}
await chmod('dist/setup.mjs', 0o755);

await mkdir(join('skills', 'talent-summoner'), { recursive: true });
for (const name of [join('skills', 'talent-summoner', 'SKILL.md'), 'skill-source.json', 'README.md', 'LICENSE']) {
  await copyFile(join('..', name), name);
}
