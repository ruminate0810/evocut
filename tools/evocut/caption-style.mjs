/** Local short-form caption rails. No network, copied templates, matte, or automatic ASR. */
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

export const styles=[
  ['highlight','逐字高亮','preset','Reveal timed units progressively. The active unit defaults to red with white text.'],
  ['multiline','双行分层','preset','Split a thought into two authored reading lines.'],
  ['word','单词节拍','preset','Show only the current spoken word or phrase.'],
  ['frame','框景字幕','preset','A dark field, pale outline and contrasting corner marks.'],
  ['monoline','极简单行','preset','A single measured line and a fine baseline.'],
  ['aesthetic','纸页旁注','preset','A warm print-style quotation with editorial rules.'],
  ['glow','霓虹辉光','preset','A luminous aqua core on a dark indigo field.'],
  ['trending','精选混搭','collection','Local, versioned edit: highlight, frame and word in sequence. Not a live ranking.']
].map(([id,label,kind,description])=>({id,label,kind,description}));
const allowed=new Set(styles.map(s=>s.id)), picks=['highlight','frame','word'];
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v.toFixed(6));
const size=s=>Array.from(s).reduce((a,c)=>a+(/\s/.test(c)?.33:/[\x21-\x7e]/.test(c)?.64:1),0);
const flag=(v,m)=>{if(!v)throw Error(m)};
export const palette={red:'#C62828',gold:'#FFCF67',blue:'#72B8FF',mint:'#72E1B7',coral:'#FF9386',lilac:'#BCA7FF',navy:'#253D77'};
export function marker(value='red'){
  const bg=(typeof value==='string'&&(Object.hasOwn(palette,value)?palette[value]:value.toUpperCase()));
  flag(typeof bg==='string'&&/^#[0-9A-F]{6}$/.test(bg),'Highlight color must be a palette name or #RRGGBB');
  const lum=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  const l=lum(bg),fg=(l+.05)/(lum('#162326')+.05)>=4.5?'#162326':1.05/(l+.05)>=4.5?'#FFFFFF':'#000000';
  return {bg,fg};
}
const css=`
.ecs-rail{position:absolute;left:8.9%;width:71.1%;bottom:18%;z-index:40;display:flex;align-items:flex-end;justify-content:center;pointer-events:none;}
.ecs-face{position:relative;max-width:100%;box-sizing:border-box;color:white;text-align:center;font:760 var(--ecs-f)/1.26 var(--ecs-sans,system-ui,sans-serif);overflow-wrap:anywhere;text-wrap:balance;letter-spacing:0;}
.ecs-token{display:inline-block;white-space:pre;}
.ecs-highlight .ecs-face{padding:.18em .35em;background:#141917ee;color:#fff;border-radius:.24em;}
.ecs-highlight .ecs-token{border-radius:.15em;padding:.025em .025em;}
.ecs-highlight .ecs-on{background:#f3ff68;color:#161c12;}
.ecs-highlight[data-caption-group="highlight"] .ecs-on{background:var(--ecs-bg);color:var(--ecs-fg);}
.ecs-progressive .ecs-face{background:none;padding:0;color:#fff;}
.ecs-progressive .ecs-shown{background:#112428ef;}
.ecs-progressive .ecs-future{visibility:hidden;}
.ecs-multiline{justify-content:flex-start;}
.ecs-multiline .ecs-face{text-align:left;border-left:.12em solid #ff916c;padding:.09em .35em .12em;background:#172823f5;}
.ecs-multiline .ecs-line{display:block;}
.ecs-multiline .ecs-line:first-child{font-size:.76em;font-weight:540;color:#d5e1d9;margin-bottom:.08em;}
.ecs-multiline .ecs-line:last-child{font-weight:850;color:#fff9e8;}
.ecs-word .ecs-face{color:#fff8eb;font-weight:930;letter-spacing:.015em;paint-order:stroke fill;-webkit-text-stroke:.076em #201923;text-shadow:.045em .062em 0 #d84427;}
.ecs-frame .ecs-face{background:#102623f5;color:#f2fff7;border:.045em solid #c6f1d2;padding:.23em .62em;}
.ecs-frame .ecs-face:before,.ecs-frame .ecs-face:after{content:"";position:absolute;width:.34em;height:.34em;border-color:#99ffc2;border-style:solid;}
.ecs-frame .ecs-face:before{top:-.085em;left:-.085em;border-width:.09em 0 0 .09em;}
.ecs-frame .ecs-face:after{bottom:-.085em;right:-.085em;border-width:0 .09em .09em 0;}
.ecs-monoline .ecs-face{white-space:nowrap;font-weight:490;line-height:1.38;background:#15202aeb;border-bottom:.029em solid #edf2fa;color:#fff;padding:.02em .28em .07em;}
.ecs-aesthetic .ecs-face{font-family:var(--ecs-serif,serif);font-weight:640;color:#462e21;background:#fff1d9;border-top:.043em solid #986b49;border-bottom:.043em solid #986b49;padding:.17em .52em .2em;box-shadow:0 .10em 0 #523b2755;}
.ecs-glow .ecs-face{color:#f1fffe;background:#13152ff2;border-radius:.22em;padding:.18em .46em;letter-spacing:.025em;text-shadow:0 0 .055em #60ffff,0 0 .17em #20d6ff,0 0 .38em #337cff;}
`;
function rows(tokens,after){
  if(after===undefined){let best=1,d=Infinity;for(let i=1;i<tokens.length;i++){const a=Math.abs(size(tokens.slice(0,i).join(''))-size(tokens.slice(i).join('')));if(a<d){best=i;d=a}}after=best;}
  return [tokens.slice(0,after).join(''),tokens.slice(after).join('')].filter(Boolean);
}
export function compile(input,style='highlight',opts={}){
  flag(allowed.has(style),'Unknown style '+style);
  const {bg,fg}=marker(opts.highlightColor??input.highlightColor??'red');
  const mode=opts.highlightMode??input.highlightMode??'progressive';
  flag(['progressive','sentence'].includes(mode),'Invalid highlight mode');
  const {width:w,height:h,duration,cues}=input;
  flag([w,h].every(x=>Number.isInteger(x)&&x>0)&&Number.isFinite(duration)&&duration>0,'Invalid canvas or duration');
  flag(Array.isArray(cues)&&cues.length,'Expected timed cues');
  let prev=0,serial=0,trending=0;const markup=[];
  for(const [i,c] of cues.entries()){
    const {start,end,words}=c, choice=c.style??style;
    flag(allowed.has(choice)&&[start,end].every(Number.isFinite)&&start>=prev&&end>start&&end<=duration,'Invalid style, overlapping cue or range at cue '+i);
    flag(Array.isArray(words)&&words.length&&words.every((v,j)=>v&&typeof v.text==='string'&&v.text.trim()&&Number.isFinite(v.at)&&(j?v.at>words[j-1].at:v.at===start)&&v.at<end),'Invalid word text/timing at cue '+i);
    if(c.lineAfter!==undefined)flag(Number.isInteger(c.lineAfter)&&c.lineAfter>0&&c.lineAfter<words.length,'Invalid lineAfter at cue '+i);
    prev=end;const kind=choice==='trending'?picks[trending++%picks.length]:choice;
    const tokens=words.map(v=>v.text),lines=rows(tokens,c.lineAfter),all=tokens.join('');
    const make=(a,b,body,str,factor,available)=>{
      const fit=Math.min(w*factor,w*available/Math.max(1,size(str)));
      const typed=choice==='highlight'&&mode==='progressive';
      const colors=choice==='highlight'?`;--ecs-bg:${bg};--ecs-fg:${fg}`:'';
      markup.push(`<div class="clip ecs-rail ecs-${kind}${typed?' ecs-progressive':''}" id="ecs-rail-${serial++}" data-start="${n(a)}" data-duration="${n(b-a)}" data-track-index="81" data-caption-group="${choice}" data-layout-overflow-allow style="--ecs-f:${n(fit)}px${colors}"><div class="ecs-face">${body}</div></div>`);};
    if(choice==='highlight'&&mode==='progressive'){
      const units=c.glyphs??words;
      flag(Array.isArray(units)&&units.length&&units.every((u,j)=>u&&typeof u.text==='string'&&u.text.length&&Number.isFinite(u.at)&&(j?u.at>units[j-1].at:u.at===start)&&u.at<end)&&units.map(u=>u.text).join('')===all,'Glyphs must have increasing source times and match cue text at cue '+i);
      units.forEach((u,j)=>{
        const next=units[j+1]?.at??end;
        if(u.end!==undefined)flag(Number.isFinite(u.end)&&u.end>u.at&&u.end<=next,'Invalid glyph end at cue '+i);
        const state=on=>units.map((q,k)=>`<span class="ecs-token ${k>j?'ecs-future':on&&k===j?'ecs-on':'ecs-shown'}"${k>j?' aria-hidden="true"':''}>${esc(q.text)}</span>`).join('');
        make(u.at,u.end??next,state(true),all,.052,.60);
        if(u.end!==undefined&&u.end<next)make(u.end,next,state(false),all,.052,.60);
      });
    }
    else if(kind==='highlight'||kind==='word')words.forEach((v,j)=>{
      const body=kind==='word'?esc(v.text):tokens.map((s,k)=>`<span class="ecs-token${k===j?' ecs-on':''}">${esc(s)}</span>`).join('');
      make(v.at,words[j+1]?.at??end,body,kind==='word'?v.text:all,kind==='word'?.091:.049,kind==='word'?.66:.60);
    });
    else if(kind==='multiline')make(start,end,lines.map(s=>`<span class="ecs-line">${esc(s)}</span>`).join(''),lines.reduce((a,b)=>size(a)>size(b)?a:b),.061,.62);
    else if(kind==='aesthetic')make(start,end,'「'+esc(all)+'」','「'+all+'」',.054,.63);
    else make(start,end,esc(all),all,kind==='monoline'?.043:.051,kind==='frame'?.61:.64);
  }
  return {css,markup:markup.join('\n')};
}
const anchor='<!-- evocut:captions -->',close='<!-- /evocut:captions -->';
const styleTag=x=>'<style id="ecs-caption-css">'+x+'</style>';
export function apply(html,result,input){
  flag((html.split(anchor).length===2)&&html.includes('</head>'),'Expected exactly one <!-- evocut:captions --> slot inside the composition and a head');
  const root=html.match(/<[\w-]+\b[^>]*\bdata-composition-id\s*=[^>]*>/i)?.[0]??'';
  for(const k of ['width','height','duration']){
    const v=root.match(new RegExp('\\bdata-'+k+'\\s*=\\s*["\']([^"\']+)["\']','i'));
    flag(v&&Number(v[1])===input[k],'Host '+k+' does not match input');
  }
  const a=html.indexOf(anchor),b=html.indexOf(close);
  flag(b===-1||(b>a&&html.split(close).length===2),'Malformed managed caption markers');
  const clean=b===-1?html:html.slice(0,a)+anchor+html.slice(b+close.length);
  const re=/<style id="ecs-caption-css">[\s\S]*?<\/style>/;
  return (re.test(clean)?clean.replace(re,()=>styleTag(result.css)):clean.replace('</head>',()=>styleTag(result.css)+'\n</head>')).replace(anchor,()=>anchor+'\n'+result.markup+'\n'+close);
}
const help='evocut caption-style list [--json] | palette [--json | --output picker.html] | apply --project DIR --input cues.json [--style highlight] [--highlight-color red|#RRGGBB] [--highlight-mode progressive|sentence]\nHighlight defaults to progressive, red (#C62828), white ink. Supply source-aligned glyphs for character timing. The host must contain <!-- evocut:captions -->.';
export function picker(){
 const buttons=Object.entries(palette).map(([name,hex])=>`<button type="button" data-color="${hex}" style="--swatch:${hex}">${name}</button>`).join('');
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EvoCut · Highlight color</title><style>body{max-width:40rem;margin:8vh auto;padding:1rem;background:#132220;color:#fff;font:17px/1.5 system-ui}button,input{font:inherit}button{margin:0 .25rem .45rem 0;background:#243631;color:white;border:1px solid #71877d;border-bottom:5px solid var(--swatch);padding:.25rem .6rem;border-radius:.3rem}button[aria-pressed=true]{outline:2px solid white}.demo{font-size:2rem}mark{padding:.08em .14em;border-radius:.14em}code{display:block;overflow-wrap:anywhere;background:#253530;padding:.75rem}</style><h1>Highlight color</h1><p class="demo">Read this <mark>word</mark></p><p>${buttons}</p><label>Custom color <input id="color" type="color" value="#C62828"></label><p>Apply to your project, then render to bake in the selected color:</p><code id="cmd"></code><script>const palette=${JSON.stringify(palette)},flag=(v,m)=>{if(!v)throw Error(m)},marker=${marker.toString().replace('function marker','function')};function pick(v){const {bg,fg}=marker(v),m=document.querySelector('mark');m.style.background=bg;m.style.color=fg;document.querySelector('#color').value=bg;document.querySelector('#cmd').textContent="evocut caption-style apply --project . --input cues.json --style highlight --highlight-color '"+bg+"'";for(const b of document.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.color===bg))}document.querySelector('#color').oninput=e=>pick(e.target.value);for(const b of document.querySelectorAll('button'))b.onclick=()=>pick(b.dataset.color);pick('red');</script></html>`;
}
export function main(argv){
  const [cmd,...rest]=argv;if(!cmd||['-h','--help','help'].includes(cmd)){console.log(help);return 0}
  const {values:o}=parseArgs({args:rest,options:{json:{type:'boolean'},project:{type:'string'},input:{type:'string'},style:{type:'string'},output:{type:'string'},'highlight-color':{type:'string'},'highlight-mode':{type:'string'}}});
  if(cmd==='palette'){if(o.output){fs.writeFileSync(o.output,picker(),{flag:'wx'});console.log('Created '+o.output)}else console.log(o.json?JSON.stringify({default:'red',colors:palette}):Object.entries(palette).map(v=>v.join('\t')).join('\n'));return 0;}
  if(cmd==='list'){console.log(o.json?JSON.stringify(styles,null,2):styles.map(v=>v.id+'\t'+v.label+'\t'+v.kind).join('\n'));return 0;}
  flag(cmd==='apply'&&o.project&&o.input,help);
  const input=JSON.parse(fs.readFileSync(o.input,'utf8')),file=path.join(o.project,'index.html'),before=fs.readFileSync(file,'utf8'),out=apply(before,compile(input,o.style,{highlightColor:o['highlight-color'],highlightMode:o['highlight-mode']}),input);
  if(before!==out){const tmp=file+'.ecs-'+process.pid;try{fs.writeFileSync(tmp,out,{flag:'wx',mode:fs.statSync(file).mode});fs.renameSync(tmp,file)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}}
  console.log('Caption rail ready: '+file);return 0;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main(process.argv.slice(2))}catch(e){console.error(e.message);process.exitCode=1}}
