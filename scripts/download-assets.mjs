import { createWriteStream, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const extractDir = join(root, 'webperl_extract');
const zipPath = join(root, 'webperl_prebuilt.zip');

const LATEXDIFF_SO =
  'https://mirrors.ctan.org/support/latexdiff/latexdiff-so';
const LATEXDIFF_SRC =
  'https://raw.githubusercontent.com/ftilmann/latexdiff/master/latexdiff';
const LATEXDIFF_ALGO =
  'https://raw.githubusercontent.com/ftilmann/latexdiff/master/Algorithm-Diff-Block';
const WEBPERL_ZIP =
  'https://github.com/haukex/webperl/releases/download/v0.09-beta/webperl_prebuilt_v0.09-beta.zip';

const FETCH_HEADERS = {
  'User-Agent': 'latexdiff-online-asset-download',
  Accept: 'application/octet-stream, application/zip, */*',
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`Downloaded ${url} -> ${dest}`);
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow', headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function assertZip(path) {
  const buf = Buffer.alloc(4);
  const fd = openSync(path, 'r');
  readSync(fd, buf, 0, 4, 0);
  closeSync(fd);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(
      `Downloaded ${path} is not a zip file (missing PK header). GitHub may have returned an HTML error page.`,
    );
  }
}

function tryExec(command, args) {
  try {
    execFileSync(command, args, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/** GNU tar cannot extract zip; Windows bsdtar can. Prefer unzip/Python on Linux CI. */
function extractZip(zip, dest) {
  const py = 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])';
  if (tryExec('unzip', ['-o', zip, '-d', dest])) return;
  if (tryExec('python3', ['-c', py, zip, dest])) return;
  if (tryExec('python', ['-c', py, zip, dest])) return;
  if (tryExec('tar', ['-xf', zip, '-C', dest])) return;
  throw new Error(
    'Could not extract the WebPerl zip. Install unzip or Python 3 (zipfile).',
  );
}

/** latexdiff-so is not in git; it is latexdiff with Algorithm::Diff inlined. */
async function downloadLatexdiffSo(dest) {
  try {
    await download(LATEXDIFF_SO, dest);
    return;
  } catch (err) {
    console.warn(`${err.message}; building latexdiff-so from GitHub sources`);
  }

  const [src, algo] = await Promise.all([fetchText(LATEXDIFF_SRC), fetchText(LATEXDIFF_ALGO)]);
  const combined = src
    .replace(/use Algorithm::Diff qw\(traverse_sequences\);/, algo)
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('###'))
    .join('\n');
  await writeFile(dest, combined);
  console.log(`Built latexdiff-so from GitHub sources -> ${dest}`);
}

async function findFile(dir, name) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

await mkdir(publicDir, { recursive: true });

const needed = ['webperl.js', 'emperl.js', 'emperl.wasm', 'emperl.data'];
const hasWebperl = needed.every((name) => existsSync(join(publicDir, name)));
const hasLatexdiff = existsSync(join(publicDir, 'latexdiff-so'));

if (!hasLatexdiff) {
  await downloadLatexdiffSo(join(publicDir, 'latexdiff-so'));
} else {
  console.log('Keeping existing public/latexdiff-so');
}

if (!hasWebperl) {
  await download(WEBPERL_ZIP, zipPath);
  assertZip(zipPath);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  extractZip(zipPath, extractDir);
  for (const name of needed) {
    const found = await findFile(extractDir, name);
    if (!found) {
      throw new Error(`Could not find ${name} inside WebPerl zip`);
    }
    await copyFile(found, join(publicDir, name));
    console.log(`Copied ${name} to public/`);
  }
  await rm(extractDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
} else {
  console.log('Keeping existing WebPerl binaries in public/');
}

const coiSrc = join(root, 'node_modules', 'coi-serviceworker', 'coi-serviceworker.js');
if (existsSync(coiSrc)) {
  await copyFile(coiSrc, join(publicDir, 'coi-serviceworker.js'));
  console.log('Copied coi-serviceworker.js to public/');
} else {
  console.warn('coi-serviceworker is not installed yet; skip copying the service worker.');
}

await rm(extractDir, { recursive: true, force: true });
await rm(zipPath, { force: true });

console.log('WebPerl + latexdiff assets are ready in public/');
