// The static site (tools/build_site.mjs) for GitHub Pages: complete, marked as hosted, and with
// relative paths only, since Pages serves it under /gepv1/, not at /.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../tools/build_site.mjs';

test('the static site has every file the page loads, all by relative paths', async () => {
  const out = await buildSite(await fs.mkdtemp(path.join(os.tmpdir(), 'gepv1-site-')));
  try {
    const page = await fs.readFile(path.join(out, 'index.html'), 'utf8');
    assert.match(page, /<html lang="en" data-hosted>/);
    const refs = [...page.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((r) => !/^https?:/.test(r));
    assert.ok(refs.length >= 3);
    for (const r of refs) {
      assert.ok(!r.startsWith('/'), `${r} starts at /, which breaks under /gepv1/`);
      await fs.access(path.join(out, r));
    }
    // every module reachable from web/app.js is in the site
    const seen = new Set();
    const visit = async (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = await fs.readFile(file, 'utf8');
      for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
        assert.ok(m[1].startsWith('.'), `${path.relative(out, file)} imports ${m[1]}, which a browser cannot load`);
        await visit(path.resolve(path.dirname(file), m[1]));
      }
    };
    await visit(path.join(out, 'web/app.js'));
    assert.ok(seen.size > 10);
    // what the app fetches: the examples, relative to the page
    const app = await fs.readFile(path.join(out, 'web/app.js'), 'utf8');
    assert.doesNotMatch(app, /fetch\(['"`]\/examples/);
    await fs.access(path.join(out, 'examples/stage.lua'));
    await fs.access(path.join(out, 'examples/lcs.lua'));
    await assert.rejects(fs.access(path.join(out, 'web/_check.html')));
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});
