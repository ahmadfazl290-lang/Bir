const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '..');
function context() {
  const sandbox = { window: {}, crypto: webcrypto, TextEncoder };
  for (const name of ['deck-actions.js', 'core.js', 'text-import.js', 'import-cards.js', 'deck-data.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, name), 'utf8'), sandbox, { filename: name });
  }
  return sandbox.window;
}
const clone = value => JSON.parse(JSON.stringify(value));

test('the platform package starts without bundled decks, cards or study images', () => {
  const app = context(), seed = app.BIR_SEED;
  assert.deepEqual(clone(seed.decks), []);
  assert.deepEqual(clone(seed.cards), []);
  assert.deepEqual(fs.readdirSync(path.join(root, 'media')).filter(name => name !== '.gitkeep'), []);
});

test('a first CSV import creates a deck from the blank platform and retains reviews through backup reload', () => {
  const app = context(), seed = clone(app.BIR_SEED);
  const previous = {
    schema: 1, decks: seed.decks, cards: seed.cards, reviews: {}, history: [],
    settings: { lang: 'ckb', theme: 'system', limit: 20 }
  };
  const untouched = clone(previous);
  const parsed = app.BIR_TEXT_IMPORT.parse('Front,Back\nQuestion one,Answer one\nQuestion two,Answer two\n', { filename: 'my-cards.csv' });
  const rows = parsed.rows.map(row => ({ front: row[parsed.suggested.front], back: row[parsed.suggested.back] }));
  const result = app.BIR_IMPORT_CARDS.merge(previous, rows, { newDeckName: 'My cards', keepDecks: false, mode: 'merge' });
  const imported = result.state;
  app.BIR_CORE.validateBackup(imported);
  assert.deepEqual(previous, untouched);
  assert.deepEqual(clone(result.counts), { added: 2, updated: 0, skipped: 0, empty: 0 });
  assert.equal(imported.decks.length, 1);
  assert.equal(imported.decks[0].name, 'My cards');
  assert.ok(imported.cards.every(card => card.deckId === imported.decks[0].id));
  assert.deepEqual(clone(imported.cards.map(card => [card.front, card.back])), [['Question one', 'Answer one'], ['Question two', 'Answer two']]);
  const now = 2000000;
  const firstId = imported.cards[0].id, secondId = imported.cards[1].id;
  assert.deepEqual(clone(app.BIR_CORE.queue(imported.cards, imported.reviews, imported.history, 20, now)), [firstId, secondId]);
  imported.reviews[firstId] = app.BIR_CORE.grade(null, 'good', now);
  imported.history.push({ cardId: firstId, at: now, rating: 'good', wasNew: true });
  const reloaded = app.BIR_CORE.validateBackup(clone(imported));
  assert.deepEqual(reloaded, clone(imported));
  assert.deepEqual(clone(app.BIR_CORE.queue(reloaded.cards, reloaded.reviews, reloaded.history, 20, now)), [secondId]);
  assert.ok(app.BIR_CORE.queue(reloaded.cards, reloaded.reviews, reloaded.history, 20, reloaded.reviews[firstId].due).includes(firstId));
});

test('CSV import, review state, backup reload, deck removal and recovery work together', () => {
  const app = context();
  const previous = {
    schema: 1, decks: [{ id: 'biology', name: 'Biology' }],
    cards: [{ id: 'learned-card', deckId: 'biology', front: 'Cell', back: 'خانە', definition: 'A living unit.', image: 'cell.png' }],
    reviews: { 'learned-card': { due: 2000000, interval: 86400000, reps: 4, lapses: 1, last: 1000000 } },
    history: [{ cardId: 'learned-card', at: 1000000, rating: 'good', wasNew: true }],
    settings: { lang: 'ckb', theme: 'system', limit: 20 }
  };
  const untouched = clone(previous);
  const parsed = app.BIR_TEXT_IMPORT.parse('Front,Back\nCELL,خلية\nHeart,دڵ\n', { filename: 'biology.csv' });
  const rows = parsed.rows.map(row => ({ front: row[parsed.suggested.front], back: row[parsed.suggested.back] }));
  const imported = app.BIR_IMPORT_CARDS.merge(previous, rows, { deckId: 'biology', keepDecks: false, mode: 'update' }).state;
  app.BIR_CORE.validateBackup(imported);
  assert.deepEqual(previous, untouched);
  assert.equal(imported.cards[0].id, 'learned-card');
  assert.equal(imported.cards[0].back, 'خلية');
  assert.equal(imported.cards[0].definition, 'A living unit.');
  assert.equal(imported.cards[0].image, 'cell.png');
  assert.deepEqual(clone(imported.reviews), previous.reviews);
  const removed = app.BIR_DECK_ACTIONS.remove(imported, 'biology', 3000000);
  const reloaded = clone(removed);
  app.BIR_CORE.validateBackup(reloaded);
  assert.equal(reloaded.cards.length, 0);
  assert.equal(reloaded.deletedDecks[0].cards.length, 2);
  const recovered = app.BIR_DECK_ACTIONS.restore(reloaded, reloaded.deletedDecks[0].id);
  app.BIR_CORE.validateBackup(recovered);
  for (const key of ['cards', 'decks', 'reviews', 'history', 'settings']) assert.deepEqual(clone(recovered[key]), clone(imported[key]));
});

test('the page loads the recovery validator before core and uses local application scripts', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  assert.ok(scripts.indexOf('deck-actions.js') >= 0);
  assert.ok(scripts.indexOf('deck-actions.js') < scripts.indexOf('core.js'));
  for (const script of scripts) {
    assert.ok(!/^(?:https?:)?\/\//i.test(script), 'External application script: ' + script);
    assert.ok(fs.statSync(path.join(root, script)).isFile(), 'Missing application script: ' + script);
  }
});
