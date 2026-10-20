// Trusted renderer owned by the service. Course strings are data, never trusted markup.
export const playerProtocol = 'WORKSHOP-PLAYER/1';
export const rendererVersion = '2026.10.20.3';
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
:root{color-scheme:light dark;--bg:#f2f2f7;--panel:#fff;--text:#1c1c1e;--muted:#707078;--line:#dedee4;--accent:#52758f;--soft:#e9eff4;--mark:#f6e0a0;--input:#fff;--bottom-space:148px;--corner-margin:0 0 0 auto}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html{scroll-padding-bottom:calc(var(--bottom-space) + env(safe-area-inset-bottom,0px));-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.53 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}body.dark{--bg:#000;--panel:#1c1c1e;--text:#f2f2f7;--muted:#a4a4ad;--line:#38383a;--accent:#9dc3df;--soft:#22333f;--mark:#695221;--input:#1c1c1e}body.control-left{--corner-margin:0 auto 0 0}body.keyboard-visible{--bottom-space:100px}
main{max-width:1240px;margin:auto;padding:12px 20px calc(var(--bottom-space) + env(safe-area-inset-bottom,0px));overflow-wrap:anywhere}main:after{content:'';display:block;width:76px;height:1px;margin:var(--corner-margin);pointer-events:none}.heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 18px}.eyebrow,.muted{color:var(--muted);font-size:13px}.eyebrow{font-variant-numeric:tabular-nums;flex-shrink:0}h1{font-size:22px;font-weight:650;letter-spacing:-.4px;line-height:1.3;margin:0}h2{font-size:19px;font-weight:600;line-height:1.4;margin:0 0 10px}p{margin:0 0 18px;white-space:pre-wrap}.workspace{display:grid;gap:20px;align-items:start}.card{background:var(--panel);border:0;border-radius:16px;padding:16px;min-width:0}article.card{background:transparent;padding:0;border:0;border-radius:0}article.card>:last-child{margin-bottom:0}.reference{position:sticky;top:0;max-height:38vh;overflow:auto;padding:12px 8px;box-shadow:0 1px 0 var(--line);z-index:1}.reference>.muted{padding:0 8px 7px}.reference summary{cursor:pointer;font-weight:600}
.code{font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto;white-space:pre;padding:0;margin:0;tab-size:4}.code .line{display:block;min-width:max-content;padding:0 8px;border-radius:4px}.code .line.active{background:var(--soft)}.number{display:inline-block;min-width:3ch;margin-right:12px;opacity:.45;user-select:none}mark{background:var(--mark);color:inherit;border-radius:3px}.tok-comment{color:#7b8790}.tok-string{color:#9d6035}.tok-number{color:#975ab2}.tok-keyword{color:#466da6}.dark .tok-string{color:#e2ae7d}.dark .tok-number{color:#d5a2eb}.dark .tok-keyword{color:#8fbaff}.annotation{font:12px/1.5 -apple-system,system-ui;color:var(--muted);margin-left:20px}
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0}button,select,input,textarea{font:inherit;color:inherit;-webkit-appearance:none;appearance:none}button,select{min-height:44px;border-radius:13px;border:0;background:var(--soft);padding:10px 15px;cursor:pointer;touch-action:manipulation}button{position:relative;overflow:hidden;transform:translateZ(0)}button:active:not(:disabled),summary:active{filter:brightness(.91);transform:scale(.98)}button[disabled]{opacity:.4;cursor:default}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button.selected{background:var(--soft);box-shadow:inset 0 0 0 1.5px var(--accent)}select{padding-right:32px;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 17px) 20px,calc(100% - 12px) 20px;background-size:5px 5px;background-repeat:no-repeat}
.option{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--panel);margin:0;min-height:54px;border-radius:0;padding:14px 16px;box-shadow:inset 0 -1px 0 var(--line)}.option:before{content:'○';flex:0 0 24px;font-size:24px;line-height:24px;color:var(--muted)}.option.selected:before{content:'●';color:var(--accent)}.option.selected{background:var(--soft);box-shadow:inset 0 -1px 0 var(--line)}.option:first-of-type{border-radius:15px 15px 0 0}.option:last-of-type{border-radius:0 0 15px 15px;box-shadow:none}.option:only-of-type{border-radius:15px}.option:active:not(:disabled){transform:none;background:var(--soft)}
textarea,input{display:block;width:100%;resize:none;background:var(--input);border:1px solid var(--line);border-radius:14px;padding:13px 14px;outline:none;min-height:48px;max-height:55vh;caret-color:var(--accent);scroll-margin-bottom:calc(var(--bottom-space) + 12px)}textarea:focus,input:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 14%,transparent)}::placeholder{color:var(--muted);opacity:.8}textarea.code-input{font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:4;white-space:pre;overflow:auto}.feedback{margin-top:18px;padding:14px 16px;background:var(--soft);border-radius:14px}.error{color:#c83c32;font-size:15px;margin-top:16px}.dark .error{color:#ff746b}.objects,.comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.object{padding:16px;border-radius:14px;background:var(--panel)}.object.changed{box-shadow:inset 0 0 0 1.5px var(--accent)}.object strong{display:block;font-size:32px;line-height:1.4}.output{background:var(--panel);padding:14px;border-radius:14px;white-space:pre-wrap;font:14px/1.6 ui-monospace,monospace}.table-scroll{overflow:auto;border-radius:14px;background:var(--panel)}table{border-collapse:collapse;width:100%;font-size:15px}td,th{text-align:left;border-bottom:1px solid var(--line);padding:11px 13px;min-width:90px}th{font-weight:600}tr:last-child td{border-bottom:0}details{margin:14px 0}summary{display:list-item;cursor:pointer;min-height:44px;padding:10px 0;color:var(--accent)}iframe{display:block;width:100%;border:0;background:transparent;min-height:120px;border-radius:14px}svg.chart{width:100%;height:auto;max-height:360px}.flash{width:100%;padding:24px;white-space:pre-wrap;margin:8px 0;background:var(--panel);min-height:88px}.steps{padding-left:24px}.steps li{padding-left:5px;margin-bottom:20px}.chart-label{font:12px -apple-system,system-ui;fill:var(--muted)}.chart-bar{fill:var(--accent)}blockquote{margin:14px 0;border-left:3px solid var(--accent);padding-left:16px;color:var(--muted)}.markdown code:not(.code){background:var(--soft);padding:2px 5px;border-radius:4px}.markdown pre{overflow:auto;white-space:pre;background:var(--panel);padding:15px;border-radius:14px}.markdown p{white-space:normal}.callout>p:first-child{padding:13px 16px;background:var(--soft);border-radius:14px}.comparison .card{padding:16px}
@media(min-width:850px){main{padding:18px 28px calc(var(--bottom-space) + env(safe-area-inset-bottom,0px))}.workspace.with-reference{grid-template-columns:minmax(280px,.85fr) minmax(360px,1.15fr);gap:26px}.reference{max-height:calc(100vh - 115px)}.heading{margin-bottom:18px}}
@media(orientation:landscape) and (max-height:500px){:root{--bottom-space:124px}main{padding:8px 16px calc(var(--bottom-space) + env(safe-area-inset-bottom,0px))}.heading{margin-bottom:10px}h1{font-size:19px}.workspace{gap:14px}.workspace.with-reference{grid-template-columns:minmax(220px,.8fr) minmax(260px,1.2fr)}.reference{max-height:calc(100vh - 65px)}body.keyboard-visible{--bottom-space:88px}}
@media(prefers-reduced-motion:no-preference){button,summary{transition:background .12s,filter .12s,transform .12s}}`;

function playerRuntime(data) {
  'use strict';
  const lesson = data.lesson, root = document.getElementById('app');
  let index = 0, pending = null, initialized = false, hapticsEnabled = true, lastHaptic = -100;
  const drafts = new Map(), saved = new Map(), traceStates = new Map(), runs = new Map(), feedbackFrames = new Map();
  const post = message => window.webkit?.messageHandlers?.workshopPlayer?.postMessage(message);
  const haptic = style => { const time = performance.now(); if (hapticsEnabled && time - lastHaptic >= 45) { lastHaptic = time; post({type:'haptic',style}); } };
  const requestID = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });
  const node = (tag, text, cls) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (cls) element.className = cls; return element; };
  const button = (text, action, cls) => { const value = node('button', text, cls); value.type = 'button'; value.onclick = event => { if (value.disabled) return; haptic(cls?.includes('option') ? 'selection' : 'impact'); action(event); }; return value; };
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
    const token = requestID(), frame = document.createElement('iframe'); feedbackFrames.set(frame, token); frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer'); frame.title = '离线互动演示';
    frame.style.height = `${Math.max(120, Math.min(640, height ?? 320))}px`;
    frame.srcdoc = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; img-src \'none\'; frame-src \'none\'; object-src \'none\'; media-src \'none\'; font-src \'none\'; base-uri \'none\'; form-action \'none\'"><style>:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui;overflow-wrap:anywhere}svg{max-width:100%;height:auto}button,input,select{font:inherit;min-height:44px}</style></head><body>' + '<script>(' + iframeFeedback.toString() + ')(' + JSON.stringify(token) + ');<\/script>' + source + '</body></html>';
    return frame;
  }
  function iframeFeedback(token) {
    // This child can request tactile feedback only. It receives no account/answer/run capability.
    const send = style => parent.postMessage({type:'workshop-feedback',token,style}, '*');
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('button,[role=button],summary,input,select,[onclick],svg') : null;
      if (target && !target.disabled) send(target.matches('input,select,summary,svg') ? 'selection' : 'impact');
    }, true);
    document.addEventListener('change', event => {
      if (event.target instanceof Element && event.target.matches('input,select,textarea')) send('selection');
    }, true);
  }
  function iframeFeedbackAllowed(event) {
    const message = event.data;
    if (!message || message.type !== 'workshop-feedback' || !['selection','impact'].includes(message.style) || document.visibilityState === 'hidden') return false;
    for (const [frame, token] of feedbackFrames) {
      if (event.source !== frame.contentWindow || message.token !== token || !frame.isConnected) continue;
      const rect = frame.getBoundingClientRect(), style = getComputedStyle(frame), height = window.visualViewport?.height ?? window.innerHeight;
      if (style.visibility === 'hidden' || style.display === 'none' || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= height || rect.left >= window.innerWidth) return false;
      return true;
    }
    return false;
  }
  window.addEventListener('message', event => { if (iframeFeedbackAllowed(event)) haptic(event.data.style); });
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
    if (value.variants.length > 1) { const select = node('select'); value.variants.forEach((v,i) => { const option=node('option',v.title); option.value=i; select.append(option); }); select.value=state.variant; select.onchange=()=>{haptic('selection');state.variant=Number(select.value);state.frame=0;render();}; toolbar.append(select); }
    const variant = value.variants[state.variant], frame = variant.frames[state.frame];
    const back = button('←', () => {state.frame--;render();}); back.disabled=state.frame===0;
    const next = button('执行下一步 →', () => {state.frame++;render();}); next.disabled=state.frame===variant.frames.length-1;
    toolbar.append(back,node('span',`${state.frame+1} / ${variant.frames.length}`,'muted'),next); box.append(toolbar,node('h2',frame.title));
    reference.replaceChildren(node('div', variant.code.filename ?? variant.code.language, 'muted'), codeView(variant.code, frame.focusSpans?.length ? [] : [frame.line], frame.focusSpans ?? []));
    const objects=node('div',undefined,'objects'); frame.objects.forEach(o=>{const tile=node('div',undefined,'object'+(o.changed?' changed':''));tile.append(node('div',o.names.join(' · ')),node('strong',o.value));if(o.scope)tile.append(node('div',o.scope,'muted'));objects.append(tile);});
    box.append(objects,node('p',frame.note)); if(frame.output!==undefined)box.append(node('pre',frame.output || '（暂无输出）','output'));return box;
  }
  function presentation(block, reference) {
    const p=block.presentation, box=node('div'); if(!p)return box;
    switch(p.kind){
      case 'code': if(!reference)box.append(codeView(p.code,p.code.highlightLines??[],p.code.highlightSpans??[]));break;
      case 'markdown':box.append(markdown(p.markdown.source));break;
      case 'table':box.append(tableView(p.table));break;
      case 'steps':{const list=node('ol',undefined,'steps');p.steps.forEach(item=>{const li=node('li');li.append(node('h2',item.title),node('p',item.text));if(item.code)li.append(codeView(item.code,item.code.highlightLines??[],item.code.highlightSpans??[]));list.append(li);});box.append(list);break;}
      case 'comparison':{const grid=node('div',undefined,'comparison');p.items.forEach(item=>{const card=node('section',undefined,'card');card.append(node('h2',item.title),node('p',item.text));if(item.code)card.append(codeView(item.code,item.code.highlightLines??[],item.code.highlightSpans??[]));grid.append(card);});box.append(grid);break;}
      case 'flashcards':p.cards.forEach(card=>{let flipped=false;const b=button(card.front,()=>{flipped=!flipped;b.textContent=flipped?card.back:card.front;b.setAttribute('aria-pressed',String(flipped));},'flash');box.append(b);});break;
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
  function feedback(block, answer, box) {
    const feedback=node('div',undefined,'feedback');
    let correct;
    if(block.questionType!=='shortAnswer' && block.correctOptionIDs)correct=[...answer.selectedOptionIDs].sort().join('|')===[...block.correctOptionIDs].sort().join('|');
    if(block.questionType==='shortAnswer' && block.acceptedAnswers)correct=block.acceptedAnswers.some(text=>text.trim()===answer.text.trim());
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
      if(block.execution){const tools=node('div',undefined,'toolbar'),run=button('▶ 运行代码',()=>{if(!answer.text.trim()||pending)return;const id=requestID();runs.set(id,{blockID:block.id});run.disabled=true;post({type:'run',requestID:id,blockID:block.id,answer:answer.text,stdin:stdin.value});});
        const details=node('details'),stdin=node('textarea');stdin.rows=2;stdin.maxLength=4000;stdin.value=block.execution.stdin??'';stdin.setAttribute('aria-label','程序输入');details.append(node('summary','程序输入'),stdin);tools.append(run);box.append(details,tools);const result=runs.get(block.id);if(result)box.append(node('pre',result,'output'));}
    }else for(const option of block.options??[]){const selected=answer.selectedOptionIDs.includes(option.id),b=button(option.text,()=>{if(block.questionType==='multipleChoice')answer.selectedOptionIDs=selected?answer.selectedOptionIDs.filter(id=>id!==option.id):[...answer.selectedOptionIDs,option.id];else answer.selectedOptionIDs=[option.id];render();},'option'+(selected?' selected':''));b.setAttribute('aria-pressed',String(selected));box.append(b);}
    if(block.hints?.length){const hints=node('details');hints.append(node('summary','提示'));block.hints.forEach(hint=>hints.append(node('p',hint)));box.append(hints);}
    if(committed&&equalAnswer(answer,committed))feedback(block,committed,box);
  }
  function sendState(){post({type:'state',index,count:lesson.blocks.length,canPrevious:index>0||data.lessonIndex>0,canNext:!pending});}
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
    workspace.append(content);root.replaceChildren(heading,workspace);sendState();
  }
  function showError(message){haptic('error');const old=root.querySelector('.error');if(old)old.remove();root.append(node('p',message||'保存失败，请重试。','error'));sendState();}
  function advance(){
    if(pending||!initialized)return;
    const block=lesson.blocks[index];
    if(block.type==='question'){
      const answer=draft(block);if(!equalAnswer(answer,saved.get(block.id))||!saved.has(block.id)){
        if(block.questionType==='shortAnswer'?!answer.text.trim():!answer.selectedOptionIDs.length){showError('请先填写回答。');return;}
        const id=requestID();pending={id,type:'submit',blockID:block.id,answer:structuredClone(answer)};post({type:'submit',requestID:id,blockID:block.id,...answer});sendState();return;
      }
    }
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
    if(message.type==='previous'){if(pending)return;if(index>0){index--;render();window.scrollTo(0,0);}else post({type:'navigation',direction:'previousLesson'});return;}
    if(message.type==='saved'&&pending&&message.requestID===pending.id){const action=pending;pending=null;if(!message.ok){showError(message.error);return;}haptic('success');if(action.type==='submit'){saved.set(action.blockID,action.answer);render();}else{post({type:'navigation',direction:'nextLesson'});sendState();}return;}
    if(message.type==='runResult'&&runs.has(message.requestID)){haptic(message.error||message.result?.passed===false?'error':'success');const run=runs.get(message.requestID);runs.delete(message.requestID);const r=message.result;runs.set(run.blockID,message.error??[r?.stdout,r?.stderr,r?.passed===undefined?'':r.passed?'输出符合预期':'输出与预期不同',r?.status].filter(Boolean).join('\n'));render();}
  }};
  document.addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('summary'))haptic('selection');});
  const viewport=()=>{const height=window.visualViewport?.height??window.innerHeight;document.body.classList.toggle('keyboard-visible',window.innerHeight-height>120);};
  window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);viewport();
  render();post({type:'ready'});
}
