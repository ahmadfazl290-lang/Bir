const { test } = require('node:test');
'use strict';
const assert = require('node:assert/strict');
const api = require('../speech.js');
function voice(voiceURI, lang, localService=true, name=voiceURI) { return {voiceURI,lang,localService,name,default:false}; }
class Utterance { constructor(text) { this.text = text; } }
class Synthesis {
  constructor(voices=[]) { this.voices = voices; this.spoken = []; this.cancelCount = 0; this.listeners = new Set(); this.current = null; }
  getVoices() { return this.voices; }
  addEventListener(name, callback) { if (name === 'voiceschanged') this.listeners.add(callback); }
  removeEventListener(name, callback) { this.listeners.delete(callback); }
  changed(voices) { this.voices = voices; for (const callback of this.listeners) callback({type:'voiceschanged'}); if (this.onvoiceschanged) this.onvoiceschanged({type:'voiceschanged'}); }
  speak(utterance) { if (this.throwOnSpeak) throw Error('device failed'); this.spoken.push(utterance); this.current = utterance; if (utterance.onstart) utterance.onstart({}); }
  cancel() { this.cancelCount++; const previous = this.current; this.current = null; if (this.emitCancel && previous && previous.onerror) previous.onerror({error:'canceled'}); }
  end(utterance=this.current) { if (this.current === utterance) this.current = null; if (utterance && utterance.onend) utterance.onend({}); }
}
function setup(voices=[voice('en-local','en-US')], options={}) {
  const synthesis = new Synthesis(voices), states = [];
  const controller = api.create({synthesis, Utterance, onState:state => states.push(state), ...options});
  return {synthesis, controller, states};
}

test('detects English, Sorani and Arabic using content', () => {
  assert.equal(api.detectLanguage('coronary artery'), 'en');
  assert.equal(api.detectLanguage('دڵ و خوێن'), 'ckb');
  assert.equal(api.detectLanguage('القلب والأوعية الدموية'), 'ar');
  assert.equal(api.detectLanguage('دم', {fallbackLang:'ckb'}), 'ckb');
  assert.equal(api.detectLanguage('123', {fallbackLang:'en'}), 'en');
  assert.equal(api.detectLanguage('日本語'), null);
});
test('segments mixed Sorani and English without changing word order', () => {
  assert.deepEqual(api.segments('heart دڵ pumps خوێن'), [{text:'heart',lang:'en'},{text:'دڵ',lang:'ckb'},{text:'pumps',lang:'en'},{text:'خوێن',lang:'ckb'}]);
  assert.deepEqual(api.segments(' \n '), []);
});
test('reports unsupported browsers without touching speech', () => {
  const controller = api.create({synthesis:null, Utterance:null});
  assert.equal(controller.getState().status, 'unsupported');
  assert.equal(controller.speak([{text:'hello',lang:'en'}]).status, 'unsupported');
});
test('empty content never starts an utterance', () => {
  const {controller,synthesis} = setup();
  assert.equal(controller.speak([{text:' \n',lang:'en'}]).status,'empty');
  assert.equal(synthesis.spoken.length,0);
});
test('initially empty voices are no-voice rather than unsupported', () => {
  const {controller} = setup([]);
  assert.equal(controller.getState().supported,true);
  assert.deepEqual(controller.analyze([{text:'hello',lang:'en'}]).missingLanguages,['en']);
  assert.equal(controller.speak([{text:'hello',lang:'en'}]).status,'no-voice');
});
test('voiceschanged updates availability and enables a manual retry', () => {
  const {controller,synthesis,states} = setup([]);
  controller.speak([{text:'hello',lang:'en'}]);
  synthesis.changed([voice('english','EN_us')]);
  assert.equal(states.at(-1).reason,'voiceschanged');
  assert.deepEqual(controller.getState().availableLanguages,['en']);
  assert.equal(controller.speak([{text:'hello',lang:'en'}]).ok,true);
  assert.equal(synthesis.spoken[0].lang,'EN-us');
});
test('prefers a local matching voice over a remote default', () => {
  const remote = {...voice('remote','en-US',false),default:true};
  const {controller,synthesis} = setup([remote,voice('local','en-GB')]);
  controller.speak([{text:'hello',lang:'en'}]);
  assert.equal(synthesis.spoken[0].voice.voiceURI,'local');
});
test('explicit compatible voice selection is respected', () => {
  const {controller,synthesis} = setup([voice('local','en-US'),voice('selected','en-GB',false)]);
  controller.speak([{text:'hello',lang:'en'}],{voiceURI:'selected'});
  assert.equal(synthesis.spoken[0].voice.voiceURI,'selected');
});
test('missing or incompatible selected voice never falls back silently', () => {
  const {controller,synthesis} = setup([voice('english','en-US'),voice('arabic','ar-IQ')]);
  assert.equal(controller.speak([{text:'مرحبا',lang:'ar'}],{voiceURI:'english'}).status,'no-voice');
  assert.equal(controller.speak([{text:'hello',lang:'en'}],{voiceURI:'deleted-voice'}).status,'no-voice');
  assert.equal(synthesis.spoken.length,0);
});
test('Sorani is never sent to an English or Arabic voice', () => {
  const {controller,synthesis} = setup([voice('english','en-US'),voice('arabic','ar-IQ')]);
  const result = controller.speak([{text:'heart',lang:'en'},{text:'دڵ',lang:'ckb'}]);
  assert.equal(result.status,'no-voice');
  assert.deepEqual(result.missingLanguages,['ckb']);
  assert.equal(synthesis.spoken.length,0);
});
test('generic Kurdish and Kurmanji voices are not assumed Sorani', () => {
  const {controller} = setup([voice('generic','ku'),voice('kurmanji','ku-Latn','true','Kurmanji')]);
  assert.deepEqual(controller.getVoices('ckb'),[]);
  assert.equal(controller.analyze([{text:'دڵ',lang:'ckb'}]).status,'no-voice');
});
test('explicit Sorani, Arabic-script Kurdish and Sorani-named ku voices match', () => {
  for (const candidate of [voice('sorani','CKB-IQ'),voice('arabic-script','KU_Arab_IQ'),voice('named','ku-IQ',true,'Central Kurdish Sorani')]) {
    const {controller,synthesis} = setup([candidate]);
    assert.equal(controller.speak([{text:'دڵ',lang:'ckb'}]).ok,true);
    assert.equal(synthesis.spoken[0].voice,candidate);
  }
});
test('explicit language override applies only as a stated user choice', () => {
  const {controller,synthesis} = setup([voice('arabic','ar-IQ')]);
  const result = controller.speak([{text:'دڵ',lang:'ckb'}],{lang:'ar'});
  assert.equal(result.overridden,true);
  assert.equal(synthesis.spoken[0].lang,'ar-IQ');
});
test('unknown scripts are not accidentally routed to any available voice', () => {
  const {controller,synthesis} = setup([voice('japanese','ja-JP')]);
  const result = controller.speak('日本語');
  assert.equal(result.status,'no-voice');
  assert.deepEqual(result.missingLanguages,['unknown']);
  assert.equal(synthesis.spoken.length,0);
});
test('analyze is pure with respect to active speech and cancellation', () => {
  const {controller,synthesis} = setup();
  controller.speak([{text:'hello',lang:'en'}]);
  const cancellations = synthesis.cancelCount;
  assert.equal(controller.analyze([{text:'another',lang:'en'}]).status,'ready');
  assert.equal(synthesis.cancelCount,cancellations);
  assert.equal(controller.getState().status,'speaking');
});
test('sequences matching languages and calls onEnd exactly once', () => {
  const {controller,synthesis,states} = setup([voice('en','en-US'),voice('ckb','ckb-IQ')]);
  let ended = 0;
  controller.speak([{text:'heart',lang:'en'},{text:'دڵ',lang:'ckb'}],{onEnd:() => ended++});
  assert.equal(synthesis.spoken.length,1);
  const first = synthesis.current;
  synthesis.end();
  assert.equal(synthesis.spoken.length,2);
  assert.equal(synthesis.current.lang,'ckb-IQ');
  synthesis.end();
  assert.equal(controller.getState().status,'ended');
  assert.equal(ended,1);
  first.onend({});
  assert.equal(ended,1);
  assert(states.some(state => state.status === 'queued'));
});
test('stop invalidates delayed start, end and cancellation-error callbacks', () => {
  const {controller,synthesis} = setup();
  synthesis.emitCancel = true;
  let ended=0, errors=0;
  controller.speak([{text:'first',lang:'en'},{text:'next',lang:'en'}],{onEnd:()=>ended++,onError:()=>errors++});
  const previous = synthesis.current;
  controller.stop();
  previous.onstart({}); previous.onend({}); previous.onerror({error:'canceled'});
  assert.equal(controller.getState().status,'stopped');
  assert.equal(synthesis.spoken.length,1);
  assert.equal(ended+errors,0);
});
test('new speech cannot be advanced or stopped by stale callbacks', () => {
  const {controller,synthesis} = setup();
  controller.speak([{text:'old',lang:'en'}]);
  const old = synthesis.current;
  controller.speak([{text:'new',lang:'en'}]);
  old.onend({}); old.onerror({error:'interrupted'});
  assert.equal(controller.getState().status,'speaking');
  assert.equal(synthesis.current.text,'new');
  assert.equal(synthesis.spoken.length,2);
});
test('runtime errors cancel remaining chunks and call only onError', () => {
  const {controller,synthesis} = setup();
  let errors=0, ended=0;
  controller.speak([{text:'first',lang:'en'},{text:'next',lang:'en'}],{onError:error => { errors++; assert.equal(error.error,'audio-busy'); },onEnd:()=>ended++});
  const old = synthesis.current;
  old.onerror({error:'audio-busy'}); old.onend({});
  assert.equal(controller.getState().status,'error');
  assert.equal(errors,1); assert.equal(ended,0); assert.equal(synthesis.spoken.length,1);
});
test('a synchronous synthesis failure returns an error', () => {
  const {controller,synthesis} = setup();
  synthesis.throwOnSpeak=true;
  const result = controller.speak([{text:'first',lang:'en'}]);
  assert.equal(result.ok,false); assert.equal(result.status,'error');
});
test('long text is chunked without omitting words', () => {
  const {controller} = setup();
  const text = Array.from({length:150},(_,i)=>'word'+i).join(' ');
  const result = controller.analyze([{text,lang:'en'}]);
  assert(result.chunks.length > 1);
  assert(result.chunks.every(chunk => chunk.text.length <= 240));
  assert.equal(result.chunks.map(chunk => chunk.text).join(' '),text);
});
test('consumer callback failures cannot break lifecycle', () => {
  const {controller,synthesis} = setup(undefined,{onState:()=>{throw Error('UI callback');}});
  controller.speak([{text:'hello',lang:'en'}],{onEnd:()=>{throw Error('UI callback');}});
  synthesis.end();
  assert.equal(controller.getState().status,'ended');
});
test('destroy unsubscribes and stale methods do not cancel a later controller', () => {
  const {controller,synthesis} = setup();
  controller.speak([{text:'old',lang:'en'}]);
  const old = synthesis.current;
  controller.destroy();
  const cancellations = synthesis.cancelCount;
  assert.equal(synthesis.listeners.size,0);
  assert.equal(controller.speak([{text:'again',lang:'en'}]).status,'destroyed');
  controller.stop(); old.onend({});
  assert.equal(synthesis.cancelCount,cancellations);
  assert.equal(controller.getState().status,'destroyed');
});
test('property-event fallback preserves and restores an existing listener', () => {
  const synthesis = new Synthesis();
  synthesis.addEventListener = undefined; synthesis.removeEventListener = undefined;
  let calls=0; const previous=()=>calls++;
  synthesis.onvoiceschanged=previous;
  const controller=api.create({synthesis,Utterance});
  synthesis.changed([voice('en','en-US')]);
  assert.equal(calls,1);
  assert.deepEqual(controller.getState().availableLanguages,['en']);
  controller.destroy();
  assert.equal(synthesis.onvoiceschanged,previous);
});
test('voice descriptors are snapshots rather than mutable state references', () => {
  const {controller} = setup();
  const list = controller.getVoices();
  list[0].name='changed';
  assert.notEqual(controller.getVoices()[0].name,'changed');
  const state=controller.getState(); state.missingLanguages.push('fake');
  assert.deepEqual(controller.getState().missingLanguages,[]);
});

