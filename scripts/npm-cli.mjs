import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function runNpm(args, options = {}) {
  if (process.platform !== 'win32' && !process.env.npm_execpath) {
    return execFileSync('npm', args, options);
  }
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  const npmCli = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!npmCli) throw new Error('Could not locate the npm CLI.');
  return execFileSync(process.execPath, [npmCli, ...args], options);
}
