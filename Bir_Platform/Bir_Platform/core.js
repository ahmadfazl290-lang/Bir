(function (root) {
  'use strict';
  const DAY = 86400000;
  function dayKey(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function queue(cards, reviews, history, limit, now, deckId) {
    const matching = cards.filter(c => !deckId || c.deckId === deckId);
    const seenToday = new Set(history.filter(h => h.wasNew && dayKey(h.at) === dayKey(now)).map(h => h.cardId));
    const due = matching.filter(c => reviews[c.id] && reviews[c.id].due <= now).sort((a,b) => reviews[a.id].due - reviews[b.id].due);
    const unseen = matching.filter(c => !reviews[c.id]).slice(0, Math.max(0, limit - seenToday.size));
    return [...due, ...unseen].map(c => c.id);
  }
  function grade(previous, rating, now) {
    if (!['again','hard','good','easy'].includes(rating)) throw new Error('Invalid rating');
    const old = previous || {interval:0,reps:0,lapses:0};
    let interval;
    if (rating === 'again') interval = 60000;
    if (rating === 'hard') interval = 360000;
    if (rating === 'good') interval = Math.max(DAY, Math.round(old.interval * 2.2));
    if (rating === 'easy') interval = Math.max(4*DAY, Math.round(old.interval * 2.8));
    interval = Math.min(interval, 36500*DAY);
    return {due:now+interval,interval,reps:old.reps+1,lapses:old.lapses+(rating==='again'?1:0),last:now};
  }
  function validateBackup(value) {
    if (!value || value.schema !== 1 || !Array.isArray(value.cards) || !Array.isArray(value.decks) || !value.settings || !value.reviews || typeof value.reviews !== 'object' || Array.isArray(value.reviews) || !Array.isArray(value.history)) throw new Error('Invalid backup');
    if (value.cards.length > 100000 || value.decks.length > 10000 || value.history.length > 1000000) throw new Error('Backup too large');
    const decks = new Set();
    const safeId = id => typeof id === 'string' && id.trim().length > 0 && !['__proto__','prototype','constructor'].includes(id);
    const timestamp = time => Number.isFinite(time) && time >= 0 && time <= 8640000000000000;
    const imageName = name => typeof name === 'string' && /^[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|gif|avif)$/i.test(name);
    for (const d of value.decks) {
      if (!d || !safeId(d.id) || typeof d.name !== 'string' || !d.name.trim() || decks.has(d.id)) throw new Error('Invalid deck');
      decks.add(d.id);
    }
    const ids = new Set();
    for (const c of value.cards) {
      if (!c || !safeId(c.id) || ids.has(c.id) || !decks.has(c.deckId) || typeof c.front !== 'string' || typeof c.back !== 'string' || (!c.front.trim() && !c.frontImages?.length) || (!c.back.trim() && !c.backImages?.length && !c.image) || (c.image && !imageName(c.image)) || (c.definition !== undefined && typeof c.definition !== 'string') || (c.imageCaption !== undefined && typeof c.imageCaption !== 'string')) throw new Error('Invalid card');
      for (const key of ['frontImages','backImages']) if (c[key]!==undefined && (!Array.isArray(c[key]) || c[key].length>100 || !c[key].every(imageName))) throw new Error('Invalid images');
      ids.add(c.id);
    }
    for (const [id,r] of Object.entries(value.reviews)) {
      if (!ids.has(id) || !r || !['due','interval','reps','lapses','last'].every(k => Number.isFinite(r[k]) && r[k] >= 0) || !timestamp(r.due) || !timestamp(r.last) || !Number.isInteger(r.reps) || !Number.isInteger(r.lapses) || r.lapses > r.reps) throw new Error('Invalid review');
    }
    for (const h of value.history) {
      if (!h || !ids.has(h.cardId) || !timestamp(h.at) || !['again','hard','good','easy'].includes(h.rating) || typeof h.wasNew !== 'boolean') throw new Error('Invalid history');
    }
    if (!['ckb','en','ar'].includes(value.settings.lang) || !['light','dark','system'].includes(value.settings.theme) || !Number.isInteger(value.settings.limit) || value.settings.limit < 1 || value.settings.limit > 200) throw new Error('Invalid settings');
    if (value.settings.speechLang !== undefined && !['auto','en','ckb','ar'].includes(value.settings.speechLang)) throw new Error('Invalid speech language');
    if (value.settings.speechVoice !== undefined && (typeof value.settings.speechVoice !== 'string' || value.settings.speechVoice.length > 500)) throw new Error('Invalid speech voice');
    if (value.deckDeletionSequence !== undefined && (!Number.isSafeInteger(value.deckDeletionSequence) || value.deckDeletionSequence < 0)) throw new Error('Invalid deletion sequence');
    if (value.deletedDecks !== undefined) {
      if (!root.BIR_DECK_ACTIONS) throw new Error('Deck recovery unavailable');
      root.BIR_DECK_ACTIONS.validateTrash(value, validateBackup);
    }
    return value;
  }
  root.BIR_CORE = {DAY,dayKey,queue,grade,validateBackup};
})(typeof window === 'undefined' ? globalThis : window);
