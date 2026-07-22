// Serve the reports/ directory over HTTP so the HTML dashboards can be viewed in
// a browser. Root ("/") redirects to the most recently modified .html report.
//
//   pnpm report:serve            # http://localhost:4173
//   PORT=8080 pnpm report:serve
import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'reports');
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function newestHtml() {
  let entries = [];
  try {
    entries = await readdir(ROOT);
  } catch {
    return null;
  }
  const html = entries.filter((f) => f.endsWith('.html'));
  let newest = null;
  for (const f of html) {
    const s = await stat(join(ROOT, f));
    if (newest === null || s.mtimeMs > newest.mtime) newest = { file: f, mtime: s.mtimeMs };
  }
  return newest?.file ?? null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname === '/') {
    const file = await newestHtml();
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('No reports yet. Run `pnpm demo:juiceshop` first.');
      return;
    }
    res.writeHead(302, { location: `/${encodeURIComponent(file)}` });
    res.end();
    return;
  }

  // Confine every request to the reports/ directory.
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Prism reports on http://localhost:${PORT}`);
});
