/**
 * PC Peer — Caches web pages and joins the mesh to serve them to phones.
 * 
 * Usage:
 *   node pc-peer.js                          # caches default pages
 *   node pc-peer.js https://example.com      # cache a specific URL
 */

const { io } = require('socket.io-client');
const cheerio = require('cheerio');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SERVER_URL = 'http://localhost:3001';
const CACHE_DIR = path.join(__dirname, 'pc-cache');
const PEER_ID = 'pc-' + crypto.randomBytes(4).toString('hex');
const DEVICE_NAME = 'PC Node';

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Local catalog
const catalog = [];

// ─── Page Processor ──────────────────────────────────────────────────

async function processPage(url) {
  console.log(`\n📥 Fetching: ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RealityCache/1.0' },
    timeout: 15000,
  });
  let html = await res.text();

  const $ = cheerio.load(html);

  // Extract title
  const title = $('title').text().trim() || new URL(url).hostname;

  // Strip scripts
  $('script').remove();
  // Strip event handlers
  $('*').each((_, el) => {
    const attribs = $(el).attr();
    if (attribs) {
      for (const attr of Object.keys(attribs)) {
        if (attr.startsWith('on')) $(el).removeAttr(attr);
      }
    }
  });

  // Inline external CSS
  const cssLinks = $('link[rel="stylesheet"]');
  for (let i = 0; i < cssLinks.length; i++) {
    const href = $(cssLinks[i]).attr('href');
    if (href) {
      try {
        const cssUrl = new URL(href, url).href;
        const cssRes = await fetch(cssUrl, { timeout: 5000 });
        const cssText = await cssRes.text();
        $(cssLinks[i]).replaceWith(`<style>${cssText}</style>`);
      } catch (e) {
        $(cssLinks[i]).remove();
      }
    }
  }

  // Rewrite relative links to absolute
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
      try {
        $(el).attr('href', new URL(href, url).href);
      } catch (e) {}
    }
  });
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.startsWith('data:') && !src.startsWith('http')) {
      try {
        $(el).attr('src', new URL(src, url).href);
      } catch (e) {}
    }
  });

  // Wrap in offline shell
  const body = $('body').html() || $.html();
  const offlineHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { max-width: 100vw; overflow-x: hidden; }
    img { max-width: 100%; height: auto; }
  </style>
  ${$('style').toString()}
</head>
<body>
  <div style="background:#1a1a2e;color:#e0e0e0;padding:8px 12px;font-family:system-ui;font-size:11px;border-bottom:2px solid #6c63ff;">
    📦 Reality Cache Snapshot • ${url}
  </div>
  ${body}
</body>
</html>`;

  return { html: offlineHtml, title };
}

// ─── Cache a page ────────────────────────────────────────────────────

async function cachePage(url) {
  try {
    const { html, title } = await processPage(url);
    const hash = crypto.createHash('sha256').update(html).digest('hex');

    // Check dupe
    if (catalog.find(c => c.hash === hash)) {
      console.log(`  ↳ Already cached (${hash.substring(0, 8)}...)`);
      return;
    }

    // Save to disk
    const filePath = path.join(CACHE_DIR, `${hash}.html`);
    fs.writeFileSync(filePath, html, 'utf8');

    const size = Buffer.byteLength(html, 'utf8');
    catalog.push({ hash, url, title, size, accessCount: 1 });

    console.log(`  ✅ Cached: "${title}" (${(size / 1024).toFixed(1)} KB) → ${hash.substring(0, 8)}...`);
    return { hash, title, size };
  } catch (e) {
    console.log(`  ❌ Failed: ${e.message}`);
  }
}

// ─── Join Mesh ───────────────────────────────────────────────────────

function joinMesh() {
  console.log(`\n🔗 Connecting to relay: ${SERVER_URL}`);
  const socket = io(SERVER_URL, { transports: ['websocket'] });

  socket.on('connect', () => {
    console.log(`✅ Connected as "${DEVICE_NAME}" (${PEER_ID})`);
    socket.emit('join-mesh', { peerId: PEER_ID, deviceName: DEVICE_NAME });

    // Share catalog
    socket.emit('catalog-share', catalog);
    console.log(`📋 Shared catalog: ${catalog.length} pages`);
  });

  socket.on('peer-joined', ({ deviceName, totalPeers }) => {
    console.log(`👋 Peer joined: ${deviceName} (${totalPeers} total)`);
    // Re-share catalog for the new peer
    socket.emit('catalog-share', catalog);
  });

  socket.on('peer-left', ({ peerId, totalPeers }) => {
    console.log(`👋 Peer left (${totalPeers} remaining)`);
  });

  socket.on('catalog-update', ({ deviceName, catalog: peerCatalog }) => {
    console.log(`📋 Catalog from ${deviceName}: ${peerCatalog.length} pages`);
  });

  // Serve content when requested
  socket.on('content-requested', ({ requesterPeerId, requesterSocketId, hash }) => {
    console.log(`📤 Serving ${hash.substring(0, 8)}... to ${requesterPeerId}`);

    const filePath = path.join(CACHE_DIR, `${hash}.html`);
    if (!fs.existsSync(filePath)) {
      console.log(`  ❌ File not found locally`);
      return;
    }

    const html = fs.readFileSync(filePath, 'utf8');
    const CHUNK_SIZE = 16 * 1024;
    const totalChunks = Math.ceil(html.length / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      const chunk = html.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      socket.emit('send-content-chunk', {
        targetSocketId: requesterSocketId,
        hash,
        chunkIndex: i,
        totalChunks,
        data: chunk,
      });
    }

    const page = catalog.find(c => c.hash === hash);
    socket.emit('send-content-complete', {
      targetSocketId: requesterSocketId,
      hash,
      title: page?.title || 'Untitled',
      url: page?.url || '',
      mimeType: 'text/html',
      size: html.length,
    });

    console.log(`  ✅ Sent ${totalChunks} chunks (${(html.length / 1024).toFixed(1)} KB)`);
  });

  // Handle search
  socket.on('search-query', ({ query, requestId, requesterSocketId }) => {
    const q = query.toLowerCase();
    const results = catalog.filter(c =>
      c.title.toLowerCase().includes(q) || c.url.toLowerCase().includes(q)
    );
    if (results.length > 0) {
      socket.emit('search-results', {
        targetSocketId: requesterSocketId,
        requestId,
        results,
      });
      console.log(`🔍 Search "${query}" → ${results.length} results`);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected from relay');
  });

  return socket;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const urls = process.argv.slice(2);

  // Default pages to cache if none specified
  const pagesToCache = urls.length > 0 ? urls : [
    'https://en.wikipedia.org/wiki/Internet',
    'https://en.wikipedia.org/wiki/Mesh_networking',
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',
    'https://en.wikipedia.org/wiki/Peer-to-peer',
    'https://en.wikipedia.org/wiki/Offline_web_application',
  ];

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   ⚡ Reality Cache — PC Peer Node            ║');
  console.log('║──────────────────────────────────────────────║');
  console.log(`║   Caching ${pagesToCache.length} pages, then joining mesh...    ║`);
  console.log('╚══════════════════════════════════════════════╝');

  // Cache pages
  for (const url of pagesToCache) {
    await cachePage(url);
  }

  console.log(`\n📦 Total cached: ${catalog.length} pages`);

  // Join mesh
  const socket = joinMesh();

  // Keep alive
  console.log('\n💡 Press Ctrl+C to stop. Phones can now discover and download these pages.\n');
}

main();
