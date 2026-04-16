/**
 * PageProcessor — Snapshot pipeline for web pages
 *
 * Two modes:
 *   processPage(url)       — fetch from network (with proper User-Agent)
 *   processHtml(url, html) — use pre-captured HTML (e.g. from WebView)
 */

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function fetchWithUA(url) {
  return fetch(url, { headers: { 'User-Agent': UA } });
}

/**
 * Process pre-captured HTML (from WebView injection) into offline snapshot
 */
export async function processHtml(url, rawHtml) {
  return buildSnapshot(url, rawHtml);
}

/**
 * Fetch a URL and process into an offline-ready HTML snapshot
 */
export async function processPage(url) {
  const response = await fetchWithUA(url);
  const rawHtml = await response.text();
  return buildSnapshot(url, rawHtml);
}

async function buildSnapshot(url, rawHtml) {
  // Extract title
  const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

  let html = rawHtml;

  // Strip <script> tags entirely
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Strip <noscript> tags (their content is irrelevant for cached snapshots)
  html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Strip inline event handlers
  html = html.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*'[^']*'/gi, '');

  // Inline external CSS
  const cssLinks = html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || [];
  for (const linkTag of cssLinks) {
    const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
    if (hrefMatch) {
      try {
        const cssUrl = resolveUrl(url, hrefMatch[1]);
        const cssResponse = await fetchWithUA(cssUrl);
        const cssText = await cssResponse.text();
        html = html.replace(linkTag, `<style>${cssText}</style>`);
      } catch (e) {
        html = html.replace(linkTag, '');
      }
    }
  }

  // Inline images as base64 (limit 20)
  const imgTags = html.match(/<img[^>]+src=["'][^"']+["'][^>]*>/gi) || [];
  let processed = 0;
  for (const imgTag of imgTags) {
    if (processed >= 20) break;
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    if (srcMatch && !srcMatch[1].startsWith('data:')) {
      try {
        const imgUrl = resolveUrl(url, srcMatch[1]);
        const imgResponse = await fetchWithUA(imgUrl);
        const blob = await imgResponse.blob();
        const base64 = await blobToBase64(blob);
        const newImgTag = imgTag.replace(srcMatch[0], `src="${base64}"`);
        html = html.replace(imgTag, newImgTag);
        processed++;
      } catch (e) {
        // Leave original src
      }
    }
  }

  // Rewrite relative links to absolute
  html = html.replace(/(href|src|action)=["'](?!data:|http|https|mailto|#|javascript)([^"']+)["']/gi, (match, attr, path) => {
    const absoluteUrl = resolveUrl(url, path);
    return `${attr}="${absoluteUrl}"`;
  });

  // Wrap in offline-ready HTML shell
  const offlineHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-rc-source" content="${url}">
  <meta name="x-rc-cached" content="${new Date().toISOString()}">
  <title>${title}</title>
  <style>
    body { max-width: 100vw; overflow-x: hidden; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <div style="background:#1a1a2e;color:#e0e0e0;padding:8px 12px;font-family:system-ui;font-size:11px;border-bottom:2px solid #6c63ff;">
    📦 Reality Cache Snapshot • <a href="${url}" style="color:#6c63ff;">${url}</a>
  </div>
  ${extractBody(html)}
</body>
</html>`;

  return { html: offlineHtml, title };
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function extractBody(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
