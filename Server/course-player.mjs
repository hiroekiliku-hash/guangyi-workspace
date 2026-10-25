// Trusted renderer owned by the service. Course strings are data, never trusted markup.
export const playerProtocol = 'WORKSHOP-PLAYER/1';
export const rendererVersion = '2026.10.25.1';
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function renderCoursePlayer(course, lessonID, courseRevision) {
  const lesson = course.lessons.find(item => item.id.toLowerCase() === lessonID.toLowerCase());
  if (!lesson) throw new Error('COURSE_LESSON_NOT_FOUND');
  const data = { courseID: course.id, courseRevision, referenceCode: course.referenceCode, lessonIndex: course.lessons.indexOf(lesson), lesson };
  // A bundler may normalize string escapes inside function source. Escape the entire
  // serialized runtime at the final HTML boundary, including nested srcdoc scripts.
  const runtime = playerRuntime.toString().replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script');
  return { protocol: playerProtocol, rendererVersion, courseID: course.id, lessonID: lesson.id, courseRevision,
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; img-src 'none'; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${playerCSS}</style></head><body><main id="app" aria-live="polite"></main><script>const curriculum=${json(data)};(${runtime})(curriculum);</script></body></html>` };
}
const playerCSS = `
:root{color-scheme:light dark;--bg:#f2f2f7;--panel:#fff;--text:#1c1c1e;--muted:#707078;--line:#dedee4;--accent:#52758f;--soft:#e9eff4;--mark:#f6e0a0;--input:#fff;--bottom-space:16px;--control-space:148px;--corner-margin:0 0 0 auto}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html{scroll-padding-bottom:calc(var(--bottom-space) + env(safe-area-inset-bottom,0px));-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.53 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}body.dark{--bg:#000;--panel:#1c1c1e;--text:#f2f2f7;--muted:#a4a4ad;--line:#38383a;--accent:#9dc3df;--soft:#22333f;--mark:#695221;--input:#1c1c1e}body.control-left{--corner-margin:0 auto 0 0}body.needs-control-space{--bottom-space:var(--control-space)}body.keyboard-visible{--control-space:148px}
main{max-width:1240px;margin:auto;padding:12px 20px calc(var(--bottom-space) + env(safe-area-inset-bottom,0px));overflow-wrap:anywhere}main:after{content:'';display:block;width:76px;height:1px;margin:var(--corner-margin);pointer-events:none}.heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 18px}.eyebrow,.muted{color:var(--muted);font-size:13px}.eyebrow{font-variant-numeric:tabular-nums;flex-shrink:0}h1{font-size:22px;font-weight:650;letter-spacing:-.4px;line-height:1.3;margin:0}h2{font-size:19px;font-weight:600;line-height:1.4;margin:0 0 10px}p{margin:0 0 18px;white-space:pre-wrap}.workspace{display:grid;gap:20px;align-items:start}.card{background:var(--panel);border:0;border-radius:16px;padding:16px;min-width:0}article.card{background:transparent;padding:0;border:0;border-radius:0}article.card>:last-child{margin-bottom:0}.reference{position:sticky;top:0;max-height:38vh;overflow:auto;padding:12px 8px;box-shadow:0 1px 0 var(--line);z-index:1}.reference>.muted{padding:0 8px 7px}.reference summary{cursor:pointer;font-weight:600}
.code{font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto;white-space:pre;padding:0;margin:0;tab-size:4}.code .line{display:block;min-width:max-content;padding:0 8px;border-radius:4px}.code .line.active{background:var(--soft)}.number{display:inline-block;min-width:3ch;margin-right:12px;opacity:.45;user-select:none}mark{background:var(--mark);color:inherit;border-radius:3px}.tok-comment{color:#7b8790}.tok-string{color:#9d6035}.tok-number{color:#975ab2}.tok-keyword{color:#466da6}.dark .tok-string{color:#e2ae7d}.dark .tok-number{color:#d5a2eb}.dark .tok-keyword{color:#8fbaff}.annotation{font:12px/1.5 -apple-system,system-ui;color:var(--muted);margin-left:20px}
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0}button,select,input,textarea{font:inherit;color:inherit;-webkit-appearance:none;appearance:none}button,select{min-height:44px;border-radius:13px;border:0;background:var(--soft);padding:10px 15px;cursor:pointer;touch-action:manipulation}button{position:relative;overflow:hidden;transform:translateZ(0)}button:active:not(:disabled),summary:active{filter:brightness(.91);transform:scale(.98)}button[disabled]{opacity:.4;cursor:default}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button.selected{background:var(--soft);box-shadow:inset 0 0 0 1.5px var(--accent)}select{padding-right:32px;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 17px) 20px,calc(100% - 12px) 20px;background-size:5px 5px;background-repeat:no-repeat}
.option{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--panel);margin:0;min-height:54px;border-radius:0;padding:14px 16px;box-shadow:inset 0 -1px 0 var(--line)}.option:before{content:'○';flex:0 0 24px;font-size:24px;line-height:24px;color:var(--muted)}.option.selected:before{content:'●';color:var(--accent)}.option.selected{background:var(--soft);box-shadow:inset 0 -1px 0 var(--line)}.option:first-of-type{border-radius:15px 15px 0 0}.option:last-of-type{border-radius:0 0 15px 15px;box-shadow:none}.option:only-of-type{border-radius:15px}.option:active:not(:disabled){transform:none;background:var(--soft)}
textarea,input{display:block;width:100%;resize:none;background:var(--input);border:1px solid var(--line);border-radius:14px;padding:13px 14px;outline:none;min-height:48px;max-height:55vh;caret-color:var(--accent);scroll-margin-bottom:calc(var(--bottom-space) + 12px)}textarea:focus,input:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 14%,transparent)}::placeholder{color:var(--muted);opacity:.8}textarea.code-input{font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:4;white-space:pre;overflow:auto}.feedback{margin-top:18px;padding:14px 16px;background:var(--soft);border-radius:14px}.error{color:#c83c32;font-size:15px;margin-top:16px}.dark .error{color:#ff746b}.objects,.comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.object{padding:16px;border-radius:14px;background:var(--panel)}.object.changed{box-shadow:inset 0 0 0 1.5px var(--accent)}.object strong{display:block;font-size:32px;line-height:1.4}.output{background:var(--panel);padding:14px;border-radius:14px;white-space:pre-wrap;font:14px/1.6 ui-monospace,monospace}.table-scroll{overflow:auto;border-radius:14px;background:var(--panel)}table{border-collapse:collapse;width:100%;font-size:15px}td,th{text-align:left;border-bottom:1px solid var(--line);padding:11px 13px;min-width:90px}th{font-weight:600}tr:last-child td{border-bottom:0}details{margin:14px 0}summary{display:list-item;cursor:pointer;min-height:44px;padding:10px 0;color:var(--accent)}iframe{display:block;width:100%;border:0;background:transparent;min-height:120px;border-radius:14px}svg.chart{width:100%;height:auto;max-height:360px}.flash{width:100%;padding:24px;white-space:pre-wrap;margin:8px 0;background:var(--panel);min-height:88px}.steps{padding-left:24px}.steps li{padding-left:5px;margin-bottom:20px}.chart-label{font:12px -apple-system,system-ui;fill:var(--muted)}.chart-bar{fill:var(--accent)}blockquote{margin:14px 0;border-left:3px solid var(--accent);padding-left:16px;color:var(--muted)}.markdown code:not(.code){background:var(--soft);padding:2px 5px;border-radius:4px}.markdown pre{overflow:auto;white-space:pre;background:var(--panel);padding:15px;border-radius:14px}.markdown p{white-space:normal}.callout>p:first-child{padding:13px 16px;background:var(--soft);border-radius:14px}.comparison .card{padding:16px}
.vocabulary{max-width:720px;margin:0 auto}.vocabulary-progress{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:0 0 12px;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}.vocabulary-card{display:block;width:100%;text-align:left;padding:clamp(22px,5vw,36px);background:var(--panel);border:1px solid var(--line);border-radius:24px;cursor:pointer;white-space:pre-wrap;overflow-wrap:anywhere}.vocabulary-card[aria-pressed=true]{cursor:default}.vocabulary-word{display:block;font-size:clamp(32px,9vw,48px);line-height:1.2;font-weight:650;letter-spacing:-.025em}.vocabulary-pronunciation{display:block;color:var(--muted);font-size:17px;line-height:1.6;margin-top:12px}.vocabulary-cue{display:block;margin-top:28px;color:var(--accent);font-size:14px}.vocabulary-answer{display:block;margin-top:24px;padding-top:22px;border-top:1px solid var(--line);font-size:18px;line-height:1.65;white-space:pre-wrap}.vocabulary-card:active:not(:disabled){transform:none;filter:brightness(.98)}
@media(prefers-reduced-motion:no-preference){.vocabulary-answer{animation:word-reveal .16s ease-out}@keyframes word-reveal{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}}
@media(min-width:850px){main{padding:18px 28px calc(var(--bottom-space) + env(safe-area-inset-bottom,0px))}.workspace.with-reference{grid-template-columns:minmax(280px,.85fr) minmax(360px,1.15fr);gap:26px}.reference{max-height:calc(100vh - 115px)}.heading{margin-bottom:18px}}
@media(min-width:600px) and (orientation:landscape) and (max-height:500px){:root{--control-space:140px}main{padding:8px 16px calc(var(--bottom-space) + env(safe-area-inset-bottom,0px))}.heading{margin-bottom:10px}h1{font-size:19px}.workspace{gap:14px}.workspace.with-reference{grid-template-columns:minmax(220px,.8fr) minmax(260px,1.2fr)}.reference{max-height:calc(100vh - 65px)}body.keyboard-visible{--control-space:140px}}
@media(max-width:599px){body:has(input:focus,textarea:focus) .reference{position:static;max-height:28vh}body:has(input:focus,textarea:focus){--bottom-space:148px}}
@media(prefers-reduced-motion:no-preference){button,summary{transition:background .12s,filter .12s,transform .12s}}`;

function playerRuntime(data) {
  'use strict';
  const lesson = data.lesson, root = document.getElementById('app');
  let index = 0, pending = null, initialized = false, hapticsEnabled = true, lastInteractionHaptic = -100;
  const resultHaptics = new Map();
  const drafts = new Map(), saved = new Map(), flashcardStates = new Map(), traceStates = new Map(), runs = new Map(), feedbackFrames = new Map();
  const post = message => window.webkit?.messageHandlers?.workshopPlayer?.postMessage(message);
  const haptic = (style, result = false) => {
    if (!hapticsEnabled) return;
    const time = performance.now();
    // A prompt result may follow its tap immediately; interaction throttling must not swallow it.
    if (result) { if (time - (resultHaptics.get(style) ?? -Infinity) < 180) return; resultHaptics.set(style, time); }
    else { if (time - lastInteractionHaptic < 70) return; lastInteractionHaptic = time; }
    post({type:'haptic',style});
  };
  const requestID = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });
  const node = (tag, text, cls) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (cls) element.className = cls; return element; };
  const button = (text, action, cls) => { const value = node('button', text, cls); value.type = 'button'; value.onclick = event => { if (value.disabled || action(event) === false) return; haptic(cls?.includes('option') ? 'selection' : 'impact'); }; return value; };
  const lineArray = source => source.replace(/\r\n|\r/g, '\n').split('\n');
  const ownCode = b => b.code ?? b.presentation?.code ?? b.presentation?.trace?.variants?.[0]?.code ?? (b.execution?.template ? { language: b.execution.language, source: b.execution.template } : undefined);
  function effectiveCode(block) {
    const direct = ownCode(block) ?? lesson.referenceCode ?? data.referenceCode;
    if (direct) return { code: direct, inherited: false };
    const before = lesson.blocks.slice(0, index).reverse().map(ownCode).find(Boolean), after = lesson.blocks.slice(index + 1).map(ownCode).find(Boolean);
    return { code: before ?? after, inherited: true };
  }
  function codeView(code, lines, spans) {
    const view = node('pre', undefined, 'code');
    lineArray(code.source).forEach((text, i) => {
      const row = node('span', undefined, 'line' + (lines.includes(i + 1) ? ' active' : ''));
      row.append(node('span', String(i + 1), 'number'));
      const ranges = [];
      for (const span of spans.filter(s => s.line === i + 1 && s.text)) {
        let at = 0, found = -1;
        for (let n = 0; n < (span.occurrence ?? 1); n++) { found = text.indexOf(span.text, at); if (found < 0) break; at = found + span.text.length; }
        if (found >= 0) ranges.push([found, found + span.text.length]);
      }
      const tokens = [];
      const pattern = /\/\/.*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b(?:if|else|for|while|return|def|class|import|from|as|in|is|not|and|or|None|True|False|int|float|double|char|void|bool|auto|const|let|var|function|async|await|new|public|private|static|using|namespace|include|break|continue|switch|case|try|catch|throw|print|range)\b/g;
      for(const match of text.matchAll(pattern)){const value=match[0],kind=value.startsWith('//')||value.startsWith('#')?'comment':/^['"]/.test(value)?'string':/^\d/.test(value)?'number':'keyword';tokens.push([match.index,match.index+value.length,kind]);}
      let current, buffer = '';
      const flush = () => { if (buffer) { const [marked, kind] = current.split('|'); row.append(node(marked==='1' ? 'mark' : 'span',buffer,kind?'tok-'+kind:undefined)); } buffer = ''; };
      for (let x = 0; x < text.length; x++) { const marked = ranges.some(([a, b]) => x >= a && x < b), kind=tokens.find(([a,b])=>x>=a&&x<b)?.[2]??'', style=(marked?'1':'0')+'|'+kind; if (style !== current) { flush(); current = style; } buffer += text[x]; }
      flush();
      if (!text) row.append(document.createTextNode(' '));
      const annotation = code.annotations?.find(a => a.line === i + 1); if (annotation) row.append(node('span', annotation.text, 'annotation'));
      view.append(row);
    });
    return view;
  }
  function markdown(source) {
    const box = node('div', undefined, 'markdown'); let fence = null, paragraph = [];
    const inline = (parent, text) => {
      // Raw HTML, links and images remain text. Only local typography is interpreted.
      const chunks = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
      chunks.forEach(chunk => parent.append(chunk.startsWith('`') && chunk.endsWith('`') ? node('code', chunk.slice(1, -1)) : chunk.startsWith('**') && chunk.endsWith('**') ? node('strong', chunk.slice(2, -2)) : document.createTextNode(chunk)));
    };
    const flush = () => { if (paragraph.length) { const p = node('p'); inline(p, paragraph.join('\n')); box.append(p); paragraph = []; } };
    const rows = lineArray(source);
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i];
      if (line.startsWith('```')) { flush(); if (fence) { box.append(node('pre', fence.join('\n'))); fence = null; } else fence = []; continue; }
      if (fence) { fence.push(line); continue; }
      if (!line.trim()) { flush(); continue; }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) { flush(); const h = node('h' + Math.min(heading[1].length + 1, 6)); inline(h, heading[2]); box.append(h); continue; }
      if (line.includes('|') && i + 1 < rows.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(rows[i + 1])) {
        flush(); const cells = value => value.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
        const table = { columns: cells(line), rows: [] }; i += 2;
        while (i < rows.length && rows[i].includes('|') && rows[i].trim()) table.rows.push(cells(rows[i++]));
        i--; box.append(tableView(table)); continue;
      }
      if (/^\s*(?:[-*+] |\d+\. )/.test(line)) { flush(); const p = node('p'); inline(p, '• ' + line.replace(/^\s*(?:[-*+] |\d+\. )/, '')); box.append(p); continue; }
      if (line.startsWith('> ')) { flush(); const q = node('blockquote'); inline(q, line.slice(2)); box.append(q); continue; }
      paragraph.push(line);
    }
    flush(); if (fence) box.append(node('pre', fence.join('\n'))); return box;
  }
  function tableView(value) {
    const scroll = node('div', undefined, 'table-scroll'), table = node('table'), head = node('tr');
    value.columns.forEach(t => head.append(node('th', t))); table.append(head);
    value.rows.forEach(values => { const row = node('tr'); values.forEach(t => row.append(node('td', t))); table.append(row); });
    scroll.append(table); return scroll;
  }
  function isolated(source, height) {
    const token = requestID(), frame = document.createElement('iframe'); feedbackFrames.set(frame, { token, primary: null }); frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer'); frame.title = '离线互动演示';
    frame.style.height = `${Math.max(120, Math.min(640, height ?? 320))}px`;
    frame.srcdoc = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; img-src \'none\'; frame-src \'none\'; object-src \'none\'; media-src \'none\'; font-src \'none\'; base-uri \'none\'; form-action \'none\'"><style>:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui;overflow-wrap:anywhere}svg{max-width:100%;height:auto}button,input,select{font:inherit;min-height:44px}</style></head><body>' + '<script>(' + iframeFeedback.toString() + ')(' + JSON.stringify(token) + ');<\/script>' + source + '</body></html>';
    return frame;
  }
  function iframeFeedback(token) {
    // Local callbacks never receive native, account, persisted-answer or execution capability.
    let primary = null;
    const publish = () => parent.postMessage({type:'workshop-primary',token,canNext:typeof primary?.next === 'function' && primary.canNext !== false,canPrevious:typeof primary?.previous === 'function' && primary.canPrevious !== false}, '*');
    const setPrimaryAction = value => {
      primary = value && typeof value === 'object' ? value : null;
      document.documentElement.classList.toggle('workshop-primary-next', typeof primary?.next === 'function');
      document.documentElement.classList.toggle('workshop-primary-previous', typeof primary?.previous === 'function');
      publish();
    };
    // Preserve the optional drawing API used by earlier HTML lessons.
    const invalidations = new Map(); let drawingFrame = 0;
    const draw = () => {
      drawingFrame = 0; if (document.visibilityState === 'hidden') return;
      const callbacks = [...invalidations.values()]; invalidations.clear();
      for (const callback of callbacks) callback();
    };
    const schedule = () => { if (!drawingFrame && document.visibilityState !== 'hidden') drawingFrame = requestAnimationFrame(draw); };
    window.WorkshopRuntime = Object.freeze({
      setPrimaryAction,
      invalidate(key, callback) { if (typeof callback !== 'function') return; invalidations.set(String(key), callback); schedule(); },
      cancelInvalidation(key) { invalidations.delete(String(key)); },
      yield: () => new Promise(resolve => requestAnimationFrame(resolve)),
      get active() { return document.visibilityState !== 'hidden'; }
    });
    document.addEventListener('visibilitychange', () => {
      window.dispatchEvent(new CustomEvent('workshopvisibilitychange', {detail:{active:document.visibilityState !== 'hidden'}})); schedule();
    });
    const style = document.createElement('style');
    style.textContent = '.workshop-primary-next [data-workshop-primary="next"],.workshop-primary-previous [data-workshop-primary="previous"]{display:none!important}';
    document.head.append(style);
    window.addEventListener('message', async event => {
      const message = event.data;
      if (event.source !== parent || !message || message.type !== 'workshop-primary-action' || message.token !== token || !['next','previous'].includes(message.direction) || typeof message.requestID !== 'string') return;
      const callback = primary?.[message.direction], allowed = primary?.[message.direction === 'next' ? 'canNext' : 'canPrevious'] !== false;
      let ok = false;
      try { if (allowed && typeof callback === 'function') { await callback(); ok = true; } }
      catch (_) { /* Keep the failed operation inside its sandbox. */ }
      publish();
      parent.postMessage({type:'workshop-primary-result',token,requestID:message.requestID,ok}, '*');
    });
    const send = style => parent.postMessage({type:'workshop-feedback',token,style}, '*');
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('button,[role=button],summary,input,select,[onclick],svg') : null;
      if (target && !target.disabled) send(target.matches('input,select,summary,svg') ? 'selection' : 'impact');
    }, true);
    document.addEventListener('change', event => {
      if (event.target instanceof Element && event.target.matches('input,select,textarea')) send('selection');
    }, true);
  }
  function iframeEntry(event, requireVisible = false) {
    const message = event.data;
    if (!message || document.visibilityState === 'hidden') return null;
    for (const [frame, entry] of feedbackFrames) {
      if (event.source !== frame.contentWindow || message.token !== entry.token || !frame.isConnected) continue;
      if (requireVisible) {
        const rect = frame.getBoundingClientRect(), style = getComputedStyle(frame), height = window.visualViewport?.height ?? window.innerHeight;
        if (style.visibility === 'hidden' || style.display === 'none' || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= height || rect.left >= window.innerWidth) return null;
      }
      return {frame, entry};
    }
    return null;
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'workshop-feedback' && ['selection','impact'].includes(message.style) && iframeEntry(event, true)) { haptic(message.style); return; }
    if (!['workshop-primary','workshop-primary-result'].includes(message?.type)) return;
    const match = iframeEntry(event); if (!match) return;
    if (message.type === 'workshop-primary') {
      if (typeof message.canNext !== 'boolean' || typeof message.canPrevious !== 'boolean') return;
      match.entry.primary = {canNext:message.canNext,canPrevious:message.canPrevious}; sendState(); return;
    }
    if (pending?.type !== 'frame' || pending.frame !== match.frame || message.requestID !== pending.id || typeof message.ok !== 'boolean') return;
    clearTimeout(pending.timeout); pending = null;
    if (!message.ok) showError('演示暂时无法继续，请重试。'); else sendState();
  });
  function frameAction(direction) {
    for (const [frame, entry] of feedbackFrames) {
      if (!frame.isConnected || !entry.primary?.[direction === 'next' ? 'canNext' : 'canPrevious']) continue;
      const id = requestID();
      const timeout = setTimeout(() => {
        if (pending?.id !== id || pending.type !== 'frame') return;
        pending = null; showError('演示响应较慢，请重试。');
      }, 5000);
      pending = {id,type:'frame',frame,timeout};
      frame.contentWindow.postMessage({type:'workshop-primary-action',token:entry.token,requestID:id,direction}, '*'); sendState(); return true;
    }
    return false;
  }
  function traceAction(direction) {
    const block = lesson.blocks[index]; if (block.presentation?.kind !== 'trace') return false;
    const state = traceStates.get(block.id), variant = block.presentation.trace.variants[state?.variant ?? 0];
    if (!state || (direction === 'next' ? state.frame >= variant.frames.length - 1 : state.frame <= 0)) return false;
    state.frame += direction === 'next' ? 1 : -1; render(); return true;
  }
  function chart(block) {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 640 330'); svg.classList.add('chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', block.title ?? '数据图表');
    const points = block.points, min = Math.min(0, ...points.map(p => p.value)), max = Math.max(0, ...points.map(p => p.value)), range = max - min || 1;
    const y = v => 270 - (v - min) / range * 240, width = 580 / points.length;
    const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => n.setAttribute(k, v)); if (text !== undefined) n.textContent = text; svg.append(n); };
    if (block.chartType === 'line') add('polyline', { points: points.map((p,i) => `${40 + (i + .5) * width},${y(p.value)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3 });
    points.forEach((p,i) => { const x = 40 + (i + .5) * width; if (block.chartType !== 'line') add('rect', { x: x-width*.35, y: Math.min(y(p.value),y(0)), width: width*.7, height: Math.max(1,Math.abs(y(p.value)-y(0))), rx: 4, class:'chart-bar' }); else add('circle', { cx:x, cy:y(p.value), r:4, fill:'var(--accent)' }); add('text', {x,y:305,'text-anchor':'middle',class:'chart-label'},p.label); add('text',{x,y:Math.max(15,y(p.value)-8),'text-anchor':'middle',class:'chart-label'},String(p.value)); });
    return svg;
  }
  function trace(block, reference) {
    const value = block.presentation.trace, state = traceStates.get(block.id) ?? { variant: 0, frame: 0 }; traceStates.set(block.id, state);
    const box = node('div'), toolbar = node('div', undefined, 'toolbar');
    if (value.variants.length > 1) { const select = node('select'); value.variants.forEach((v,i) => { const option=node('option',v.title); option.value=i; select.append(option); }); select.value=state.variant; select.onchange=()=>{const variant=Number(select.value);if(variant===state.variant)return;state.variant=variant;state.frame=0;render();haptic('selection');}; toolbar.append(select); }
    const variant = value.variants[state.variant], frame = variant.frames[state.frame];
    toolbar.append(node('span',`${state.frame+1} / ${variant.frames.length}`,'muted'));
    if (variant.frames.length > 1) { const reset = button('重置演示', () => {state.frame=0;render();}); reset.disabled=state.frame===0; toolbar.append(reset); }
    box.append(toolbar,node('h2',frame.title));
    reference.replaceChildren(node('div', variant.code.filename ?? variant.code.language, 'muted'), codeView(variant.code, frame.focusSpans?.length ? [] : [frame.line], frame.focusSpans ?? []));
    const objects=node('div',undefined,'objects'); frame.objects.forEach(o=>{const tile=node('div',undefined,'object'+(o.changed?' changed':''));tile.append(node('div',o.names.join(' · ')),node('strong',o.value));if(o.scope)tile.append(node('div',o.scope,'muted'));objects.append(tile);});
    box.append(objects,node('p',frame.note)); if(frame.output!==undefined)box.append(node('pre',frame.output || '（暂无输出）','output'));return box;
  }
  function flashcardState(block) {
    if (!flashcardStates.has(block.id)) flashcardStates.set(block.id, { card: 0, revealed: false });
    return flashcardStates.get(block.id);
  }
  function flashcardAction(direction) {
    const block = lesson.blocks[index];
    if (block.presentation?.kind !== 'flashcards') return false;
    const state = flashcardState(block), cards = block.presentation.cards;
    if (direction === 'next') {
      if (!state.revealed) state.revealed = true;
      else if (state.card < cards.length - 1) { state.card++; state.revealed = false; }
      else return false;
    } else {
      if (state.revealed) state.revealed = false;
      else if (state.card > 0) { state.card--; state.revealed = true; }
      else return false;
    }
    haptic('selection'); render(); return true;
  }
  function flashcards(block) {
    const state = flashcardState(block), cards = block.presentation.cards, card = cards[state.card];
    const box = node('section', undefined, 'vocabulary');
    const progress = node('div', undefined, 'vocabulary-progress');
    progress.append(node('span', '回忆卡片'), node('span', `${state.card + 1} / ${cards.length}`));
    const face = button(undefined, event => {
      if (state.revealed || pending || !initialized) return false;
      const focused = document.activeElement === event.currentTarget;
      flashcardAction('next');
      if (focused) root.querySelector('.vocabulary-card')?.focus({ preventScroll: true });
      return false; // flashcardAction already provided feedback.
    }, 'vocabulary-card');
    face.setAttribute('aria-pressed', String(state.revealed));
    face.setAttribute('aria-label', state.revealed ? `${card.front}，释义已揭示` : `${card.front}，揭示释义`);
    const lines = lineArray(card.front);
    face.append(node('span', lines[0], 'vocabulary-word'));
    if (lines.length > 1) face.append(node('span', lines.slice(1).join('\n'), 'vocabulary-pronunciation'));
    if (state.revealed) face.append(node('span', card.back, 'vocabulary-answer'));
    else face.append(node('span', '点卡片或继续，揭示释义', 'vocabulary-cue'));
    box.append(progress, face); return box;
  }
  function presentation(block, reference) {
    const p=block.presentation, box=node('div'); if(!p)return box;
    switch(p.kind){
      case 'code': if(!reference)box.append(codeView(p.code,p.code.highlightLines??[],p.code.highlightSpans??[]));break;
      case 'markdown':box.append(markdown(p.markdown.source));break;
      case 'table':box.append(tableView(p.table));break;
      case 'steps':{const list=node('ol',undefined,'steps');p.steps.forEach(item=>{const li=node('li');li.append(node('h2',item.title),node('p',item.text));if(item.code)li.append(codeView(item.code,item.code.highlightLines??[],item.code.highlightSpans??[]));list.append(li);});box.append(list);break;}
      case 'comparison':{const grid=node('div',undefined,'comparison');p.items.forEach(item=>{const card=node('section',undefined,'card');card.append(node('h2',item.title),node('p',item.text));if(item.code)card.append(codeView(item.code,item.code.highlightLines??[],item.code.highlightSpans??[]));grid.append(card);});box.append(grid);break;}
      case 'flashcards':box.append(flashcards(block));break;
      case 'html':box.append(isolated(p.html.source,p.html.height));break;
      case 'svg':box.append(isolated(p.svg.source,p.svg.height));break;
      case 'trace':box.append(trace(block,reference));break;
      default:box.append(node('p','当前内容暂时无法显示。','muted'));
    }
    return box;
  }
  const equalAnswer=(a,b)=>JSON.stringify([a?.selectedOptionIDs??[],a?.text??''])===JSON.stringify([b?.selectedOptionIDs??[],b?.text??'']);
  function draft(block) {
    if(!drafts.has(block.id))drafts.set(block.id,{selectedOptionIDs:[],text:block.input?.starterCode??''});return drafts.get(block.id);
  }
  function answerCorrect(block, answer) {
    if(block.questionType!=='shortAnswer' && block.correctOptionIDs)return [...answer.selectedOptionIDs].sort().join('|')===[...block.correctOptionIDs].sort().join('|');
    if(block.questionType==='shortAnswer' && block.acceptedAnswers){
      const format = block.answerFormat ?? 'text';
      const normalize = value => format === 'text' ? value.trim().replace(/\s+/g,' ').toLowerCase() : value.replace(/\r\n|\r/g,'\n').trim();
      return block.acceptedAnswers.some(text=>normalize(text)===normalize(answer.text));
    }
    return undefined;
  }
  function feedback(block, answer, box) {
    const feedback=node('div',undefined,'feedback'), correct=answerCorrect(block,answer);
    feedback.append(node('strong',correct===undefined?'回答已保存':correct?'回答正确':'再对照解析想一想'));
    if(block.explanation){const details=node('details'),summary=node('summary','查看解析');details.append(summary,node('p',block.explanation));feedback.append(details);}
    box.append(feedback);
  }
  function question(block, box) {
    const answer=draft(block), committed=saved.get(block.id);
    if(block.questionType==='shortAnswer'){
      const kind=block.input?.kind??'text', input=node(kind==='integer'||kind==='decimal'?'input':'textarea');input.setAttribute('aria-label',block.input?.placeholder??'你的回答');input.placeholder=block.input?.placeholder??'填写你的回答';input.value=answer.text;input.maxLength=20000;
      if(kind==='integer'||kind==='decimal'){input.type='text';input.inputMode=kind==='integer'?'numeric':'decimal';}else{input.rows=block.input?.minLines??(kind==='code'?6:2);input.style.maxHeight=`${Math.min(block.input?.maxLines??18,24)*1.6+2}em`;}
      if(kind==='code'){input.className='code-input';input.spellcheck=false;input.autocapitalize='off';input.autocorrect='off';input.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();const a=input.selectionStart,z=input.selectionEnd;input.setRangeText('    ',a,z,'end');input.dispatchEvent(new Event('input'));}};}
      const resize=()=>{if(input.tagName==='TEXTAREA'){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,window.innerHeight*.48)+'px';}};
      input.oninput=()=>{resize();answer.text=input.value;const f=box.querySelector('.feedback');if(f)f.remove();sendState();};box.append(input);requestAnimationFrame(resize);
      if(block.execution){const tools=node('div',undefined,'toolbar'),run=button('▶ 运行代码',()=>{if(!answer.text.trim()||pending)return false;const id=requestID();runs.set(id,{blockID:block.id});run.disabled=true;post({type:'run',requestID:id,blockID:block.id,answer:answer.text,stdin:stdin.value});});
        const details=node('details'),stdin=node('textarea');stdin.rows=2;stdin.maxLength=4000;stdin.value=block.execution.stdin??'';stdin.setAttribute('aria-label','程序输入');details.append(node('summary','程序输入'),stdin);tools.append(run);box.append(details,tools);const result=runs.get(block.id);if(result)box.append(node('pre',result,'output'));}
    }else for(const option of block.options??[]){const selected=answer.selectedOptionIDs.includes(option.id),b=button(option.text,()=>{if(selected&&block.questionType!=='multipleChoice')return false;if(block.questionType==='multipleChoice')answer.selectedOptionIDs=selected?answer.selectedOptionIDs.filter(id=>id!==option.id):[...answer.selectedOptionIDs,option.id];else answer.selectedOptionIDs=[option.id];render();},'option'+(selected?' selected':''));b.setAttribute('aria-pressed',String(selected));box.append(b);}
    if(block.hints?.length){const hints=node('details');hints.append(node('summary','提示'));block.hints.forEach(hint=>hints.append(node('p',hint)));box.append(hints);}
    if(committed&&equalAnswer(answer,committed))feedback(block,committed,box);
  }
  function sendState(){
    const flash = flashcardStates.get(lesson.blocks[index].id);
    const localPrevious = !!(flash?.revealed || flash?.card > 0) || (traceStates.get(lesson.blocks[index].id)?.frame ?? 0) > 0 || [...feedbackFrames.values()].some(entry => entry.primary?.canPrevious);
    post({type:'state',index,count:lesson.blocks.length,canPrevious:!pending && (localPrevious||index>0||data.lessonIndex>0),canNext:!pending});
  }
  function fitControls(){
    const content = root.lastElementChild; if (!content?.getBoundingClientRect) return;
    const height = window.visualViewport?.height ?? window.innerHeight;
    const reserve = parseFloat(getComputedStyle(document.body).getPropertyValue('--control-space')) || 148;
    document.body.classList.toggle('needs-control-space', content.getBoundingClientRect().bottom + (window.scrollY ?? 0) > height - reserve);
  }
  function render(){
    feedbackFrames.clear();
    const block=lesson.blocks[index],heading=node('header',undefined,'heading');if(block.title)heading.append(node('h1',block.title));heading.append(node('div',`${index+1} / ${lesson.blocks.length}`,'eyebrow'));
    const context=effectiveCode(block),workspace=node('div',undefined,'workspace'+(context.code?' with-reference':'')),reference=node('aside',undefined,'card reference');
    if(context.code){const explicit=block.focusLines!==undefined||block.focusSpans!==undefined;reference.append(node('div',context.code.filename??`本节程序 · ${context.code.language}`,'muted'),codeView(context.code,explicit?block.focusLines??[]:context.inherited?[]:context.code.highlightLines??[],explicit?block.focusSpans??[]:context.inherited?[]:context.code.highlightSpans??[]));workspace.append(reference);}
    const content=node('article',undefined,'card'+(block.type==='callout'?' callout':''));
    if(block.text)content.append(node('p',block.text));
    if(block.presentation)content.append(presentation(block,context.code?reference:null));
    if(block.type==='question')question(block,content);
    if(block.type==='chart'){content.append(chart(block));if(block.caption)content.append(node('p',block.caption,'muted'));}
    if(block.type==='image')content.append(node('p',block.caption??'本课程的外部图片未加载。','muted'));
    if(pending)content.append(node('p','正在保存…','muted'));
    workspace.append(content);root.replaceChildren(heading,workspace);sendState();requestAnimationFrame(fitControls);
  }
  function showError(message){haptic('error',true);const old=root.querySelector('.error');if(old)old.remove();root.append(node('p',message||'保存失败，请重试。','error'));sendState();}
  function advance(){
    if(pending||!initialized)return;
    const block=lesson.blocks[index];
    if(block.type==='question'){
      const answer=draft(block);if(!equalAnswer(answer,saved.get(block.id))||!saved.has(block.id)){
        if(block.questionType==='shortAnswer'?!answer.text.trim():!answer.selectedOptionIDs.length){showError('请先填写回答。');return;}
        const id=requestID();pending={id,type:'submit',blockID:block.id,answer:structuredClone(answer)};post({type:'submit',requestID:id,blockID:block.id,...answer});sendState();return;
      }
    }
    if(flashcardAction('next')||traceAction('next')||frameAction('next'))return;
    if(index<lesson.blocks.length-1){index++;render();window.scrollTo(0,0);}else{const id=requestID();pending={id,type:'complete'};post({type:'complete',requestID:id,completed:true});sendState();}
  }
  window.WorkshopPlayer={receive(message){
    if(!message||typeof message.type!=='string')return;
    if(message.type==='init'){
      document.body.classList.toggle('dark',message.theme==='dark');
      document.body.classList.toggle('control-left',message.controlSide==='left');
      document.body.classList.toggle('control-right',message.controlSide!=='left');
      hapticsEnabled = message.hapticsEnabled !== false;
      if(!initialized){for(const answer of message.progress?.answers??[]){if(String(answer.lessonID).toLowerCase()===lesson.id.toLowerCase()){const block=lesson.blocks.find(b=>b.id.toLowerCase()===String(answer.blockID).toLowerCase());if(block){const value={selectedOptionIDs:answer.selectedOptionIDs??[],text:answer.text??''};saved.set(block.id,structuredClone(value));drafts.set(block.id,value);}}}initialized=true;render();}return;
    }
    if(message.type==='next'){advance();return;}
    if(message.type==='previous'){if(pending||!initialized)return;if(flashcardAction('previous')||traceAction('previous')||frameAction('previous'))return;if(index>0){index--;render();window.scrollTo(0,0);}else post({type:'navigation',direction:'previousLesson'});return;}
    if(message.type==='saved'&&pending&&message.requestID===pending.id){const action=pending;pending=null;if(!message.ok){showError(message.error);return;}if(action.type==='submit'){const block=lesson.blocks.find(b=>b.id===action.blockID),correct=answerCorrect(block,action.answer);haptic(correct===true?'success':correct===false?'warning':'impact',true);saved.set(action.blockID,action.answer);render();}else{haptic('success',true);post({type:'navigation',direction:'nextLesson'});sendState();}return;}
    if(message.type==='runResult'&&runs.has(message.requestID)){const result=message.result;if(message.error||result?.status!=='cancelled')haptic(message.error||result?.status!=='completed'?'error':result.passed===false?'warning':result.passed===true?'success':'impact',true);const run=runs.get(message.requestID);runs.delete(message.requestID);const r=message.result;runs.set(run.blockID,message.error??[r?.stdout,r?.stderr,r?.passed===undefined?'':r.passed?'输出符合预期':'输出与预期不同',r?.status].filter(Boolean).join('\n'));render();}
  }};
  document.addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('summary'))haptic('selection');});
  const viewport=()=>{const height=window.visualViewport?.height??window.innerHeight;document.body.classList.toggle('keyboard-visible',window.innerHeight-height>120);requestAnimationFrame(fitControls);};
  window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);viewport();
  // Native sends saved progress/theme after ready; render once with that state.
  post({type:'ready'});
}
