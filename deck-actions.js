(function (root) {
  'use strict';

  const LIMITS = Object.freeze({ cards: 100000, decks: 10000, history: 1000000 });
  const safeId = id => typeof id === 'string' && !!id.trim() && !['__proto__', 'prototype', 'constructor'].includes(id);
  const timestamp = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
  const position = value => Number.isSafeInteger(value) && value >= 0;
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const imageName = name => typeof name === 'string' && /^[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|gif|avif)$/i.test(name);
  const copy = value => JSON.parse(JSON.stringify(value));

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  // Structural checks also allow use without loading the rest of the app.
  function validateActive(state) {
    if (!object(state) || state.schema !== 1 || !Array.isArray(state.decks) || !Array.isArray(state.cards) || !Array.isArray(state.history) || !object(state.reviews) || !object(state.settings)) fail('INVALID_STATE', 'Invalid collection.');
    if (state.cards.length > LIMITS.cards || state.decks.length > LIMITS.decks || state.history.length > LIMITS.history) fail('INVALID_STATE', 'Collection exceeds its limits.');
    const deckIds = new Set(), cardIds = new Set();
    for (const deck of state.decks) {
      if (!object(deck) || !safeId(deck.id) || typeof deck.name !== 'string' || !deck.name.trim() || deckIds.has(deck.id)) fail('INVALID_STATE', 'Invalid deck.');
      deckIds.add(deck.id);
    }
    for (const card of state.cards) {
      if (!object(card) || !safeId(card.id) || cardIds.has(card.id) || !deckIds.has(card.deckId) || typeof card.front !== 'string' || typeof card.back !== 'string') fail('INVALID_STATE', 'Invalid card.');
      for (const key of ['frontImages', 'backImages']) {
        if (card[key] !== undefined && (!Array.isArray(card[key]) || card[key].length > 100 || !card[key].every(imageName))) fail('INVALID_STATE', 'Invalid card images.');
      }
      if ((!card.front.trim() && !card.frontImages?.length) || (!card.back.trim() && !card.backImages?.length && !card.image) || (card.image && !imageName(card.image)) || (card.definition !== undefined && typeof card.definition !== 'string') || (card.imageCaption !== undefined && typeof card.imageCaption !== 'string')) fail('INVALID_STATE', 'Invalid card content.');
      cardIds.add(card.id);
    }
    for (const [id, review] of Object.entries(state.reviews)) {
      if (!cardIds.has(id) || !object(review) || !['due', 'interval', 'reps', 'lapses', 'last'].every(key => Number.isFinite(review[key]) && review[key] >= 0) || !timestamp(review.due) || !timestamp(review.last) || !Number.isInteger(review.reps) || !Number.isInteger(review.lapses) || review.lapses > review.reps) fail('INVALID_STATE', 'Invalid review.');
    }
    for (const event of state.history) {
      if (!object(event) || !cardIds.has(event.cardId) || !timestamp(event.at) || !['again', 'hard', 'good', 'easy'].includes(event.rating) || typeof event.wasNew !== 'boolean') fail('INVALID_STATE', 'Invalid study history.');
    }
    if (!['ckb', 'en', 'ar'].includes(state.settings.lang) || !['light', 'dark', 'system'].includes(state.settings.theme) || !Number.isInteger(state.settings.limit) || state.settings.limit < 1 || state.settings.limit > 200) fail('INVALID_STATE', 'Invalid settings.');
    if (state.settings.speechLang !== undefined && !['auto', 'en', 'ckb', 'ar'].includes(state.settings.speechLang)) fail('INVALID_STATE', 'Invalid speech language.');
    if (state.settings.speechVoice !== undefined && (typeof state.settings.speechVoice !== 'string' || state.settings.speechVoice.length > 500)) fail('INVALID_STATE', 'Invalid speech voice.');
    if (state.deckDeletionSequence !== undefined && !position(state.deckDeletionSequence)) fail('INVALID_STATE', 'Invalid deletion sequence.');
    return state;
  }

  function validateTrash(state, activeValidator) {
    if (state.deletedDecks === undefined) return state;
    const records = state.deletedDecks;
    if (!Array.isArray(records) || records.length > LIMITS.decks) fail('INVALID_DELETED_DECKS', 'Invalid deleted decks.');
    const validate = typeof activeValidator === 'function' ? activeValidator : validateActive;
    const recordIds = new Set(), deckIds = new Set(), cardIds = new Set();
    const occupied = { deckIndex: new Set(), cardPositions: new Set(), historyPositions: new Set() };
    let cards = 0, history = 0;
    for (const record of records) {
      if (!object(record) || !safeId(record.id) || recordIds.has(record.id) || !object(record.deck) || !safeId(record.deck.id) || deckIds.has(record.deck.id) || !timestamp(record.deletedAt) || !Array.isArray(record.cards) || !object(record.reviews) || !Array.isArray(record.history)) fail('INVALID_DELETED_DECKS', 'Invalid deleted deck record.');
      recordIds.add(record.id);
      deckIds.add(record.deck.id);
      cards += record.cards.length;
      history += record.history.length;
      if (cards > LIMITS.cards || history > LIMITS.history) fail('INVALID_DELETED_DECKS', 'Deleted decks exceed their limits.');
      if (record.deckIndex !== undefined) {
        if (!position(record.deckIndex) || occupied.deckIndex.has(record.deckIndex)) fail('INVALID_DELETED_DECKS', 'Invalid deck order.');
        occupied.deckIndex.add(record.deckIndex);
      }
      for (const [key, length] of [['cardPositions', record.cards.length], ['historyPositions', record.history.length]]) {
        if (record[key] !== undefined) {
          if (!Array.isArray(record[key]) || record[key].length !== length || record[key].some(index => !position(index))) fail('INVALID_DELETED_DECKS', 'Invalid deleted item order.');
          for (const index of record[key]) {
            if (occupied[key].has(index)) fail('INVALID_DELETED_DECKS', 'Duplicate deleted item position.');
            occupied[key].add(index);
          }
        }
      }
      for (const card of record.cards) {
        if (!object(card) || !safeId(card.id) || cardIds.has(card.id) || card.deckId !== record.deck.id) fail('INVALID_DELETED_DECKS', 'Invalid deleted card.');
        cardIds.add(card.id);
      }
      try {
        validate({ schema: 1, decks: [record.deck], cards: record.cards, reviews: record.reviews, history: record.history, settings: state.settings });
      } catch (_) {
        fail('INVALID_DELETED_DECKS', 'Invalid content in a deleted deck.');
      }
    }
    return state;
  }

  function checkedCopy(state) {
    validateActive(state);
    validateTrash(state);
    try { return copy(state); }
    catch (_) { fail('INVALID_STATE', 'Collection must contain serializable data.'); }
  }

  function positionsFor(activeItems, records, key) {
    const occupied = new Set();
    for (const record of records) {
      const positions = key === 'deckIndex' ? [record.deckIndex] : record[key];
      if (Array.isArray(positions)) positions.forEach(index => { if (position(index)) occupied.add(index); });
    }
    let next = 0;
    return activeItems.map(() => {
      while (occupied.has(next)) next += 1;
      return next++;
    });
  }

  function remove(previous, deckId, now = Date.now()) {
    const state = checkedCopy(previous);
    const index = state.decks.findIndex(deck => deck.id === deckId);
    if (index < 0) fail('DECK_NOT_FOUND', 'The deck does not exist.');
    if (!timestamp(now)) fail('INVALID_TIMESTAMP', 'Invalid deletion time.');
    const deletedAt = Math.floor(now);
    const records = state.deletedDecks || [];
    const removedCards = state.cards.filter(card => card.deckId === deckId);
    const ids = new Set(removedCards.map(card => card.id));
    const removedHistory = state.history.filter(event => ids.has(event.cardId));
    if (records.length >= LIMITS.decks || records.reduce((sum, record) => sum + record.cards.length, removedCards.length) > LIMITS.cards || records.reduce((sum, record) => sum + record.history.length, removedHistory.length) > LIMITS.history) fail('DELETION_LIMIT', 'Deleted decks are full. Restore a deck before deleting more.');
    let sequence = state.deckDeletionSequence || 0;
    let deletedId;
    do {
      if (sequence >= Number.MAX_SAFE_INTEGER) fail('DELETION_LIMIT', 'Deletion sequence is full.');
      sequence += 1;
      deletedId = 'deleted:' + deletedAt + ':' + sequence;
    } while (records.some(record => record.id === deletedId));
    const deckPositions = positionsFor(state.decks, records, 'deckIndex');
    const cardPositions = positionsFor(state.cards, records, 'cardPositions');
    const historyPositions = positionsFor(state.history, records, 'historyPositions');
    const reviews = {};
    for (const id of ids) {
      if (Object.prototype.hasOwnProperty.call(state.reviews, id)) {
        reviews[id] = state.reviews[id];
        delete state.reviews[id];
      }
    }
    records.push({
      id: deletedId,
      deck: state.decks[index],
      cards: removedCards,
      reviews,
      history: removedHistory,
      deletedAt,
      deckIndex: deckPositions[index],
      cardPositions: cardPositions.filter((_, itemIndex) => ids.has(state.cards[itemIndex].id)),
      historyPositions: historyPositions.filter((_, itemIndex) => ids.has(state.history[itemIndex].cardId))
    });
    state.deletedDecks = records;
    state.deckDeletionSequence = sequence;
    state.decks = state.decks.filter(deck => deck.id !== deckId);
    state.cards = state.cards.filter(card => !ids.has(card.id));
    state.history = state.history.filter(event => !ids.has(event.cardId));
    validateActive(state);
    validateTrash(state);
    return state;
  }

  function insertByPosition(active, incoming, activePositions, incomingPositions) {
    if (!Array.isArray(incomingPositions)) return active.concat(incoming);
    return active.map((item, index) => ({ item, index: activePositions[index], order: index }))
      .concat(incoming.map((item, index) => ({ item, index: incomingPositions[index], order: active.length + index })))
      .sort((a, b) => a.index - b.index || a.order - b.order)
      .map(entry => entry.item);
  }

  function restore(previous, deletedId) {
    const state = checkedCopy(previous);
    const records = state.deletedDecks || [];
    const record = records.find(item => item.id === deletedId);
    if (!record) fail('DELETED_DECK_NOT_FOUND', 'The deleted deck does not exist.');
    const activeCards = new Set(state.cards.map(card => card.id));
    if (state.decks.some(deck => deck.id === record.deck.id) || record.cards.some(card => activeCards.has(card.id))) fail('RESTORE_CONFLICT', 'An active deck or card already has one of these IDs.');
    if (state.decks.length + 1 > LIMITS.decks || state.cards.length + record.cards.length > LIMITS.cards || state.history.length + record.history.length > LIMITS.history) fail('RESTORE_LIMIT', 'Restoring this deck would exceed the collection limits.');
    state.decks = insertByPosition(state.decks, [record.deck], positionsFor(state.decks, records, 'deckIndex'), position(record.deckIndex) ? [record.deckIndex] : undefined);
    state.cards = insertByPosition(state.cards, record.cards, positionsFor(state.cards, records, 'cardPositions'), record.cardPositions);
    state.history = insertByPosition(state.history, record.history, positionsFor(state.history, records, 'historyPositions'), record.historyPositions);
    for (const [id, review] of Object.entries(record.reviews)) state.reviews[id] = review;
    state.deletedDecks = records.filter(item => item.id !== deletedId);
    validateActive(state);
    validateTrash(state);
    return state;
  }

  root.BIR_DECK_ACTIONS = Object.freeze({ remove, restore, validateTrash });
})(typeof window === 'undefined' ? globalThis : window);
