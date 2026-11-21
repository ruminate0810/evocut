import {test} from 'node:test';
import assert from 'node:assert/strict';
import {styles,compile,apply,marker,palette} from './caption-style.mjs';
const cue={start:0,end:2,words:[{at:0,text:'估值'},{at:1,text:'<PE>$&'}]};
const input={width:1080,height:1440,duration:2,cues:[cue]};
const html='<html><head></head><body><div data-composition-id="main" data-width="1080" data-height="1440" data-duration="2"><!-- evocut:captions --><b>Original</b></div></body></html>';
test('all seven presets and collection compile deterministically and escape text',()=>{
  assert.equal(styles.length,8);assert.equal(styles.filter(x=>x.kind==='collection').length,1);
  for(const {id} of styles){const r=compile(input,id);assert.equal(r.markup,compile(input,id).markup);assert.ok(r.markup.includes('&lt;PE&gt;$&amp;'));assert.ok(!r.markup.includes('<PE>'));}
});
test('apply replaces its own markup idempotently without changing unrelated content',()=>{
  const r=compile(input);const a=apply(html,r,input);assert.equal(a,apply(a,r,input));assert.ok(a.includes('<b>Original</b>'));assert.ok(a.includes('$&amp;'));assert.ok(!apply(a,compile(input,'glow'),input).includes('class="clip ecs-rail ecs-highlight"'));assert.throws(()=>apply(html,r,{...input,width:1920}));assert.throws(()=>apply('<html/>',r,input));
});
test('trending cycles by trending cue; invalid timing and unknown styles fail',()=>{
  const cues=[0,2,4].map(k=>({start:k,end:k+2,words:[{text:'A',at:k}]}));
  const {markup}=compile({...input,duration:6,cues},'trending');for(const s of ['highlight','frame','word'])assert.ok(markup.includes('ecs-rail ecs-'+s));
  assert.throws(()=>compile({...input,cues:[cue,cue]}));assert.throws(()=>compile(input,'invalid'));assert.throws(()=>compile({...input,cues:[{...cue,words:[{at:-1,text:'A'}]}]}));
});
test('progressive highlight uses actual character times, preserves numeric/Latin units and optionally holds',()=>{
  const c={start:0,end:2,words:[{at:0,text:'看好50PE'}],glyphs:[{at:0,text:'看'},{at:.20,text:'好'},{at:.48,text:'50'},{at:.79,end:1.2,text:'PE'}]};
  const data={...input,cues:[c]},rows=compile(data).markup.split('\n');
  assert.equal(rows.length,5);assert.match(rows[0],/--ecs-bg:#C62828;--ecs-fg:#FFFFFF/);
  assert.match(rows[0],/ecs-on">看</);assert.match(rows[0],/ecs-future" aria-hidden="true">好</);
  assert.match(rows[2],/data-start="0.48"/);assert.match(rows[2],/ecs-on">50</);assert.match(rows[4],/data-start="1.2"/);assert.doesNotMatch(rows[4],/ecs-on/);
  assert.doesNotMatch(compile(input,'highlight',{highlightMode:'sentence'}).markup,/ecs-future/);
  assert.equal(compile(input).markup.split('\n').length,2,'do not manufacture character times');
  assert.throws(()=>compile({...data,cues:[{...c,glyphs:[{at:0,text:'bad'}]}]}),/match cue text/);
  assert.throws(()=>compile({...data,cues:[{...c,glyphs:c.glyphs.map((v,i)=>i===0?{...v,end:1}:v)}]}),/glyph end/);
});
test('CLI option wins over cue-sheet palette, invalid CSS rejected, other rails untouched',()=>{
  assert.equal(Object.keys(palette).length,7);assert.deepEqual(marker('red'),{bg:'#C62828',fg:'#FFFFFF'});
  assert.equal(marker('#72b8ff').fg,'#162326');
  assert.match(compile({...input,highlightColor:'gold'},'highlight',{highlightColor:'navy'}).markup,/--ecs-bg:#253D77;--ecs-fg:#FFFFFF/);
  assert.throws(()=>marker('red;display:none'));assert.throws(()=>compile(input,'highlight',{highlightMode:'bad'}));
  for(const style of ['word','trending','multiline','frame','glow','monoline','aesthetic'])assert.equal(compile(input,style).markup,compile({...input,highlightColor:'blue'},style).markup);
});
