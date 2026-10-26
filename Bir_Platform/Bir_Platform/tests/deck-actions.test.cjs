const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
for (const file of ['deck-actions.js', 'core.js']) vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), sandbox);
const actions = sandbox.window.BIR_DECK_ACTIONS;
const clone = value => JSON.parse(JSON.stringify(value));
const remove = (...args) => clone(actions.remove(...args));
const restore = (...args) => clone(actions.restore(...args));
const validate = state => sandbox.window.BIR_CORE.validateBackup(state);
function throwsCode(fn, code) { assert.throws(fn, error => error.code === code); }
function fixture() {
  const cards = [
    { id: 'a1', deckId: 'a', front: 'Heart', back: 'دڵ', definition: 'A muscular organ.', image: 'heart.png' },
    { id: 'b1', deckId: 'b', front: 'Cell', back: 'خانە', frontImages: ['cell.png'] },
    { id: 'a2', deckId: 'a', front: 'Lung', back: 'سی', backImages: ['lung.webp'] },
    { id: 'c1', deckId: 'c', front: 'Brain', back: 'مێشک' }
  ];
  return {
    schema: 1, decks: [{ id: 'a', name: 'Terminology' }, { id: 'b', name: 'بایۆلۆجی / الأحياء' }, { id: 'c', name: 'Other' }, { id: 'empty', name: 'Empty' }], cards,
    reviews: { a1: { due: 1000000, interval: 100000, reps: 7, lapses: 2, last: 900000 }, b1: { due: 2000000, interval: 100000, reps: 3, lapses: 0, last: 1900000 }, a2: { due: 3000000, interval: 100000, reps: 2, lapses: 0, last: 2900000 } },
    history: [
      { cardId: 'a1', at: 1000, rating: 'good', wasNew: true },
      { cardId: 'b1', at: 2000, rating: 'easy', wasNew: true },
      { cardId: 'a2', at: 3000, rating: 'good', wasNew: true },
      { cardId: 'a1', at: 4000, rating: 'hard', wasNew: false },
      { cardId: 'c1', at: 5000, rating: 'again', wasNew: true }
    ], settings: { lang: 'ckb', theme: 'system', limit: 20, speechLang: 'en', speechVoice: 'voice-id' }
  };
}
function activePart(state) { const copy = clone(state); delete copy.deletedDecks; delete copy.deckDeletionSequence; return copy; }
function idFor(state, deckId) { return state.deletedDecks.find(record => record.deck.id === deckId).id; }

test('standalone module operates without a core runtime dependency', () => {
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../deck-actions.js'), 'utf8'), box);
  const next = box.window.BIR_DECK_ACTIONS.remove(fixture(), 'a', 1000);
  assert.equal(next.cards.length, 2);
});
test('remove only selected deck, cards, reviews and its complete history', () => {
  const previous = fixture();
  const next = remove(previous, 'a', 1000);
  assert.deepEqual(next.decks.map(deck => deck.id), ['b', 'c', 'empty']);
  assert.deepEqual(next.cards.map(card => card.id), ['b1', 'c1']);
  assert.deepEqual(Object.keys(next.reviews), ['b1']);
  assert.deepEqual(next.history.map(event => event.cardId), ['b1', 'c1']);
  const record = next.deletedDecks[0];
  assert.equal(record.deletedAt, 1000);
  assert.deepEqual(record.deck, previous.decks[0]);
  assert.deepEqual(record.cards, [previous.cards[0], previous.cards[2]]);
  assert.deepEqual(record.reviews, { a1: previous.reviews.a1, a2: previous.reviews.a2 });
  assert.deepEqual(record.history, [previous.history[0], previous.history[2], previous.history[3]]);
  assert.deepEqual(next.settings, previous.settings);
  validate(next);
});
test('restore exact IDs, card content, due dates, history and interleaved ordering', () => {
  const previous = fixture();
  const deleted = remove(previous, 'a', 1000);
  const next = restore(deleted, idFor(deleted, 'a'));
  assert.deepEqual(activePart(next), previous);
  assert.deepEqual(next.deletedDecks, []);
  validate(next);
});
test('empty deck can be removed and restored', () => {
  const previous = fixture();
  const deleted = remove(previous, 'empty', 1000);
  assert.equal(deleted.deletedDecks[0].cards.length, 0);
  assert.deepEqual(restore(deleted, idFor(deleted, 'empty')).decks, previous.decks);
});
test('final deck including seed-like cards can be removed and restored', () => {
  const previous = fixture();
  previous.decks = [previous.decks[0]];
  previous.cards = previous.cards.filter(card => card.deckId === 'a');
  delete previous.reviews.b1;
  previous.history = previous.history.filter(event => event.cardId.startsWith('a'));
  const deleted = remove(previous, 'a', 1000);
  assert.deepEqual(deleted.decks, []); assert.deepEqual(deleted.cards, []); assert.deepEqual(deleted.reviews, {}); assert.deepEqual(deleted.history, []);
  validate(deleted);
  assert.deepEqual(activePart(restore(deleted, idFor(deleted, 'a'))), previous);
});
test('multiple deletions survive JSON reload and restore in deletion order', () => {
  const previous = fixture();
  let state = remove(previous, 'a', 1000); state = remove(state, 'b', 1000);
  state = clone(state); validate(state);
  assert.equal(state.deletedDecks.length, 2);
  assert.notEqual(idFor(state, 'a'), idFor(state, 'b'));
  state = restore(state, idFor(state, 'a')); state = restore(state, idFor(state, 'b'));
  assert.deepEqual(activePart(state), previous);
});
test('multiple deletions restore in reverse order with exact original ordering', () => {
  const previous = fixture();
  let state = remove(previous, 'a', 1000); state = remove(state, 'b', 1000); state = remove(state, 'c', 1000);
  state = restore(state, idFor(state, 'c')); state = restore(state, idFor(state, 'b')); state = restore(state, idFor(state, 'a'));
  assert.deepEqual(activePart(state), previous);
});
test('restoring one deck leaves other deleted decks recoverable', () => {
  let state = remove(fixture(), 'a', 1000); state = remove(state, 'b', 1000);
  const savedB = clone(state.deletedDecks.find(record => record.deck.id === 'b'));
  state = restore(state, idFor(state, 'a'));
  assert.deepEqual(state.deletedDecks, [savedB]);
  validate(state);
});
test('deletion IDs remain distinct after restore and deletion at identical timestamps', () => {
  let state = remove(fixture(), 'a', 1000); const firstId = idFor(state, 'a');
  state = restore(state, firstId); state = clone(state); state = remove(state, 'a', 1000);
  assert.notEqual(idFor(state, 'a'), firstId);
  assert.equal(state.deckDeletionSequence, 2);
});
test('remove and restore never mutate source objects or nested metadata', () => {
  const original = fixture(), snapshot = clone(original);
  const deleted = remove(original, 'a', 1000); assert.deepEqual(original, snapshot);
  const trashSnapshot = clone(deleted), restored = restore(deleted, idFor(deleted, 'a')); assert.deepEqual(deleted, trashSnapshot);
  restored.cards[0].front = 'Edited'; restored.reviews.a1.due = 4; restored.history[0].rating = 'again';
  assert.deepEqual(original, snapshot); assert.deepEqual(deleted, trashSnapshot);
});
test('active deck ID collision fails safely without overwrite', () => {
  const state = remove(fixture(), 'a', 1000);
  state.decks.push({ id: 'a', name: 'Replacement' }); const snapshot = clone(state);
  throwsCode(() => restore(state, idFor(state, 'a')), 'RESTORE_CONFLICT');
  assert.deepEqual(state, snapshot);
});
test('active card ID collision fails safely without overwrite', () => {
  const state = remove(fixture(), 'a', 1000);
  state.cards.push({ id: 'a1', deckId: 'b', front: 'Replacement', back: 'Replacement' }); const snapshot = clone(state);
  throwsCode(() => restore(state, idFor(state, 'a')), 'RESTORE_CONFLICT'); assert.deepEqual(state, snapshot);
});
test('unknown active or deleted deck IDs fail safely', () => {
  const state = fixture(), snapshot = clone(state);
  throwsCode(() => remove(state, 'missing', 1000), 'DECK_NOT_FOUND');
  throwsCode(() => restore(state, 'missing'), 'DELETED_DECK_NOT_FOUND');
  assert.deepEqual(state, snapshot);
});
test('invalid timestamps and deletion sequences rejected', () => {
  for (const now of [-1, Infinity, NaN, 8640000000000001]) throwsCode(() => remove(fixture(), 'a', now), 'INVALID_TIMESTAMP');
  const state = fixture(); state.deckDeletionSequence = -1;
  throwsCode(() => remove(state, 'a', 1000), 'INVALID_STATE');
});
test('optional trash preserves compatibility with old backup files', () => {
  const state = fixture(); validate(state);
  assert.equal(actions.validateTrash(state, validate), state);
});
test('trash validation invokes active validator on isolated nonrecursive collections', () => {
  const state = remove(fixture(), 'a', 1000); let calls = 0;
  actions.validateTrash(state, value => {
    calls += 1; assert.equal(value.deletedDecks, undefined); assert.equal(value.decks.length, 1); validate(value);
  });
  assert.equal(calls, 1);
});
test('invalid trash container, record IDs, timestamps and deck payloads rejected', () => {
  for (const mutate of [
    state => { state.deletedDecks = {}; },
    state => { state.deletedDecks[0].id = '__proto__'; },
    state => { state.deletedDecks[0].deletedAt = -1; },
    state => { state.deletedDecks[0].deck.name = ''; },
    state => { state.deletedDecks[0].cards[0].deckId = 'another-deck'; },
    state => { state.deletedDecks[0].cards[0].frontImages = ['../secret.png']; },
    state => { state.deletedDecks[0].reviews.unknown = state.deletedDecks[0].reviews.a1; },
    state => { state.deletedDecks[0].history[0].cardId = 'unknown'; }
  ]) {
    const state = remove(fixture(), 'a', 1000); mutate(state);
    throwsCode(() => actions.validateTrash(state, validate), 'INVALID_DELETED_DECKS');
  }
});
test('duplicate trash deck/card/record IDs rejected', () => {
  for (const mutate of [
    state => state.deletedDecks.push(clone(state.deletedDecks[0])),
    state => { state.deletedDecks[1].deck.id = state.deletedDecks[0].deck.id; },
    state => { state.deletedDecks[1].cards[0].id = state.deletedDecks[0].cards[0].id; }
  ]) {
    const state = remove(remove(fixture(), 'a', 1000), 'b', 1000); mutate(state);
    throwsCode(() => actions.validateTrash(state, validate), 'INVALID_DELETED_DECKS');
  }
});
test('malformed and duplicate ordering positions rejected', () => {
  for (const mutate of [
    state => { state.deletedDecks[0].deckIndex = -1; },
    state => { state.deletedDecks[0].cardPositions = []; },
    state => { state.deletedDecks[0].cardPositions[0] = 0.5; },
    state => { state.deletedDecks[0].historyPositions[0] = state.deletedDecks[0].historyPositions[1]; },
    state => { state.deletedDecks[1].deckIndex = state.deletedDecks[0].deckIndex; }
  ]) {
    const state = remove(remove(fixture(), 'a', 1000), 'b', 1000); mutate(state);
    throwsCode(() => actions.validateTrash(state, validate), 'INVALID_DELETED_DECKS');
  }
});
test('legacy recovery records without optional ordering metadata restore safely', () => {
  const state = remove(fixture(), 'a', 1000);
  for (const key of ['deckIndex', 'cardPositions', 'historyPositions']) delete state.deletedDecks[0][key];
  validate(state);
  const next = restore(state, idFor(state, 'a'));
  assert.equal(next.cards.length, 4); assert.equal(next.decks.length, 4); validate(next);
});
test('restoring respects active deck limit without changing source', () => {
  const state = remove(fixture(), 'a', 1000);
  while (state.decks.length < 10000) state.decks.push({ id: 'extra-' + state.decks.length, name: 'Extra' });
  const snapshot = clone(state);
  throwsCode(() => restore(state, idFor(state, 'a')), 'RESTORE_LIMIT'); assert.deepEqual(state, snapshot);
});
test('restoring respects active card limit without changing source', () => {
  const state = remove(fixture(), 'a', 1000);
  while (state.cards.length < 100000) state.cards.push({ id: 'extra-' + state.cards.length, deckId: 'b', front: 'Front', back: 'Back' });
  const snapshot = clone(state);
  throwsCode(() => restore(state, idFor(state, 'a')), 'RESTORE_LIMIT'); assert.deepEqual(state, snapshot);
});
test('trash record and total card limits are enforced', () => {
  const invalid = fixture(); invalid.deletedDecks = Array(10001).fill({});
  throwsCode(() => actions.validateTrash(invalid, validate), 'INVALID_DELETED_DECKS');
  const state = remove(fixture(), 'a', 1000), record = state.deletedDecks[0];
  record.cards = Array.from({ length: 100001 }, (_, index) => ({ id: 'trash-' + index, deckId: 'a', front: 'F', back: 'B' }));
  delete record.cardPositions;
  throwsCode(() => actions.validateTrash(state, validate), 'INVALID_DELETED_DECKS');
});
test('trash total history limit is enforced before processing oversized events', () => {
  const state = remove(fixture(), 'a', 1000);
  state.deletedDecks[0].history = Array(1000001).fill({ cardId: 'a1', at: 1000, rating: 'good', wasNew: false });
  delete state.deletedDecks[0].historyPositions;
  throwsCode(() => actions.validateTrash(state, validate), 'INVALID_DELETED_DECKS');
});

