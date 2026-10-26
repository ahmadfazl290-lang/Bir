const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const sandbox = { window: {}, crypto: webcrypto };
for (const filename of ['deck-actions.js', 'import-cards.js', 'core.js']) {
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '..', filename), 'utf8'), sandbox);
}
const merge = (state, rows, options) => JSON.parse(JSON.stringify(sandbox.window.BIR_IMPORT_CARDS.merge(state, rows, options)));
const validate = state => sandbox.window.BIR_CORE.validateBackup(state);
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  return {
    schema: 1,
    decks: [{ id: 'terminology', name: 'Terminology' }, { id: 'biology', name: 'Biology' }],
    cards: [
      { id: 'Seed#Guid1', deckId: 'terminology', front: 'Heart', back: 'دڵ', definition: 'A muscular organ.', image: 'heart.png', imageCaption: 'Heart diagram', frontImages: ['front.png'], backImages: ['back.png'], tags: ['anatomy'] },
      { id: 'Seed#Guid2', deckId: 'biology', front: 'Heart', back: 'قلب', definition: 'Another deck', image: '', imageCaption: '' }
    ],
    settings: { lang: 'ckb', theme: 'system', limit: 20 },
    reviews: { 'Seed#Guid1': { due: 123456789, interval: 86400000, reps: 4, lapses: 1, last: 37056789 } },
    history: [{ cardId: 'Seed#Guid1', at: 37056789, rating: 'good', wasNew: false }]
  };
}
const options = { deckId: 'terminology', mode: 'update', keepDecks: false, newDeckName: 'Imported' };

test('baseline backup validates', () => validate(fixture()));
test('CSV same front is case-insensitive within the selected deck', () => {
  const state = fixture();
  const result = merge(state, [{ front: '  HEART  ', back: 'دڵی نوێ' }], options);
  assert.equal(result.state.cards.length, 2);
  assert.equal(result.state.cards[0].id, 'Seed#Guid1');
  assert.equal(result.state.cards[0].back, 'دڵی نوێ');
  assert.equal(result.state.cards[1].back, 'قلب');
  assert.deepEqual(result.state.reviews, state.reviews);
  assert.deepEqual(result.state.history, state.history);
  assert.equal(result.counts.updated, 1);
  validate(result.state);
});
test('optional absent definition and media preserve existing content', () => {
  const result = merge(fixture(), [{ front: 'Heart', back: 'نوێ' }], options);
  const card = result.state.cards[0];
  assert.equal(card.definition, 'A muscular organ.');
  assert.equal(card.image, 'heart.png');
  assert.equal(card.imageCaption, 'Heart diagram');
  assert.deepEqual(card.frontImages, ['front.png']);
  assert.deepEqual(card.backImages, ['back.png']);
  assert.deepEqual(card.tags, ['anatomy']);
});
test('explicit empty definition and media may clear existing content', () => {
  const result = merge(fixture(), [{ front: 'Heart', back: 'نوێ', definition: '', mediaSupplied: true, image: '', frontImages: [], backImages: [] }], options);
  const card = result.state.cards[0];
  assert.equal(card.definition, '');
  assert.equal(card.image, '');
  assert.deepEqual(card.frontImages, []);
  assert.deepEqual(card.backImages, []);
  validate(result.state);
});
test('Anki GUID and template ordinal match seed even if front changed', () => {
  const state = fixture();
  const result = merge(state, [{ front: 'Cardiac organ', back: 'دڵ', sourceKey: 'anki:Seed#Guid1:0', guid: 'Seed#Guid1', templateOrd: 0 }], options);
  assert.equal(result.state.cards.length, 2);
  assert.equal(result.state.cards[0].id, 'Seed#Guid1');
  assert.equal(result.state.cards[0].front, 'Cardiac organ');
  assert.equal(result.state.cards[0].sourceGuid, 'Seed#Guid1');
  assert.equal(result.state.cards[0].templateOrd, 0);
  assert.deepEqual(result.state.reviews, state.reviews);
  assert.deepEqual(result.state.history, state.history);
});
test('Anki second template ordinal is a separate card', () => {
  const result = merge(fixture(), [{ front: 'Heart', back: 'دڵ', sourceKey: 'anki:Seed#Guid1:1', guid: 'Seed#Guid1', templateOrd: 1 }], options);
  assert.equal(result.state.cards.length, 3);
  assert.equal(result.counts.added, 1);
  assert.equal(result.state.cards[2].templateOrd, 1);
  assert.notEqual(result.state.cards[2].id, 'Seed#Guid1');
  validate(result.state);
});
test('same CSV imported twice creates no duplicate cards or decks', () => {
  const rows = [{ front: 'Cell', back: 'خانە' }, { front: 'Brain', back: 'مێشک' }];
  const selected = { ...options, deckId: '', newDeckName: 'My CSV' };
  const first = merge(fixture(), rows, selected);
  const second = merge(first.state, rows, selected);
  assert.equal(second.state.cards.length, 4);
  assert.equal(second.state.decks.length, 3);
  assert.equal(second.counts.added, 0);
  assert.equal(second.counts.skipped, 2);
  assert.deepEqual(second.state, first.state);
});
test('same APKG imported twice creates no duplicate cards or decks', () => {
  const rows = [{ front: 'Cell', back: 'خانە', deckName: 'Medical::Lecture 1', sourceKey: 'anki:NewGuid:0', guid: 'NewGuid', templateOrd: 0 }];
  const selected = { ...options, keepDecks: true };
  const first = merge(fixture(), rows, selected);
  const second = merge(first.state, rows, selected);
  assert.equal(second.state.cards.length, 3);
  assert.equal(second.state.decks.length, 3);
  assert.equal(second.counts.added, 0);
  assert.equal(second.counts.skipped, 1);
  assert.deepEqual(second.state, first.state);
});
test('duplicate rows inside one CSV are merged', () => {
  const result = merge(fixture(), [{ front: 'Cell', back: 'خانە' }, { front: 'CELL', back: 'خلية' }], options);
  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.updated, 1);
  assert.equal(result.state.cards.length, 3);
});
test('skip mode preserves matching content and learning history', () => {
  const state = fixture();
  const result = merge(state, [{ front: 'HEART', back: 'Changed', definition: 'Changed', mediaSupplied: true, image: 'new.png' }], { ...options, mode: 'skip' });
  assert.deepEqual(result.state, state);
  assert.equal(result.counts.skipped, 1);
});
test('GUID skip mode preserves existing seed even if front differs', () => {
  const state = fixture();
  const result = merge(state, [{ front: 'Changed', back: 'Changed', sourceKey: 'anki:Seed#Guid1:0' }], { ...options, mode: 'skip' });
  assert.deepEqual(result.state, state);
  assert.equal(result.counts.skipped, 1);
});
test('new deck labels retain Sorani and Arabic', () => {
  const result = merge(fixture(), [{ front: 'Cell', back: 'خانە' }], { ...options, deckId: '', newDeckName: '  پزیشکی — الطب  ' });
  const deck = result.state.decks.at(-1);
  assert.equal(deck.name, 'پزیشکی — الطب');
  assert.equal(result.state.cards.at(-1).deckId, deck.id);
  validate(result.state);
});
test('per-file decks remain distinct; existing names match without case', () => {
  const result = merge(fixture(), [{ front: 'Cell', back: 'خانە', deckName: 'BIOLOGY' }, { front: 'Air', back: 'هەوا', deckName: 'Respiratory::Lecture 3' }], { ...options, keepDecks: true });
  assert.equal(result.state.decks.length, 3);
  assert.equal(result.state.cards[2].deckId, 'biology');
  assert.equal(result.state.decks[2].name, 'Respiratory::Lecture 3');
  assert.equal(result.state.cards[3].deckId, result.state.decks[2].id);
});
test('empty rows and rows missing one side are skipped', () => {
  const state = fixture();
  const result = merge(state, [{ front: '', back: '' }, { front: ' \n ', back: 'دڵ' }, { front: 'Heart', back: '' }], options);
  assert.equal(result.counts.empty, 3);
  assert.deepEqual(result.state, state);
});
test('image-only front and back can be imported and validated', () => {
  const result = merge(fixture(), [{ front: '', back: '', mediaSupplied: true, frontImages: ['question.png', 'question.png'], backImages: ['answer.webp'] }], options);
  const card = result.state.cards.at(-1);
  assert.equal(result.counts.added, 1);
  assert.equal(card.front, '');
  assert.equal(card.back, '');
  assert.deepEqual(card.frontImages, ['question.png']);
  assert.deepEqual(card.backImages, ['answer.webp']);
  validate(result.state);
});
test('two different image-only fronts without source GUIDs should remain two cards', () => {
  const result = merge(fixture(), [
    { front: '', back: 'First diagram', mediaSupplied: true, frontImages: ['first.png'] },
    { front: '', back: 'Second diagram', mediaSupplied: true, frontImages: ['second.png'] }
  ], options);
  assert.equal(result.counts.added, 2);
  assert.equal(result.state.cards.length, 4);
});
test('image-only APKG fronts remain distinct with source keys', () => {
  const result = merge(fixture(), [
    { front: '', back: 'First diagram', mediaSupplied: true, frontImages: ['first.png'], sourceKey: 'anki:Diagram1:0' },
    { front: '', back: 'Second diagram', mediaSupplied: true, frontImages: ['second.png'], sourceKey: 'anki:Diagram2:0' }
  ], options);
  assert.equal(result.counts.added, 2);
  assert.equal(result.state.cards.length, 4);
  validate(result.state);
});
test('text front plus legacy image-only back validates', () => {
  const result = merge(fixture(), [{ front: 'Identify this organ', back: '', image: 'answer.jpg', mediaSupplied: true }], options);
  assert.equal(result.counts.added, 1);
  validate(result.state);
});
test('unsafe image array entries are rejected by backup validation', () => {
  const unsafe = ['../private.png', 'folder/heart.png', 'C:\\heart.png', 'https://example.com/a.png', 'data:image/png;base64,AA==', 'image.svg', '<img>.png', 8, null, { name: 'heart.png' }];
  for (const value of unsafe) {
    for (const key of ['frontImages', 'backImages']) {
      const state = fixture(); state.cards[0][key] = [value];
      assert.throws(() => validate(state), /Invalid images/);
    }
  }
});
test('non-array image lists and more than 100 images are rejected', () => {
  for (const value of ['heart.png', { length: 1 }, Array(101).fill('heart.png')]) {
    const state = fixture(); state.cards[0].frontImages = value;
    assert.throws(() => validate(state), /Invalid images/);
  }
  const state = fixture(); state.cards[0].frontImages = Array(100).fill('heart.png');
  validate(state);
});
test('empty text cannot masquerade as image-only using invalid lists', () => {
  for (const value of ['heart.png', { length: 1 }, ['https://example.com/a.png']]) {
    const state = fixture(); state.cards[0].front = ''; state.cards[0].frontImages = value;
    assert.throws(() => validate(state));
  }
});
test('merge never mutates the caller state, rows or review objects', () => {
  const state = fixture();
  const rows = [{ front: 'HEART', back: 'نوێ', mediaSupplied: true, frontImages: ['new.png'], backImages: ['answer.png'], tags: ['fresh'] }];
  const original = clone(state), originalRows = clone(rows);
  const result = merge(state, rows, options);
  assert.deepEqual(state, original);
  assert.deepEqual(rows, originalRows);
  result.state.cards[0].frontImages.push('later.png');
  result.state.reviews['Seed#Guid1'].reps += 10;
  result.state.history[0].rating = 'again';
  assert.deepEqual(state, original);
  assert.deepEqual(rows, originalRows);
});
test('rejected merged state leaves caller state untouched before confirmation', () => {
  const state = fixture(), original = clone(state);
  const result = merge(state, [{ front: 'Cell', back: 'خانە', mediaSupplied: true, backImages: ['../bad.png'] }], options);
  assert.throws(() => validate(result.state), /Invalid images/);
  assert.deepEqual(state, original);
});
test('all-empty rows should not create an empty requested new deck', () => {
  const state = fixture();
  const result = merge(state, [{ front: '', back: '' }], { ...options, deckId: '', newDeckName: 'Empty file' });
  assert.equal(result.counts.empty, 1);
  assert.equal(result.state.decks.length, state.decks.length);
});

