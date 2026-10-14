/**
 * [INPUT]: openai/plugin.json, openai/mcp.json, skills/ and the assets the OpenAI manifest references.
 * [OUTPUT]: dist/openai/<name>-<version>.zip, the ChatGPT and Codex plugin package with plugin.json, mcp.json, skills/ and assets/ at the archive root; its entry list on stdout.
 * [POS]: Packaging step for the OpenAI plugin directory upload (platform.openai.com/plugins, "With MCP"); run scripts/verify-plugin.mjs first.
 * [PROTOCOL]: Dependency-free and deterministic (sorted entries, fixed timestamps). Packages only listed files, never secrets.
 */
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const ASSET_FIELDS = ['composerIcon', 'composerIconDark', 'logo', 'logoDark'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const manifest = readJson('openai/plugin.json');
const mcp = readJson('openai/mcp.json');
const listing = manifest.extensions?.['com.openai']?.interface ?? {};


const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!entry.isFile()) fail(`${path} is not a regular file`);
    return [path];
  });

// Archive path -> repository path.
const files = new Map([
  ['plugin.json', 'openai/plugin.json'],
  ['mcp.json', 'openai/mcp.json'],
]);
for (const path of walk('skills')) files.set(path, path);
for (const asset of [...ASSET_FIELDS.map((field) => listing[field]), ...(listing.screenshots ?? [])]) {
  if (asset === undefined) continue;
  if (!/^\.\/assets\/[^/]+$/.test(asset)) fail(`OpenAI asset ${asset} must be a ./assets/<file> path`);
  const path = asset.slice(2);
  if (!lstatSync(path).isFile()) fail(`${path} is not a regular file`);
  files.set(path, path);
}

// ZIP (APPNOTE 6.3): deflated entries, UTF-8 names, regular-file mode 0644, 1980-01-01 timestamps.
const DOS_DATE = (1 << 5) | 1;
const local = [];
const central = [];
let offset = 0;
const names = [...files.keys()].sort();
for (const name of names) {
  const data = readFileSync(files.get(name));
  const packed = deflateRawSync(data, { level: 9 });
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  local.push(header, nameBytes, packed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(0x031e, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(nameBytes.length, 28);
  entry.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBytes);

  offset += header.length + nameBytes.length + packed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

const output = `dist/openai/${manifest.name}-${manifest.version}.zip`;
mkdirSync('dist/openai', { recursive: true });
writeFileSync(output, Buffer.concat([...local, directory, end]));
console.log(`Built ${output} (${names.length} files):`);
for (const name of names) console.log(`  ${name}`);
