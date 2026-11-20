// Builds the static site for GitHub Pages (or any static host) into site/ (or the folder given):
//
//   node tools/build_site.mjs [DIR]
//
// The same files the local server serves, laid out the same way: index.html at the root, then web/,
// core/, examples/ and vendor/fengari-web.js. The page is marked data-hosted, so the app hides what
// needs the server (MP4 export, the AI assistant, the live link) and says to run it locally for those.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'site'));
const SKIP = new Set(['_check.html']); // a page the checks write into web/

export async function buildSite(out = OUT) {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, 'vendor'), { recursive: true });
  for (const dir of ['web', 'core', 'examples']) {
    await fs.cp(path.join(ROOT, dir), path.join(out, dir), {
      recursive: true,
      filter: (src) => !SKIP.has(path.basename(src)),
    });
  }
  await fs.copyFile(path.join(ROOT, 'node_modules/fengari-web/dist/fengari-web.js'), path.join(out, 'vendor/fengari-web.js'));
  await fs.copyFile(path.join(ROOT, 'LICENSE'), path.join(out, 'LICENSE'));
  const page = await fs.readFile(path.join(ROOT, 'web/index.html'), 'utf8');
  if (!page.includes('<html lang="en">')) throw new Error('web/index.html: <html lang="en"> not found, so the page cannot be marked as hosted');
  await fs.writeFile(path.join(out, 'index.html'), page.replace('<html lang="en">', '<html lang="en" data-hosted>'));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildSite();
  console.log(`[site] built ${path.relative(process.cwd(), out) || '.'}/ (open index.html through a web server, e.g. npx serve)`);
}
