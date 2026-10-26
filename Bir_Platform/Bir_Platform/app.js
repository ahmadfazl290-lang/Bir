(function () {
  'use strict';
  const C = window.BIR_CORE;
  for(const language of ['ckb','en','ar']) Object.assign(window.BIR_I18N[language],window.BIR_IMPORT_I18N[language]);
  const KEY = 'bir-platform-v1';
  const seed = window.BIR_SEED;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const icons = {
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    decks:'<rect x="5" y="3" width="15" height="17" rx="3"/><path d="M2 7v12a3 3 0 0 0 3 3M9 8h7m-7 4h5"/>',
    chart:'<path d="M4 20h17M7 16v-5m5 5V5m5 11V8"/>',
    settings:'<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
    arrow:'<path d="m14 5-7 7 7 7M7 12h14"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    check:'<path d="m5 12 4 4L20 5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
    eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    edit:'<path d="m15 4 5 5M4 15l12-12 5 5L9 20l-6 1Z"/>',
    undo:'<path d="M4 10h10a6 6 0 1 1 0 12M4 10l5-5M4 10l5 5"/>',
    leaf:'<path d="M20 3C9 2 3 8 5 15s15 7 15-12Z"/><path d="M3 22 16 9"/>',
    flag:'<path d="M5 22V3m0 0c6-4 8 4 15 0v11c-7 4-9-4-15 0"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    speaker:'<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>'
  };
  function icon(name, extra='') { return `<svg viewBox="0 0 24 24" aria-hidden="true" class="${extra}">${icons[name] || icons.decks}</svg>`; }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function initial() { return {schema:1,settings:{lang:'ckb',theme:'system',limit:20},decks:clone(seed.decks),cards:clone(seed.cards),reviews:{},history:[]}; }
  let state = initial(), storageIssue = '', route = 'today', browseDeck = null, search = '', browseLimit = 50;
  let session = null, revealed = false, undoRecord = null, toastTimer, lastFocus, modalKind = null;
  try { const saved = localStorage.getItem(KEY); if (saved) state = C.validateBackup(JSON.parse(saved)); }
  catch (_) { storageIssue = 'storageUnavailable'; }
  const t = key => window.BIR_I18N[state.settings.lang][key] || window.BIR_I18N.en[key] || key;
  const num = value => new Intl.NumberFormat(state.settings.lang === 'en' ? 'en' : 'ar-IQ', {numberingSystem:state.settings.lang === 'en'?'latn':'arab'}).format(value);
  const message = (key,values={}) => t(key).replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??''));
  let speechTarget = '', speech;
  speech = window.BIR_SPEECH.create({onState:()=>{syncSpeechControls();syncSpeechVoices();}});
  function stopSpeech() { speechTarget='';speech.stop();syncSpeechControls(); }
  function syncSpeechControls() {
    const status=speech?.getState().status, active=['queued','speaking'].includes(status);
    document.querySelectorAll('[data-action="stop-reading"]').forEach(button=>{button.hidden=!active;});
    document.querySelectorAll('[data-action="read-card"]').forEach(button=>{
      const selected=active&&`${button.dataset.card}:${button.dataset.part}`===speechTarget;
      button.setAttribute('aria-pressed',String(selected));button.classList.toggle('reading',selected);
    });
  }
  function speechButton(card,part,label) {
    const text=part==='front'?card.front:part==='back'?card.back:card.definition;
    if(!text?.trim())return '';
    return `<button class="btn ghost speech-button" data-action="read-card" data-card="${esc(card.id)}" data-part="${part}" aria-pressed="false">${icon('speaker')}${esc(t(label))}</button>`;
  }
  function speechTools(card,answer=false) {
    return `<div class="speech-tools" role="group" aria-label="${esc(t('readAloud'))}">${speechButton(card,'front','readQuestion')}${answer?speechButton(card,'back','readAnswer'):''}<button class="btn ghost speech-stop" data-action="stop-reading" hidden>${icon('stop')}${esc(t('stopReading'))}</button></div>`;
  }
  function readCard(id,part) {
    const card=state.cards.find(c=>c.id===id);if(!card)return;
    if(route==='review'&&part!=='front'&&!revealed)return;
    const text=part==='front'?card.front:part==='back'?card.back:card.definition;
    const chunks=window.BIR_SPEECH.segments(text||'',{fallbackLang:part==='definition'?'en':state.settings.lang});
    speechTarget=`${id}:${part}`;
    const result=speech.speak(chunks,{lang:state.settings.speechLang||'auto',voiceURI:state.settings.speechVoice||'',onError:()=>toast(t('speechFailed'))});
    if(!result.ok){
      speechTarget='';
      if(result.status==='no-voice')toast(message('speechNoVoice',{language:(result.missingLanguages||[]).map(lang=>t({en:'speechEnglish',ckb:'speechKurdish',ar:'speechArabic'}[lang]||'speechLanguage')).join('، ')}));
      else toast(t(result.status==='unsupported'?'speechUnsupported':result.status==='empty'?'speechEmpty':'speechFailed'));
    }
    syncSpeechControls();
  }
  function speechVoiceOptions() {
    const language=state.settings.speechLang||'auto', selected=state.settings.speechVoice||'';
    const voices=speech.getVoices(language==='auto'?undefined:language);
    return `<option value="">${esc(t('speechSystemVoice'))}</option>${voices.map(voice=>`<option value="${esc(voice.voiceURI)}" ${voice.voiceURI===selected?'selected':''}>${esc(voice.name)} · ${esc(voice.lang)}</option>`).join('')}`;
  }
  function syncSpeechVoices() {
    const select=document.getElementById('speech-voice');if(select&&speech)select.innerHTML=speechVoiceOptions();
  }
  function speechSettingsView() {
    return `<section class="settings-section"><h3>${esc(t('speechSettings'))}</h3><p class="settings-description">${esc(t('speechVoiceHint'))}</p><div class="speech-settings-grid"><div class="field"><label for="speech-language">${esc(t('speechLanguage'))}</label><select id="speech-language">${[['auto','speechAuto'],['en','speechEnglish'],['ckb','speechKurdish'],['ar','speechArabic']].map(([value,label])=>`<option value="${value}" ${(state.settings.speechLang||'auto')===value?'selected':''}>${esc(t(label))}</option>`).join('')}</select></div><div class="field"><label for="speech-voice">${esc(t('speechVoice'))}</label><select id="speech-voice">${speechVoiceOptions()}</select></div></div></section>`;
  }
  function deckName(deck) { return deck.name; }
  function formatDate(time) {
    const date=new Date(time);
    if(state.settings.lang==='ckb'){
      const months=['کانوونی دووەم','شوبات','ئازار','نیسان','ئایار','حوزەیران','تەمووز','ئاب','ئەیلوول','تشرینی یەکەم','تشرینی دووەم','کانوونی یەکەم'];
      return `${t('weekDays')[date.getDay()]}، ${num(date.getDate())} ${months[date.getMonth()]}`;
    }
    return new Intl.DateTimeFormat(state.settings.lang,{weekday:'long',month:'long',day:'numeric'}).format(date);
  }
  function toast(text) { const node = document.getElementById('toast'); node.textContent = text; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 3500); }
  function commit(change) {
    const previous = clone(state);
    change(state);
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageIssue = ''; return true; }
    catch (_) { state = previous; storageIssue = 'storageError'; toast(t('storageError')); return false; }
  }
  function applyTheme() {
    const theme = state.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light') : state.settings.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = state.settings.lang;
    document.documentElement.dir = state.settings.lang === 'en' ? 'ltr' : 'rtl';
    document.title = `Bîr — ${t(route === 'review' ? 'study' : route === 'browse' ? 'browseCards' : route)}`;
  }
  function navButton(name, symbol, mobile=false) { return `<button class="${mobile?'':'nav-button '}${route===name?'active':''}" data-action="nav" data-route="${name}" ${route===name?'aria-current="page"':''}>${icon(symbol)}<span>${esc(t(name))}</span></button>`; }
  function render() {
    stopSpeech();
    applyTheme();
    document.body.classList.toggle('review-active', route === 'review');
    app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="icon.svg" alt=""><div>${esc(t('appName'))}<small>${esc(t('tagline'))}</small></div></div><nav class="nav" aria-label="${esc(t('appName'))}">${navButton('today','sun')}${navButton('decks','decks')}${navButton('progress','chart')}</nav><div class="sidebar-bottom">${navButton('settings','settings')}<div class="version">BÎR · ${esc(t('prototype'))}</div></div></aside><main class="main"><header class="topbar"><div><div class="eyebrow">${esc(t('appName'))} · ${esc(t('prototype'))}</div><div class="eyebrow">${esc(formatDate(Date.now()))}</div><h2>${esc(t(route==='today'?'hello':route==='browse'?'browseCards':route==='review'?'study':route))}</h2></div><div class="top-actions"><button class="language-chip" data-action="language" aria-label="${esc(t('switchLanguage'))}">${icon('globe')}<span>${{ckb:'کوردی',en:'English',ar:'العربية'}[state.settings.lang]}</span></button><button class="icon-button" data-action="nav" data-route="settings" aria-label="${esc(t('settings'))}">${icon('settings')}</button></div></header>${storageIssue?`<div class="storage-warning" role="alert">${esc(t(storageIssue))}</div>`:''}<div class="screen" id="screen">${route==='today'?todayView():route==='decks'?decksView():route==='browse'?browseView():route==='progress'?progressView():route==='settings'?settingsView():reviewView()}</div></main><nav class="mobile-nav" aria-label="${esc(t('appName'))}">${navButton('today','sun',true)}${navButton('decks','decks',true)}${navButton('progress','chart',true)}</nav></div>`;
  }
  function currentQueue(deckId) { return C.queue(state.cards,state.reviews,state.history,state.settings.limit,Date.now(),deckId); }
  function reviewsToday() { return state.history.filter(h => C.dayKey(h.at) === C.dayKey(Date.now())); }
  function stat(label,value,symbol) { return `<div class="stat"><div class="stat-top"><span>${esc(label)}</span>${icon(symbol)}</div><div class="stat-value">${esc(value)}</div></div>`; }
  function deckView(deck) {
    const count = state.cards.filter(c=>c.deckId===deck.id).length;
    const countDue = currentQueue(deck.id).length;
    return `<div class="deck"><div class="deck-symbol">${icon('decks')}</div><div class="deck-content"><h3>${esc(deckName(deck))}</h3><small>${num(count)} ${esc(t('cardCount'))} · ${num(countDue)} ${esc(t('remaining'))}</small></div><div class="deck-actions"><button class="btn secondary" data-action="browse" data-deck="${esc(deck.id)}">${icon('search')}<span class="browse-label">${esc(t('browseCards'))}</span></button><button class="btn" data-action="study" data-deck="${esc(deck.id)}" ${countDue?'':'disabled'}>${esc(t('study'))}</button>${route==='decks'?`<button class="icon-button delete-deck-button" data-action="delete-deck" data-deck="${esc(deck.id)}" aria-label="${esc(t('deleteDeck')+': '+deckName(deck))}" title="${esc(t('deleteDeck'))}">${icon('trash')}</button>`:''}</div></div>`;
  }
  function todayView() {
    const queue = currentQueue(), newCount = queue.filter(id=>!state.reviews[id]).length, due = queue.length-newCount, reviewed=reviewsToday().length;
    const empty = state.cards.length === 0;
    const actions = empty
      ? `<div class="button-row"><button class="btn" data-action="import-file">${icon('upload')}${esc(t('importFile'))}</button><button class="btn secondary" data-action="create-deck">${icon('plus')}${esc(t('createDeck'))}</button></div>`
      : `<button class="btn" data-action="study" ${queue.length?'':'disabled'}>${icon(queue.length?'decks':'check')}${esc(t('study'))}${queue.length?`<span>· ${num(queue.length)}</span>`:''}</button>`;
    return `<section class="hero"><div><h1>${esc(t(empty?'welcomeTitle':queue.length?'heroTitle':'allDone'))}</h1><p>${esc(t(empty?'welcomeBody':queue.length?'heroBody':'allDoneBody'))}</p>${actions}</div><div class="hero-mark" aria-hidden="true"><div class="hero-card"></div><div class="hero-card">${icon('leaf')}</div></div></section><div class="stats">${stat(t('dueToday'),num(due),'clock')}${stat(t('newCards'),num(newCount),'decks')}${stat(t('reviewedToday'),num(reviewed),'check')}</div><div class="section-header"><h2>${esc(t('decks'))}</h2><button class="btn ghost" data-action="nav" data-route="decks">${esc(t('allDecks'))}</button></div><div class="deck-list">${state.decks.length?state.decks.slice(0,3).map(deckView).join(''):`<div class="empty">${icon('decks')}<h2>${esc(t('noDecks'))}</h2><p>${esc(t('noDecksBody'))}</p></div>`}</div><div class="tip">${icon('leaf')}<span>${esc(t('learningNote'))}</span></div>`;
  }
  function decksView() { return `<div class="page-title"><div><h1>${esc(t('decks'))}</h1><p class="muted">${esc(t('totalCards'))}: ${num(state.cards.length)}</p></div><div class="page-title-actions"><button class="btn secondary" data-action="import-file">${icon('upload')}${esc(t('importFile'))}</button><button class="btn" data-action="create-deck">${icon('plus')}${esc(t('createDeck'))}</button></div></div><div class="deck-list">${state.decks.length?state.decks.map(deckView).join(''):`<div class="empty">${icon('decks')}<h2>${esc(t('noDecks'))}</h2><p>${esc(t('noDecksBody'))}</p></div>`}</div>${deletedDecksView()}`; }
  function deletedDecksView() {
    const records=state.deletedDecks||[];if(!records.length)return '';
    return `<details class="deleted-decks"><summary>${esc(t('deletedDecks'))} · ${num(records.length)}</summary><div class="deleted-deck-list">${records.map(record=>`<div class="deleted-deck-row"><div><strong dir="auto">${esc(deckName(record.deck))}</strong><small>${num(record.cards.length)} ${esc(t('cardCount'))}</small></div><button class="btn secondary" data-action="restore-deck" data-deleted="${esc(record.id)}">${icon('undo')}${esc(t('restoreDeck'))}</button></div>`).join('')}</div></details>`;
  }
  function deleteDeckDialog(id) {
    const deck=state.decks.find(d=>d.id===id);if(!deck)return;
    const count=state.cards.filter(c=>c.deckId===id).length;
    openModal(t('deleteDeckTitle'),`<p class="delete-deck-description">${esc(message('deleteDeckBody',{deck:deckName(deck),count:num(count)}))}</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn secondary" data-action="close-modal">${esc(t('cancel'))}</button><button class="btn danger" data-action="confirm-delete-deck" data-deck="${esc(id)}">${icon('trash')}${esc(t('deleteDeckConfirm'))}</button></div>`,'delete-deck');
  }
  function deleteDeck(id) {
    try{
      const next=window.BIR_DECK_ACTIONS.remove(state,id,Date.now());C.validateBackup(next);
      if(!commit(s=>Object.assign(s,next)))return;
      closeModal();session=null;undoRecord=null;browseDeck=null;route='decks';render();toast(t('deckDeleted'));
    }catch(_){const error=modalRoot.querySelector('.form-error');if(error)error.textContent=t('deleteDeckFailed');}
  }
  function restoreDeck(id) {
    try{
      const next=window.BIR_DECK_ACTIONS.restore(state,id);C.validateBackup(next);
      if(!commit(s=>Object.assign(s,next)))return;
      render();toast(t('deckRestored'));
    }catch(_){toast(t('restoreDeckFailed'));}
  }
  function filteredCards() {
    const q = search.normalize('NFC').toLocaleLowerCase();
    return state.cards.filter(c=>(!browseDeck || c.deckId===browseDeck) && (!q || `${c.front} ${c.back} ${c.definition||''}`.normalize('NFC').toLocaleLowerCase().includes(q)));
  }
  function browseView() {
    const deck = state.decks.find(d=>d.id===browseDeck), cards=filteredCards();
    return `<div class="page-title"><div><button class="btn ghost" data-action="nav" data-route="decks">${icon('arrow','icon-back')}${esc(t('back'))}</button><h1>${esc(deck?deckName(deck):t('allDecks'))}</h1><small>${num(cards.length)} ${esc(t('cardCount'))}</small></div><button class="btn" data-action="add-card">${icon('plus')}${esc(t('addCard'))}</button></div><label class="search">${icon('search')}<input id="card-search" type="search" value="${esc(search)}" placeholder="${esc(t('searchPlaceholder'))}" aria-label="${esc(t('searchCards'))}"></label><div id="browse-results">${cardRows(cards)}</div>`;
  }
  function cardRows(cards) {
    if (!cards.length) return `<div class="empty">${icon('decks')}<h2>${esc(t(search?'noResults':'emptyDeck'))}</h2><p>${esc(t(search?'emptySearch':'emptyDeckBody'))}</p></div>`;
    return `<div class="cards-list">${cards.slice(0,browseLimit).map(c=>`<button class="card-row" data-action="preview-card" data-card="${esc(c.id)}"><div class="card-row-content"><strong dir="auto">${esc(c.front||t('image'))}</strong><span dir="auto">${esc(c.back)}</span></div>${primaryImage(c)?`<img class="mini-image" src="media/${encodeURIComponent(primaryImage(c))}" alt="" loading="lazy">`:icon('eye')}</button>`).join('')}</div>${cards.length>browseLimit?`<div class="list-footer"><button class="btn secondary" data-action="more-cards">${esc(t('showMoreCards'))} · ${num(Math.min(cards.length, browseLimit+50))}/${num(cards.length)}</button></div>`:''}`;
  }
  function progressView() {
    const history=state.history, days=[];
    for(let i=6;i>=0;i--){const date=new Date();date.setDate(date.getDate()-i);days.push({date,key:C.dayKey(date.getTime()),count:history.filter(h=>C.dayKey(h.at)===C.dayKey(date.getTime())).length});}
    const max = Math.max(1,...days.map(d=>d.count));
    const good=history.filter(h=>['good','easy'].includes(h.rating)).length;
    let streak=0;const active=new Set(history.map(h=>C.dayKey(h.at)));const date=new Date();if(!active.has(C.dayKey(date.getTime())))date.setDate(date.getDate()-1);while(active.has(C.dayKey(date.getTime()))){streak++;date.setDate(date.getDate()-1);}
    return `<div class="page-title"><h1>${esc(t('progress'))}</h1></div><div class="stats">${stat(t('totalReviews'),num(history.length),'decks')}${stat(t('dayStreak'),num(streak),'flag')}${stat(`${t('good')} + ${t('easy')}`,history.length?`${num(Math.round(good/history.length*100))}%`:'—','check')}</div><section class="settings-section" style="margin-top:25px"><h3>${esc(t('lastSevenDays'))}</h3>${!history.length?`<p class="muted">${esc(t('noHistory'))}</p>`:''}<div class="chart" role="img" aria-label="${esc(t('lastSevenDays'))}">${days.map(d=>`<div class="chart-column" title="${esc(formatDate(d.date.getTime()))}: ${d.count}"><span class="chart-count">${num(d.count)}</span><div class="chart-bar" style="height:${Math.max(2,d.count/max*125)}px"></div><span class="chart-day">${esc(`${num(d.date.getDate())}/${num(d.date.getMonth()+1)}`)}</span></div>`).join('')}</div></section>`;
  }
  function settingsView() {
    return `<div class="page-title"><h1>${esc(t('settings'))}</h1></div><section class="settings-section"><h3>${esc(t('language'))}</h3><div class="segmented" role="group" aria-label="${esc(t('language'))}">${[['ckb','کوردی'],['en','English'],['ar','العربية']].map(([id,label])=>`<button class="segment ${state.settings.lang===id?'selected':''}" data-action="set-language" data-lang="${id}" aria-pressed="${state.settings.lang===id}">${label}</button>`).join('')}</div><div class="settings-row"><h3 style="margin:0">${esc(t('theme'))}</h3><div class="segmented">${['light','dark','system'].map(theme=>`<button class="segment ${state.settings.theme===theme?'selected':''}" data-action="set-theme" data-theme="${theme}" aria-pressed="${state.settings.theme===theme}">${esc(t(theme))}</button>`).join('')}</div></div><label class="settings-row"><span>${esc(t('dailyNewLimit'))}</span><input class="number-input" id="daily-limit" type="number" min="1" max="200" value="${state.settings.limit}"></label></section>${speechSettingsView()}<section class="settings-section"><h3>${esc(t('data'))}</h3><p class="settings-description">${esc(t('backupHint'))}</p><div class="button-row"><button class="btn" data-action="import-file">${icon('upload')}${esc(t('importFile'))}</button><button class="btn secondary" data-action="export-backup">${icon('download')}${esc(t('exportBackup'))}</button><button class="btn secondary" data-action="import-backup">${icon('upload')}${esc(t('importBackup'))}</button><input id="backup-input" type="file" accept=".json,application/json" hidden></div></section><section class="settings-section"><h3>${esc(t('about'))}</h3><p class="settings-description">${esc(t('aboutBody'))}</p><small style="display:block;margin-top:16px">Bîr · ${esc(t('prototype'))} · 0.1</small></section>`;
  }
  function reviewView() {
    if (!session || session.cursor>=session.ids.length) return completeView();
    const card=state.cards.find(c=>c.id===session.ids[session.cursor]);
    if(!card)return completeView();
    const deck=state.decks.find(d=>d.id===card.deckId);
    return `<div class="review-shell"><header class="review-header"><button class="icon-button" data-action="leave-study" aria-label="${esc(t('back'))}">${icon('arrow','icon-back')}</button><div class="review-meta"><strong>${esc(deckName(deck))}</strong><small>${num(session.cursor+1)} ${esc(t('of'))} ${num(session.ids.length)}</small></div><button class="icon-button" data-action="edit-review-card" data-card="${esc(card.id)}" aria-label="${esc(t('editCard'))}">${icon('edit')}</button></header><div class="progress-track" role="progressbar" aria-label="${esc(t('progress'))}" aria-valuemin="0" aria-valuemax="${session.ids.length}" aria-valuenow="${session.cursor}"><div class="progress-fill" style="width:${session.cursor/session.ids.length*100}%"></div></div><article class="study-card" aria-live="polite"><div class="study-label">${esc(t(revealed?'answer':'question'))}</div>${speechTools(card,revealed)}<div class="study-word" dir="auto">${esc(card.front)}</div>${cardImages(card,'front')}${revealed?cardAnswer(card):''}</article><div class="review-controls">${revealed?`<div class="rating-grid">${['again','hard','good','easy'].map(r=>`<button class="rating" data-action="rate" data-rating="${r}">${esc(t(r))}<small>${esc(intervalLabel(C.grade(state.reviews[card.id],r,Date.now()).interval))}</small></button>`).join('')}</div>`:`<button class="btn full" data-action="show-answer">${icon('eye')}${esc(t('showAnswer'))}</button>`}</div><div class="session-footer"><button class="btn ghost" data-action="undo" ${undoRecord?'':'disabled'}>${icon('undo')}${esc(t('undo'))}</button></div></div>`;
  }
  function intervalLabel(ms) {
    const unit=ms<C.DAY?'Minute':'Day', count=Math.round(ms/(ms<C.DAY?60000:C.DAY));
    if(state.settings.lang==='ar' && count===2)return t(`unit${unit}Two`);
    const suffix=count===1?'One':state.settings.lang==='ar' && count%100>=3 && count%100<=10?'Few':'Many';
    return `${num(count)} ${t(`unit${unit}${suffix}`)}`;
  }
  function primaryImage(card){return card.frontImages?.[0]||card.backImages?.[0]||card.image||'';}
  function cardImages(card,side){const names=side==='front'?(card.frontImages||[]):card.backImages?.length?card.backImages:card.image?[card.image]:[];return names.map(name=>`<img src="media/${encodeURIComponent(name)}" alt="${esc(card.imageCaption||card.front||t('image'))}" loading="lazy">`).join('');}
  function cardAnswer(card) { return `<div class="study-meaning" dir="auto">${esc(card.back)}</div>${card.definition?`<div class="definition" dir="ltr"><div class="definition-heading"><small>${esc(t('englishDefinition'))}</small>${speechButton(card,'definition','readDefinition')}</div><div>${esc(card.definition)}</div></div>`:''}${cardImages(card,'back')}${card.imageCaption?`<p class="image-caption" dir="ltr">${esc(card.imageCaption)}</p>`:''}`; }
  function completeView() { return `<div class="review-shell completion"><div class="complete-icon">${icon('check')}</div><h1>${esc(t('sessionComplete'))}</h1><p>${esc(t('sessionCompleteBody'))}</p><div class="stats">${stat(t('reviewedCards'),num(session?session.cursor:0),'check')}${stat(t('remaining'),num(currentQueue().length),'clock')}</div><div class="button-row" style="justify-content:center;margin-top:28px"><button class="btn" data-action="nav" data-route="today">${esc(t('returnHome'))}</button>${undoRecord?`<button class="btn secondary" data-action="undo">${icon('undo')}${esc(t('undo'))}</button>`:''}</div></div>`; }
  function navigate(to) {
    if (route==='review' && session && session.cursor<session.ids.length && !confirm(t('confirmLeave'))) return;
    route=to;session=null;undoRecord=null;revealed=false;search='';render();window.scrollTo(0,0);
  }
  function startStudy(deckId) {
    const ids=currentQueue(deckId);
    if(!ids.length){toast(t('noCardsDue'));return;}
    session={ids,cursor:0,deckId:deckId||null};undoRecord=null;revealed=false;route='review';render();window.scrollTo(0,0);
  }
  function rate(rating) {
    if(!session || !revealed || session.cursor>=session.ids.length)return;
    const cardId=session.ids[session.cursor], previous=state.reviews[cardId]?clone(state.reviews[cardId]):null, now=Date.now();
    if(!commit(s=>{s.reviews[cardId]=C.grade(previous,rating,now);s.history.push({cardId,rating,at:now,wasNew:!previous});}))return;
    undoRecord={cardId,previous,at:now,cursor:session.cursor};session.cursor++;revealed=false;render();window.scrollTo(0,0);
  }
  function undo() {
    if(!undoRecord || !session)return;
    const record=undoRecord,last=state.history[state.history.length-1];
    if(!last || last.cardId!==record.cardId || last.at!==record.at)return;
    if(!commit(s=>{if(record.previous)s.reviews[record.cardId]=record.previous;else delete s.reviews[record.cardId];s.history.pop();}))return;
    session.cursor=record.cursor;undoRecord=null;revealed=true;render();
  }
  function openModal(title,body,kind) {
    stopSpeech();
    lastFocus=document.activeElement;modalKind=kind;
    modalRoot.innerHTML=`<div class="modal-backdrop"><section class="modal ${kind==='file-import'?'import-modal':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="${esc(t('close'))}">${icon('close')}</button></header>${body}</section></div>`;
    document.body.classList.add('modal-open');
    const input=modalRoot.querySelector('input,textarea,select,button');if(input)input.focus();
  }
  function closeModal() { stopSpeech();modalRoot.innerHTML='';modalKind=null;document.body.classList.remove('modal-open');if(lastFocus&&document.contains(lastFocus))lastFocus.focus(); }
  function createDeckDialog() { openModal(t('createDeck'),`<form id="deck-form"><div class="field"><label for="deck-name">${esc(t('deckName'))}</label><input id="deck-name" name="name" maxlength="100" required dir="auto"></div><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn secondary" data-action="close-modal">${esc(t('cancel'))}</button><button class="btn" type="submit">${esc(t('create'))}</button></div></form>`,'deck');modalRoot.querySelector('input').focus(); }
  function editor(cardId) {
    if(!state.decks.length){route='decks';render();return;}
    const card=state.cards.find(c=>c.id===cardId), id=card?card.id:'', deckId=card?card.deckId:browseDeck||state.decks[0].id;
    openModal(t(card?'editCard':'addCard'),`<form id="card-form" data-card="${esc(id)}"><div class="field"><label for="editor-deck">${esc(t('selectDeck'))}</label><select id="editor-deck" name="deck">${state.decks.map(d=>`<option value="${esc(d.id)}" ${d.id===deckId?'selected':''}>${esc(deckName(d))}</option>`).join('')}</select></div><div class="field"><label for="editor-front">${esc(t('front'))}</label><textarea id="editor-front" name="front" ${card?.frontImages?.length?'':'required'} maxlength="3000" dir="auto">${esc(card?.front||'')}</textarea></div><div class="field"><label for="editor-back">${esc(t('backText'))}</label><textarea id="editor-back" name="back" ${card?.backImages?.length||card?.image?'':'required'} maxlength="5000" dir="auto">${esc(card?.back||'')}</textarea></div><div class="field"><label for="editor-definition">${esc(t('englishDefinition'))} · ${esc(t('optional'))}</label><textarea id="editor-definition" name="definition" maxlength="5000" dir="ltr">${esc(card?.definition||'')}</textarea></div><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn secondary" data-action="close-modal">${esc(t('cancel'))}</button><button class="btn" type="submit">${esc(t('save'))}</button></div></form>`,'editor');
  }
  function previewCard(id) {
    const card=state.cards.find(c=>c.id===id);if(!card)return;
    openModal(t('cardPreview'),`${speechTools(card,true)}<div class="study-word" dir="auto">${esc(card.front)}</div>${cardImages(card,'front')}${cardAnswer(card)}<div class="modal-actions"><button class="btn secondary" data-action="edit-card" data-card="${esc(card.id)}">${icon('edit')}${esc(t('editCard'))}</button><button class="btn" data-action="close-modal">${esc(t('done'))}</button></div>`,'preview');
  }
  function exportBackup() {
    try {
      const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`Bir-backup-${C.dayKey(Date.now())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(t('backupExported'));
    }catch(_){toast(t('backupFailed'));}
  }
  async function importBackup(file) {
    if(!file)return;
    try {
      if(file.size>20000000)throw new Error('Too large');
      const incoming=C.validateBackup(JSON.parse(await file.text()));
      if(!confirm(t('importWarning')))return;
      const previous=state;state=clone(incoming);
      try{localStorage.setItem(KEY,JSON.stringify(state));storageIssue='';}catch(_){state=previous;throw new Error('Cannot save');}
      route='today';session=null;undoRecord=null;render();toast(t('backupImported'));
    }catch(_){toast(t('invalidBackup'));}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button || button.disabled)return;
    const action=button.dataset.action;
    if(action==='nav')navigate(button.dataset.route);
    if(action==='language'){navigate('settings');setTimeout(()=>document.querySelector('.segmented button')?.focus(),0);}
    if(action==='set-language' && commit(s=>{s.settings.lang=button.dataset.lang;}))render();
    if(action==='set-theme' && commit(s=>{s.settings.theme=button.dataset.theme;}))render();
    if(action==='study')startStudy(button.dataset.deck);
    if(action==='browse'){route='browse';browseDeck=button.dataset.deck;search='';browseLimit=50;render();window.scrollTo(0,0);}
    if(action==='more-cards'){const oldScroll=scrollY;browseLimit+=50;document.getElementById('browse-results').innerHTML=cardRows(filteredCards());window.scrollTo(0,oldScroll);}
    if(action==='create-deck')createDeckDialog();
    if(action==='delete-deck')deleteDeckDialog(button.dataset.deck);
    if(action==='confirm-delete-deck')deleteDeck(button.dataset.deck);
    if(action==='restore-deck')restoreDeck(button.dataset.deleted);
    if(action==='read-card')readCard(button.dataset.card,button.dataset.part);
    if(action==='stop-reading')stopSpeech();
    if(action==='import-file')window.BIR_FILE_IMPORT.open();
    if(action==='add-card')editor();
    if(action==='edit-card'){const id=button.dataset.card;closeModal();editor(id);}
    if(action==='edit-review-card')editor(button.dataset.card);
    if(action==='preview-card')previewCard(button.dataset.card);
    if(action==='close-modal')closeModal();
    if(action==='show-answer'){revealed=true;render();}
    if(action==='rate')rate(button.dataset.rating);
    if(action==='undo')undo();
    if(action==='leave-study')navigate('today');
    if(action==='export-backup')exportBackup();
    if(action==='import-backup')document.getElementById('backup-input').click();
  });
  document.addEventListener('input',event=>{
    if(event.target.id==='card-search'){search=event.target.value;browseLimit=50;document.getElementById('browse-results').innerHTML=cardRows(filteredCards());}
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='speech-language'){
      const value=event.target.value;if(!['auto','en','ckb','ar'].includes(value))return;
      if(commit(s=>{s.settings.speechLang=value;s.settings.speechVoice='';})){stopSpeech();syncSpeechVoices();}
    }
    if(event.target.id==='speech-voice'){
      if(commit(s=>{s.settings.speechVoice=event.target.value;}))stopSpeech();
    }
    if(event.target.id==='daily-limit'){
      const value=Number(event.target.value);if(!Number.isInteger(value)||value<1||value>200){event.target.value=state.settings.limit;return;}
      if(commit(s=>{s.settings.limit=value;}))toast(t('saved'));
    }
    if(event.target.id==='backup-input'){importBackup(event.target.files[0]);event.target.value='';}
  });
  document.addEventListener('submit',event=>{
    if(!['deck-form','card-form'].includes(event.target.id))return;
    event.preventDefault();const form=event.target,data=new FormData(form),error=form.querySelector('.form-error');
    if(form.id==='deck-form'){
      const name=String(data.get('name')).trim();if(!name)return;
      if(state.decks.some(d=>d.name.toLocaleLowerCase()===name.toLocaleLowerCase())){form.querySelector('input').setCustomValidity(t('duplicateDeck'));form.reportValidity();form.querySelector('input').setCustomValidity('');return;}
      if(commit(s=>s.decks.push({id:crypto.randomUUID(),name}))){closeModal();route='decks';render();toast(t('deckCreated'));}else error.textContent=t('storageError');
    }else{
      const front=String(data.get('front')).trim(),back=String(data.get('back')).trim(),definition=String(data.get('definition')).trim(),deckId=String(data.get('deck'));
      const existing=state.cards.find(c=>c.id===form.dataset.card);
      if((!front&&!existing?.frontImages?.length)||(!back&&!existing?.backImages?.length&&!existing?.image)){error.textContent=t('requiredFields');return;}
      if(commit(s=>{if(existing){const card=s.cards.find(c=>c.id===existing.id);Object.assign(card,{front,back,definition,deckId});}else s.cards.push({id:crypto.randomUUID(),front,back,definition,deckId,image:'',imageCaption:''});})){
        closeModal();render();toast(t('cardSaved'));
      }else error.textContent=t('storageError');
    }
  });
  document.addEventListener('keydown',event=>{
    if(modalKind){
      if(event.key==='Escape'){event.preventDefault();closeModal();return;}
      if(event.key==='Tab'){
        const focusable=[...modalRoot.querySelectorAll('button,input,textarea,select,a[href]')].filter(e=>!e.disabled),first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }return;
    }
    if(route==='review' && !['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName)){
      if(event.code==='Space'&&!revealed){event.preventDefault();revealed=true;render();}
      if(revealed&&['1','2','3','4'].includes(event.key)){event.preventDefault();rate(['again','hard','good','easy'][Number(event.key)-1]);}
    }
  });
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(state.settings.theme==='system')applyTheme();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopSpeech();});
  window.addEventListener('pagehide',stopSpeech);
  window.addEventListener('storage',event=>{if(event.key===KEY && event.newValue){try{state=C.validateBackup(JSON.parse(event.newValue));route='today';session=null;undoRecord=null;closeModal();render();}catch(_){toast(t('invalidBackup'));}}});
  // Inspection hook is read-only; review data is persisted only through user actions.
  window.BIR_APP = {snapshot:()=>clone(state),getRoute:()=>route};
  window.BIR_FILE_IMPORT.init({state:()=>clone(state),t,num,openModal,closeModal,
    apply(cards,options){
      const result=window.BIR_IMPORT_CARDS.merge(state,cards,options);
      if(result.state.cards.length>100000)throw Object.assign(new Error('TOO_MANY_ROWS'),{code:'TOO_MANY_ROWS'});
      C.validateBackup(result.state);
      if(!commit(s=>Object.assign(s,result.state)))return null;
      closeModal();route='decks';session=null;undoRecord=null;render();return result.counts;
    }
  });
  render();
})();
