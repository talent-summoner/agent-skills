/*
[INPUT]: Reviewed installer source in src/.
[OUTPUT]: Prebuilt executable and helpers in dist/ for the npm tarball.
[POS]: Explicit maintainer build; consumers never run a lifecycle build.
[PROTOCOL]: Keep dist source-only, deterministic, and executable.
*/
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

await mkdir('dist', { recursive: true });
for (const name of ['setup.mjs', 'install.mjs', 'verify.mjs']) {
  await copyFile(join('src', name), join('dist', name));
}
await chmod('dist/setup.mjs', 0o755);
