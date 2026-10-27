import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const pagePath = '/course-authoring';
const modes = new Set(['manual', 'automatic']);
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function authoringGuideURL(endpoint, mode) {
  const url = new URL(pagePath, new URL(endpoint).origin);
  url.searchParams.set('mode', mode);
  return url.href;
}

function guidePage(endpoint, mode, guide) {
  // Server-render all instructions and examples. An AI/browser needs no script,
  // login, cookie, account query or additional fetch to read the full contract.
  const content = guide.split(/(```[\s\S]*?```)/g).map(part => {
    if (part.startsWith('```')) return `<pre><code>${escapeHTML(part.replace(/^```[^\n]*\n/, '').replace(/\n```$/, ''))}</code></pre>`;
    return part.split('\n').filter(line => line.trim()).map(line => {
      const heading = /^【(.+)】$/.exec(line);
      return heading ? `<h2>${escapeHTML(heading[1])}</h2>` : `<p>${escapeHTML(line)}</p>`;
    }).join('\n');
  }).join('\n');
  const manualURL = authoringGuideURL(endpoint, 'manual'), automaticURL = authoringGuideURL(endpoint, 'automatic');
  const textURL = new URL(endpoint + '/guide'); textURL.searchParams.set('mode', mode);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>工作坊 · 课程制作规范</title>
<style>
:root{color-scheme:light dark;--page:#f4f5f7;--surface:#fff;--ink:#20272d;--muted:#63717d;--accent:#54758d;--line:#dfe4e8}*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:940px;margin:auto;padding:44px 24px 72px}header{margin-bottom:28px}.brand{color:var(--accent);font-weight:650;letter-spacing:.05em}h1{font-size:clamp(28px,5vw,38px);line-height:1.3;margin:12px 0}header p{color:var(--muted);margin:8px 0}nav{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}a{color:var(--accent);text-underline-offset:4px}nav a{border:1px solid var(--line);border-radius:24px;background:var(--surface);padding:7px 16px;text-decoration:none}nav a[aria-current=page]{background:var(--accent);color:white;border-color:var(--accent)}article{padding:26px;background:var(--surface);border:1px solid var(--line);border-radius:22px}h2{font-size:20px;margin:32px 0 12px}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 16px}pre{margin:20px 0;padding:20px;background:var(--page);border-radius:14px;overflow:auto;tab-size:4;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}footer{color:var(--muted);margin-top:24px;font-size:14px}@media(prefers-color-scheme:dark){:root{--page:#11171c;--surface:#1c242b;--ink:#e7edf1;--muted:#a9b7c2;--accent:#9abed7;--line:#35434e}nav a[aria-current=page]{color:#15232e}}@media(max-width:600px){main{padding:28px 16px 48px}article{padding:20px 16px}pre{margin-inline:-4px;padding:14px}}
</style></head><body><main><header><div class="brand">工作坊 / WorkSpace</div><h1>课程制作规范</h1><p>先读取规范，再把用户接下来提供的学习内容制作成可阅读、可互动的课程。</p><nav aria-label="制作方式"><a href="${escapeHTML(manualURL)}"${mode === 'manual' ? ' aria-current="page"' : ''}>手动导入</a><a href="${escapeHTML(automaticURL)}"${mode === 'automatic' ? ' aria-current="page"' : ''}>自动上传</a><a href="${escapeHTML(textURL.href)}">纯文本规范</a><a href="${escapeHTML(endpoint + '/schema')}">JSON Schema</a></nav></header><article>${content}</article><footer>此页公开，不含账户信息或发布密钥。规范会随服务器更新；课程仍按 WORKSHOP-COURSE/1 上传。</footer></main></body></html>`;
}

export function createCourseAuthoringAPI({ endpoint, guideFor, fail }) {
  const textPath = new URL(endpoint).pathname + '/guide';
  const packets = new Map();
  return function courseAuthoringAPI(request, response, path) {
    const isRobots = path === '/robots.txt';
    if (path !== pagePath && path !== textPath && !isRobots) return false;
    if (!['GET', 'HEAD'].includes(request.method)) fail('NOT_FOUND', 404);
    const query = new URL(request.url, endpoint).searchParams;
    const mode = query.get('mode') ?? 'manual';
    if (isRobots ? query.size !== 0 : [...query.keys()].some(key => key !== 'mode') || query.getAll('mode').length > 1 || !modes.has(mode)) fail('INVALID_COURSE_GUIDE_QUERY');
    const format = path === pagePath ? 'html' : 'plain', key = isRobots ? 'robots' : mode + ':' + format;
    let packet = packets.get(key);
    if (!packet) {
      // A 401 robots response can be treated as a full crawl restriction. Only
      // the public contract is allowlisted; account APIs remain disallowed.
      const guide = isRobots ? `User-agent: *\nDisallow: /\nAllow: ${pagePath}\nAllow: ${textPath}\nAllow: ${new URL(endpoint).pathname}/schema\nAllow: ${new URL(endpoint).pathname}/cpp-schema\n` : guideFor(mode);
      const bytes = Buffer.from(format === 'html' ? guidePage(endpoint, mode, guide) : guide, 'utf8');
      packet = { bytes, zipped: gzipSync(bytes), etag: `W/"${createHash('sha256').update(bytes).digest('hex')}"` };
      packets.set(key, packet);
    }
    const headers = {
      'Content-Type': `text/${format}; charset=utf-8`, 'Content-Language': 'zh-CN',
      'Cache-Control': 'public, max-age=0, must-revalidate', ETag: packet.etag, Vary: 'Accept-Encoding',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    };
    const matches = String(request.headers['if-none-match'] ?? '').split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === packet.etag.replace(/^W\//, ''));
    if (matches) { response.writeHead(304, headers); response.end(); return true; }
    const acceptsGzip = String(request.headers['accept-encoding'] ?? '').split(',').some(value => {
      const [encoding, ...parameters] = value.trim().split(';');
      return encoding.toLowerCase() === 'gzip' && !parameters.some(value => /^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(value));
    });
    const bytes = acceptsGzip ? packet.zipped : packet.bytes;
    response.writeHead(200, { ...headers, 'Content-Length': bytes.length, ...(acceptsGzip ? { 'Content-Encoding': 'gzip' } : {}) });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return true;
  };
}
