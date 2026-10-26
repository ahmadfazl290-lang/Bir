const { test } = require('node:test');
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const corePath = path.join(root, 'core.js');
const coreBytes = fs.readFileSync(corePath);
const sandbox = {console};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'deck-actions.js'), 'utf8'), sandbox, {filename: 'deck-actions.js'});
vm.runInContext(coreBytes.toString('utf8'), sandbox, {filename: 'core.js'});
vm.runInContext(fs.readFileSync(path.join(root, 'deck-data.js'), 'utf8'), sandbox, {filename: 'deck-data.js'});
const C = sandbox.BIR_CORE;
const clone = x => JSON.parse(JSON.stringify(x));
const localNow = new Date(2026, 9, 24, 12, 0, 0).getTime();
const yesterday = new Date(2026, 9, 23, 12, 0, 0).getTime();
function same(actual, expected) { assert.deepEqual(clone(actual), expected); }
function smallBackup() {
  return {schema:1,decks:[{id:'a',name:'Deck A'},{id:'b',name:'Deck B'}],cards:[
    {id:'a1',deckId:'a',front:'Cell',back:'خانە'},
    {id:'a2',deckId:'a',front:'Heart',back:'دڵ',image:'heart.png'},
    {id:'b1',deckId:'b',front:'Lung',back:'سییەکان'}
  ],settings:{lang:'ckb',theme:'system',limit:20},reviews:{},history:[]};
}
function reject(name, change) {
  test(name, () => { const backup=smallBackup(); change(backup); assert.throws(()=>C.validateBackup(backup), undefined, 'Malformed backup was accepted'); });
}
const cards=[
  {id:'fresh-a',deckId:'a'}, {id:'future-a',deckId:'a'},
  {id:'overdue-newer-a',deckId:'a'}, {id:'overdue-oldest-a',deckId:'a'},
  {id:'due-now-b',deckId:'b'}, {id:'fresh-b1',deckId:'b'}, {id:'fresh-b2',deckId:'b'}
];
const reviews={
  'future-a':{due:localNow+1},
  'overdue-newer-a':{due:localNow-60000},
  'overdue-oldest-a':{due:localNow-C.DAY},
  'due-now-b':{due:localNow}
};
test('Queue prioritizes oldest overdue cards before new cards and excludes future cards',()=>same(C.queue(cards,reviews,[],20,localNow),['overdue-oldest-a','overdue-newer-a','due-now-b','fresh-a','fresh-b1','fresh-b2']));
test('Queue includes exactly due-now cards',()=>assert.ok(C.queue(cards,reviews,[],20,localNow).includes('due-now-b')));
test('Queue filters the selected deck without changing overdue order',()=>same(C.queue(cards,reviews,[],20,localNow,'a'),['overdue-oldest-a','overdue-newer-a','fresh-a']));
test('A zero remaining new-card budget still permits all due reviews',()=>same(C.queue(cards,reviews,[{cardId:'studied',wasNew:true,at:localNow}],1,localNow),['overdue-oldest-a','overdue-newer-a','due-now-b']));
test('Daily new budget is shared across decks',()=>same(C.queue(cards,reviews,[{cardId:'a-done',wasNew:true,at:localNow}],2,localNow,'b'),['due-now-b','fresh-b1']));
test('Repeated wasNew history for one card consumes one budget slot',()=>same(C.queue(cards,reviews,[{cardId:'same',wasNew:true,at:localNow-1000},{cardId:'same',wasNew:true,at:localNow}],2,localNow,'b'),['due-now-b','fresh-b1']));
test('Review-only history does not consume new-card budget',()=>same(C.queue(cards,reviews,[{cardId:'old',wasNew:false,at:localNow}],2,localNow,'b'),['due-now-b','fresh-b1','fresh-b2']));
test('Yesterday new cards do not consume today budget',()=>same(C.queue(cards,reviews,[{cardId:'yesterday',wasNew:true,at:yesterday}],2,localNow,'b'),['due-now-b','fresh-b1','fresh-b2']));
test('Exceeding daily limit never produces negative slice behavior',()=>same(C.queue(cards,reviews,[{cardId:'one',wasNew:true,at:localNow},{cardId:'two',wasNew:true,at:localNow}],1,localNow,'b'),['due-now-b']));
test('A reviewed future card is never counted as a new card',()=>assert.ok(!C.queue(cards,reviews,[],200,localNow).includes('future-a')));
test('Unknown selected deck yields no cards',()=>same(C.queue(cards,reviews,[],20,localNow,'missing'),[]));
test('dayKey separates adjacent local dates',()=>{assert.equal(C.dayKey(localNow),'2026-10-24');assert.equal(C.dayKey(yesterday),'2026-10-23');});

for(const [rating,interval] of [['again',60000],['hard',360000],['good',C.DAY],['easy',4*C.DAY]]){
  test(`New ${rating} rating schedules expected interval and increments repetitions`,()=>{
    const review=C.grade(null,rating,localNow);
    same(review,{due:localNow+interval,interval,reps:1,lapses:rating==='again'?1:0,last:localNow});
  });
}
test('Existing Good interval increases with prior interval',()=>assert.equal(C.grade({interval:10*C.DAY,reps:4,lapses:2},'good',localNow).interval,22*C.DAY));
test('Existing Easy interval increases with prior interval',()=>assert.equal(C.grade({interval:10*C.DAY,reps:4,lapses:2},'easy',localNow).interval,28*C.DAY));
test('Again increments existing lapse counter once',()=>{const next=C.grade({interval:C.DAY,reps:4,lapses:2},'again',localNow);assert.equal(next.reps,5);assert.equal(next.lapses,3);});
test('Hard preserves existing lapses',()=>assert.equal(C.grade({interval:C.DAY,reps:4,lapses:2},'hard',localNow).lapses,2));
test('Grading does not mutate previous review',()=>{const previous={interval:C.DAY,reps:4,lapses:2};C.grade(previous,'again',localNow);same(previous,{interval:C.DAY,reps:4,lapses:2});});
test('Unknown rating is rejected',()=>assert.throws(()=>C.grade(null,'perfect',localNow)));

test('The empty platform state passes backup validation and reloads without study cards',()=>{
  const seed=clone(sandbox.BIR_SEED);
  const value={schema:1,decks:seed.decks,cards:seed.cards,settings:{lang:'ckb',theme:'system',limit:20},reviews:{},history:[]};
  const restored=C.validateBackup(clone(value));
  same(restored.decks,[]);
  same(restored.cards,[]);
  same(restored.reviews,{});
  same(restored.history,[]);
  same(C.queue(restored.cards,restored.reviews,restored.history,20,localNow),[]);
});
test('Valid review and history pass validation',()=>{const value=smallBackup();value.reviews.a1=C.grade(null,'good',localNow);value.history.push({cardId:'a1',rating:'good',at:localNow,wasNew:true});assert.equal(C.validateBackup(value),value);});
for(const lang of ['ckb','en','ar']) test(`Supported ${lang} interface setting is accepted`,()=>{const value=smallBackup();value.settings.lang=lang;assert.equal(C.validateBackup(value),value);});
reject('Unknown card deck is rejected',b=>b.cards[0].deckId='missing');
reject('Duplicate card IDs are rejected',b=>b.cards[1].id=b.cards[0].id);
reject('Duplicate deck IDs are rejected',b=>b.decks[1].id=b.decks[0].id);
reject('Empty card front is rejected',b=>b.cards[0].front='  ');
reject('Empty back without answer text or images is rejected',b=>{b.cards[0].back='\n';b.cards[0].image='';delete b.cards[0].backImages;});
for(const image of ['../heart.png','folder/heart.png','folder\\heart.png','https://example.com/a.png','javascript:alert(1).png','heart.svg']) reject(`Unsafe image path rejected: ${image}`,b=>b.cards[0].image=image);
reject('Review references unknown card ID',b=>b.reviews.missing=C.grade(null,'good',localNow));
reject('Null review is rejected',b=>b.reviews.a1=null);
reject('Review missing required fields is rejected',b=>b.reviews.a1={due:localNow});
reject('Review nonnumeric due date is rejected',b=>b.reviews.a1={...C.grade(null,'good',localNow),due:'tomorrow'});
reject('Review infinite interval is rejected',b=>b.reviews.a1={...C.grade(null,'good',localNow),interval:Infinity});
reject('Negative review lapse counter is rejected',b=>b.reviews.a1={...C.grade(null,'good',localNow),lapses:-1});
reject('Review collection must be a map, not an array',b=>b.reviews=[]);
reject('Review collection must be a map, not a Boolean',b=>b.reviews=true);
reject('Review counters must be whole repetitions',b=>b.reviews.a1={...C.grade(null,'good',localNow),reps:1.5});
reject('History collection must be an array',b=>b.history={});
reject('History unknown card ID is rejected',b=>b.history.push({cardId:'missing',rating:'good',at:localNow,wasNew:true}));
reject('History invalid rating is rejected',b=>b.history.push({cardId:'a1',rating:'bad',at:localNow,wasNew:true}));
reject('History invalid timestamp is rejected',b=>b.history.push({cardId:'a1',rating:'good',at:'today',wasNew:true}));
reject('History missing wasNew flag is rejected',b=>b.history.push({cardId:'a1',rating:'good',at:localNow}));
reject('History negative timestamp is rejected',b=>b.history.push({cardId:'a1',rating:'good',at:-1,wasNew:true}));
reject('History timestamp outside JavaScript Date range is rejected',b=>b.history.push({cardId:'a1',rating:'good',at:Number.MAX_VALUE,wasNew:true}));
reject('Unsupported UI language is rejected',b=>b.settings.lang='zz');
reject('Fractional daily new limit is rejected',b=>b.settings.limit=1.5);
reject('Zero daily new limit is rejected',b=>b.settings.limit=0);
reject('Excessive daily new limit is rejected',b=>b.settings.limit=201);

