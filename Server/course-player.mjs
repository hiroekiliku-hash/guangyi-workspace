// Trusted renderer owned by the service. Course strings are data, never trusted markup.
export const playerProtocol = 'WORKSHOP-PLAYER/1';
export const rendererVersion = '2026.10.20.1';
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function renderCoursePlayer(course, lessonID, courseRevision) {
  const lesson = course.lessons.find(item => item.id.toLowerCase() === lessonID.toLowerCase());
  if (!lesson) throw new Error('COURSE_LESSON_NOT_FOUND');
  const data = { courseID: course.id, courseRevision, referenceCode: course.referenceCode, lessonIndex: course.lessons.indexOf(lesson), lesson };
  return { protocol: playerProtocol, rendererVersion, courseID: course.id, lessonID: lesson.id, courseRevision,
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; img-src 'none'; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${playerCSS}</style></head><body><main id="app" aria-live="polite"></main><script>const curriculum=${json(data)};(${playerRuntime.toString()})(curriculum);</script></body></html>` };
}
const playerCSS = `
:root{color-scheme:light dark;--bg:#f7f8fa;--panel:#fff;--text:#19242d;--muted:#6a7884;--line:#dbe2e8;--accent:#52758f;--soft:#e8f0f5;--mark:#fde8a8;--input:#f3f5f7}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}body.dark{--bg:#12171c;--panel:#1b232b;--text:#edf2f6;--muted:#a6b5c1;--line:#394750;--accent:#9dc3df;--soft:#263b4a;--mark:#725820;--input:#111a21}main{max-width:1200px;margin:auto;padding:16px 20px 28px;overflow-wrap:anywhere}.heading{margin-bottom:18px}.eyebrow,.muted{color:var(--muted);font-size:.84em}h1{font-size:1.5em;line-height:1.3;margin:6px 0 16px}h2{font-size:1.15em;margin:0 0 12px}p{margin:0 0 16px;white-space:pre-wrap}.workspace{display:grid;gap:18px;align-items:start}.card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:22px;min-width:0}.reference{position:sticky;top:10px;max-height:42vh;overflow:auto;padding:14px}.reference summary{cursor:pointer;font-weight:600}.code{font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto;white-space:pre;padding:12px 0;margin:0}.code .line{display:block;min-width:max-content;padding:0 10px;border-radius:4px}.code .line.active{background:var(--soft)}.number{display:inline-block;min-width:3ch;margin-right:16px;opacity:.45;user-select:none}mark{background:var(--mark);color:inherit;border-radius:3px}.tok-comment{color:#7b8790}.tok-string{color:#9d6035}.tok-number{color:#975ab2}.tok-keyword{color:#466da6}.dark .tok-string{color:#e2ae7d}.dark .tok-number{color:#d5a2eb}.dark .tok-keyword{color:#8fbaff}.annotation{font:12px/1.5 system-ui;color:var(--muted);margin-left:20px}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}button,select,input,textarea{font:inherit;color:inherit}button,select{min-height:44px;border-radius:14px;border:1px solid var(--line);background:var(--soft);padding:8px 14px;cursor:pointer}button[disabled]{opacity:.45;cursor:default}button.selected{outline:2px solid var(--accent);background:var(--soft)}.option{display:block;width:100%;text-align:left;background:var(--input);margin:10px 0;padding:14px}.option:before{content:'○';margin-right:12px}.option.selected:before{content:'●';color:var(--accent)}textarea,input{display:block;width:100%;resize:vertical;background:var(--input);border:1px solid var(--line);border-radius:14px;padding:14px;outline-color:var(--accent);min-height:48px;max-height:55vh}textarea.code-input{font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:4;white-space:pre;overflow:auto}.feedback{margin-top:18px;border-left:3px solid var(--accent);padding:10px 16px;background:var(--soft);border-radius:6px}.error{color:#b83e35}.objects,.comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.object{padding:16px;border-radius:14px;background:var(--soft)}.object.changed{outline:2px solid var(--accent)}.object strong{display:block;font-size:1.8em}.output{background:var(--input);padding:14px;border-radius:12px;white-space:pre-wrap;font:14px/1.6 ui-monospace,monospace}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.9em}td,th{text-align:left;border-bottom:1px solid var(--line);padding:10px;min-width:90px}details{margin:12px 0}summary{cursor:pointer;min-height:36px}iframe{display:block;width:100%;border:0;background:transparent;min-height:120px;border-radius:12px}svg.chart{width:100%;height:auto;max-height:360px}.flash{width:100%;padding:24px;white-space:pre-wrap}.steps{padding-left:25px}.steps li{padding-left:5px;margin-bottom:18px}.chart-label{font:12px system-ui;fill:var(--muted)}.chart-bar{fill:var(--accent)}blockquote{margin:12px 0;border-left:3px solid var(--accent);padding-left:16px;color:var(--muted)}.markdown code:not(.code){background:var(--soft);padding:2px 5px;border-radius:4px}.markdown pre{overflow:auto;white-space:pre;background:var(--input);padding:16px;border-radius:12px}.markdown p{white-space:normal}.callout{border-left:4px solid var(--accent)}@media(min-width:850px){.workspace.with-reference{grid-template-columns:minmax(280px,.85fr) minmax(360px,1.15fr)}.reference{max-height:calc(100vh - 150px)}main{padding:24px 30px 40px}}@media(orientation:landscape) and (max-height:500px){main{padding:8px 16px}.heading{margin-bottom:8px}h1{font-size:1.15em;margin:2px 0 8px}.workspace.with-reference{grid-template-columns:minmax(220px,.8fr) minmax(260px,1.2fr)}.reference{max-height:calc(100vh - 90px)}.card{padding:14px}}@media(prefers-reduced-motion:no-preference){button{transition:background .15s,outline-color .15s}}`;

function playerRuntime(data) {
  'use strict';
  const lesson = data.lesson, root = document.getElementById('app');
  let index = 0, pending = null, initialized = false;
  const drafts = new Map(), saved = new Map(), traceStates = new Map(), runs = new Map();
  const post = message => window.webkit?.messageHandlers?.workshopPlayer?.postMessage(message);
  const requestID = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });
  const node = (tag, text, cls) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (cls) element.className = cls; return element; };
  const button = (text, action, cls) => { const value = node('button', text, cls); value.type = 'button'; value.onclick = action; return value; };
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
    const frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer'); frame.title = '离线互动演示';
    frame.style.height = `${Math.max(120, Math.min(640, height ?? 320))}px`;
    frame.srcdoc = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; img-src \'none\'; frame-src \'none\'; object-src \'none\'; media-src \'none\'; font-src \'none\'; base-uri \'none\'; form-action \'none\'"><style>:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui;overflow-wrap:anywhere}svg{max-width:100%;height:auto}button,input,select{font:inherit;min-height:44px}</style></head><body>' + source + '</body></html>';
    return frame;
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
    if (value.variants.length > 1) { const select = node('select'); value.variants.forEach((v,i) => { const option=node('option',v.title); option.value=i; select.append(option); }); select.value=state.variant; select.onchange=()=>{state.variant=Number(select.value);state.frame=0;render();}; toolbar.append(select); }
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
    const block=lesson.blocks[index],heading=node('header',undefined,'heading');heading.append(node('div',`${lesson.title} · ${index+1} / ${lesson.blocks.length}`,'eyebrow'));if(block.title)heading.append(node('h1',block.title));
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
  function showError(message){const old=root.querySelector('.error');if(old)old.remove();root.append(node('p',message||'保存失败，请重试。','error'));sendState();}
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
      if(!initialized){for(const answer of message.progress?.answers??[]){if(String(answer.lessonID).toLowerCase()===lesson.id.toLowerCase()){const block=lesson.blocks.find(b=>b.id.toLowerCase()===String(answer.blockID).toLowerCase());if(block){const value={selectedOptionIDs:answer.selectedOptionIDs??[],text:answer.text??''};saved.set(block.id,structuredClone(value));drafts.set(block.id,value);}}}initialized=true;render();}return;
    }
    if(message.type==='next'){advance();return;}
    if(message.type==='previous'){if(pending)return;if(index>0){index--;render();window.scrollTo(0,0);}else post({type:'navigation',direction:'previousLesson'});return;}
    if(message.type==='saved'&&pending&&message.requestID===pending.id){const action=pending;pending=null;if(!message.ok){showError(message.error);return;}if(action.type==='submit'){saved.set(action.blockID,action.answer);render();}else{post({type:'navigation',direction:'nextLesson'});sendState();}return;}
    if(message.type==='runResult'&&runs.has(message.requestID)){const run=runs.get(message.requestID);runs.delete(message.requestID);const r=message.result;runs.set(run.blockID,message.error??[r?.stdout,r?.stderr,r?.passed===undefined?'':r.passed?'输出符合预期':'输出与预期不同',r?.status].filter(Boolean).join('\n'));render();}
  }};
  render();post({type:'ready'});
}
