(function (root) {
  'use strict';
  const LANGUAGES = ['en', 'ckb', 'ar'];
  const SORANI = /[ڕڵێۆەڤگچپژکی]/u;
  const ARABIC = /\p{Script=Arabic}/u;
  const LATIN = /\p{Script=Latin}/u;
  const LETTER = /\p{Letter}/u;

  function language(value) {
    const tag = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    const base = tag.split('-')[0];
    return base === 'ku' || base === 'ckb' ? 'ckb' : ['en', 'ar'].includes(base) ? base : null;
  }
  function clean(text) {
    return String(text == null ? '' : text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/gu, ' ').trim();
  }
  function detectLanguage(text, options) {
    text = clean(text);
    const fallback = language(options && options.fallbackLang);
    if (SORANI.test(text)) return 'ckb';
    if (ARABIC.test(text)) return fallback === 'ckb' ? 'ckb' : 'ar';
    if (LATIN.test(text)) return 'en';
    return text && !LETTER.test(text) ? fallback : null;
  }
  function segments(text, options) {
    text = clean(text);
    if (!text) return [];
    const result = [];
    let buffer = '', script = null;
    function flush() {
      const value = buffer.trim();
      if (value) result.push({text:value, lang:detectLanguage(value, options)});
      buffer = '';
    }
    for (const character of text) {
      const next = LATIN.test(character) ? 'latin' : ARABIC.test(character) ? 'arabic' : LETTER.test(character) ? 'other' : null;
      if (next && script && next !== script) flush();
      if (next) script = next;
      buffer += character;
    }
    flush();
    return result;
  }
  function splitLong(text) {
    const parts = [];
    let remainder = text;
    while (remainder.length > 240) {
      const sample = remainder.slice(0, 241);
      let boundary = Math.max(sample.lastIndexOf('. '), sample.lastIndexOf('? '), sample.lastIndexOf('! '), sample.lastIndexOf('؟ '));
      if (boundary >= 60) boundary += 1;
      else boundary = sample.lastIndexOf(' ');
      if (boundary < 40) boundary = 240;
      // Avoid dividing a UTF-16 surrogate pair when no word boundary exists.
      if (/[\uD800-\uDBFF]/.test(remainder[boundary - 1])) boundary--;
      parts.push(remainder.slice(0, boundary).trim());
      remainder = remainder.slice(boundary).trim();
    }
    if (remainder) parts.push(remainder);
    return parts;
  }
  function voiceLanguage(voice) {
    const tag = String(voice.lang || '').toLowerCase().replace(/_/g, '-');
    const base = tag.split('-')[0];
    if (base === 'ckb') return 'ckb';
    // Generic Kurdish can be Kurmanji. Only accept an explicit Arabic-script
    // Kurdish tag or Sorani/Central Kurdish metadata as a Sorani fallback.
    if (base === 'ku' && (tag.split('-').includes('arab') || /sorani|central\s+kurdish|سۆرانی|سوراني|سورانی/i.test(voice.name || ''))) return 'ckb';
    return ['en', 'ar'].includes(base) ? base : null;
  }
  function descriptor(voice) {
    return {voiceURI:String(voice.voiceURI || ''), name:String(voice.name || ''), lang:String(voice.lang || ''), localService:voice.localService === true, default:voice.default === true};
  }
  function safely(callback, value) {
    if (typeof callback === 'function') { try { callback(value); } catch (_) { /* A UI callback must not break cancellation. */ } }
  }

  function create(options) {
    options = options || {};
    const synthesis = Object.prototype.hasOwnProperty.call(options, 'synthesis') ? options.synthesis : root.speechSynthesis;
    const Utterance = Object.prototype.hasOwnProperty.call(options, 'Utterance') ? options.Utterance : root.SpeechSynthesisUtterance;
    const supported = !!(synthesis && typeof synthesis.speak === 'function' && typeof synthesis.cancel === 'function' && typeof synthesis.getVoices === 'function' && typeof Utterance === 'function');
    let voices = [], token = 0, active = null, destroyed = false, listener = null, previousListener = null;
    let state = {status:supported ? 'idle' : 'unsupported', supported, busy:false, isSpeaking:false, missingLanguages:[], error:null, chunkIndex:0, totalChunks:0};
    function refresh() {
      try { voices = supported ? Array.from(synthesis.getVoices() || []).filter(Boolean) : []; }
      catch (_) { voices = []; }
    }
    function getVoices(lang) {
      refresh();
      const target = language(lang);
      return voices.filter(voice => !lang || (target && voiceLanguage(voice) === target)).map(descriptor);
    }
    function getState() {
      return {...state, token, voices:voices.map(descriptor), availableLanguages:LANGUAGES.filter(lang => voices.some(voice => voiceLanguage(voice) === lang)), missingLanguages:state.missingLanguages.slice()};
    }
    function update(values, reason) {
      state = {...state, ...values};
      safely(options.onState, {...getState(), reason:reason || state.status});
    }
    function choose(lang, voiceURI) {
      if (!LANGUAGES.includes(lang)) return null;
      const candidates = voices.filter(voice => voiceLanguage(voice) === lang && (!voiceURI || String(voice.voiceURI || '') === voiceURI));
      return candidates.map((voice, index) => ({voice, index, rank:(voice.localService === true ? 1000 : 0) + (String(voice.lang || '').toLowerCase().split(/[-_]/)[0] === lang ? 100 : 0) + (voice.default ? 10 : 0)}))
        .sort((a, b) => b.rank - a.rank || a.index - b.index)[0]?.voice || null;
    }
    function prepare(chunks, settings) {
      settings = settings || {};
      const override = language(settings.lang);
      const selectedURI = settings.voiceURI == null ? '' : String(settings.voiceURI);
      const input = typeof chunks === 'string' ? [{text:chunks}] : Array.isArray(chunks) ? chunks : [];
      const normalized = [];
      for (const chunk of input) {
        const text = clean(typeof chunk === 'string' ? chunk : chunk && chunk.text);
        if (!text) continue;
        const explicit = override || language(chunk && chunk.lang);
        const items = explicit ? [{text, lang:explicit}] : segments(text, {fallbackLang:settings.fallbackLang});
        for (const item of items) {
          for (const part of splitLong(item.text)) normalized.push({text:part, lang:item.lang});
        }
      }
      refresh();
      const plan = normalized.map(chunk => ({...chunk, voice:choose(chunk.lang, selectedURI)}));
      const missingLanguages = [...new Set(plan.filter(chunk => !chunk.voice).map(chunk => chunk.lang || 'unknown'))];
      const status = !plan.length ? 'empty' : destroyed ? 'destroyed' : !supported ? 'unsupported' : missingLanguages.length ? 'no-voice' : 'ready';
      return {status, missingLanguages, plan, overridden:!!override};
    }
    function publicPlan(result) {
      return {ok:result.status === 'ready', status:result.status, missingLanguages:result.missingLanguages.slice(), overridden:result.overridden, chunks:result.plan.map(chunk => ({text:chunk.text, lang:chunk.lang, voiceURI:chunk.voice ? String(chunk.voice.voiceURI || '') : null}))};
    }
    function analyze(chunks, settings) { return publicPlan(prepare(chunks, settings)); }
    function invalidate() {
      token++;
      active = null;
      if (supported) { try { synthesis.cancel(); } catch (_) { /* Cancellation remains logically complete. */ } }
    }
    function speak(chunks, settings) {
      settings = settings || {};
      if (destroyed) return {ok:false, status:'destroyed', missingLanguages:[], chunks:[], overridden:false};
      invalidate();
      const prepared = prepare(chunks, settings);
      const result = publicPlan(prepared);
      if (!result.ok) {
        update({status:result.status, busy:false, isSpeaking:false, missingLanguages:result.missingLanguages, error:null, chunkIndex:0, totalChunks:prepared.plan.length});
        return result;
      }
      const job = {token, plan:prepared.plan, current:null, index:0};
      active = job;
      update({status:'queued', busy:true, isSpeaking:false, missingLanguages:[], error:null, chunkIndex:0, totalChunks:job.plan.length});
      function isCurrent(utterance) { return !destroyed && active === job && token === job.token && (!utterance || job.current === utterance); }
      function fail(code) {
        if (!isCurrent()) return;
        invalidate();
        update({status:'error', busy:false, isSpeaking:false, error:String(code || 'speech-error')});
        safely(settings.onError, {status:'error', error:state.error});
      }
      function next() {
        if (!isCurrent()) return;
        if (job.index >= job.plan.length) {
          active = null;
          update({status:'ended', busy:false, isSpeaking:false, chunkIndex:job.plan.length});
          safely(settings.onEnd, {status:'ended', spokenChunks:job.plan.length});
          return;
        }
        const chunk = job.plan[job.index];
        let utterance;
        try { utterance = new Utterance(chunk.text); }
        catch (_) { fail('utterance-unavailable'); return; }
        job.current = utterance;
        utterance.voice = chunk.voice;
        utterance.lang = String(chunk.voice.lang || chunk.lang).replace(/_/g, '-');
        utterance.rate = Number.isFinite(settings.rate) ? Math.min(2, Math.max(0.5, settings.rate)) : 1;
        utterance.onstart = function () { if (isCurrent(utterance)) update({status:'speaking', busy:true, isSpeaking:true, chunkIndex:job.index}); };
        utterance.onend = function () {
          if (!isCurrent(utterance)) return;
          job.current = null;
          job.index++;
          next();
        };
        utterance.onerror = function (event) { if (isCurrent(utterance)) fail(event && event.error); };
        try { synthesis.speak(utterance); }
        catch (_) { fail('speech-unavailable'); }
      }
      next();
      return {...result, ok:state.status !== 'error', status:state.status, ...(state.error ? {error:state.error} : {})};
    }
    function stop() {
      if (destroyed) return getState();
      invalidate();
      update({status:'stopped', busy:false, isSpeaking:false, error:null, missingLanguages:[], chunkIndex:0, totalChunks:0});
      return getState();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      invalidate();
      update({status:'destroyed', busy:false, isSpeaking:false, error:null, missingLanguages:[], chunkIndex:0, totalChunks:0});
      if (supported && listener) {
        if (typeof synthesis.removeEventListener === 'function') synthesis.removeEventListener('voiceschanged', listener);
        else if (synthesis.onvoiceschanged === listener) synthesis.onvoiceschanged = previousListener;
      }
    }
    refresh();
    if (supported) {
      listener = function (event) {
        if (destroyed) return;
        if (previousListener) safely(previousListener.bind(synthesis), event);
        refresh();
        update({}, 'voiceschanged');
      };
      if (typeof synthesis.addEventListener === 'function') synthesis.addEventListener('voiceschanged', listener);
      else { previousListener = synthesis.onvoiceschanged; synthesis.onvoiceschanged = listener; }
    }
    update({}, 'initial');
    return {getState, getVoices, analyze, speak, stop, destroy};
  }
  const api = {create, segments, detectLanguage};
  root.BIR_SPEECH = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
