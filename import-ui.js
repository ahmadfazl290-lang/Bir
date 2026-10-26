(function(){
  'use strict';
  let adapter,selection=null,attempt=0;
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const t=key=>adapter.t(key), num=value=>adapter.num(value);
  function errorText(error){
    const code=error?.code||error?.message||'';
    if(code==='FILE_TOO_LARGE')return t('fileTooLarge');
    if(code==='EMPTY_FILE')return t('emptyFile');
    if(code==='INVALID_QUOTES')return t('invalidQuotes');
    if(code==='TOO_MANY_ROWS'||code==='TOO_MANY_COLUMNS')return t('tooManyRows');
    if(code==='SERVER_REQUIRED')return t('serverRequired');
    if(code==='IMPORT_BUSY')return t('importBusy');
    return t('invalidFile');
  }
  function open(){selection=null;attempt++;adapter.openModal(t('importTitle'),picker(),'file-import');}
  function picker(){return `<p class="settings-description">${esc(t('importSubtitle'))}</p><div class="import-drop"><input id="flashcard-file" type="file" accept=".apkg,.txt,.tsv,.csv" aria-label="${esc(t('chooseFile'))}"><p>${esc(t('acceptedFiles'))}</p></div><p class="settings-description">${esc(t('localImportNote'))}</p><p id="file-import-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="btn secondary" data-action="close-modal">${esc(t('cancel'))}</button></div>`;}
  function busy(message){adapter.openModal(t('importTitle'),`<div class="import-loading" role="status"><span class="import-spinner" aria-hidden="true"></span><p>${esc(message)}</p></div><p class="settings-description">${esc(t('localImportNote'))}</p><div class="modal-actions"><button class="btn secondary" data-action="close-modal">${esc(t('cancel'))}</button></div>`,'file-import');}
  function alive(token){return attempt===token && !!$('#modal-root [data-import-modal], #modal-root .import-loading, #flashcard-file');}
  async function readFile(file){
    if(!file)return;
    const token=++attempt;
    const extension=file.name.toLocaleLowerCase().split('.').pop();
    if(!['apkg','txt','tsv','csv'].includes(extension)){$('#file-import-error').textContent=t('unsupportedFile');return;}
    if(file.size>(extension==='apkg'?150:20)*1024*1024){$('#file-import-error').textContent=t('fileTooLarge');return;}
    busy(t('readingFile'));
    try{
      if(extension==='apkg'){
        if(location.protocol!=='http:' || !['127.0.0.1','localhost'].includes(location.hostname))throw new Error('SERVER_REQUIRED');
        const response=await fetch('/api/import-apkg',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Bir-Import':'1'},body:file});
        let data;try{data=await response.json();}catch(_){throw new Error('SERVER_REQUIRED');}
        if(!response.ok||!data.ok)throw new Error(data.error||'INVALID_FILE');
        const names=new Map(data.decks.map(d=>[String(d.sourceId),d.name]));
        const cards=data.cards.map(card=>({...card,mediaSupplied:true,deckName:names.get(String(card.sourceDeck))||file.name.replace(/\.apkg$/i,'')}));
        if(!cards.length)throw new Error('EMPTY_FILE');
        if(!alive(token))return;
        selection={file,type:'apkg',cards,counts:data.counts,warnings:data.warnings||[]};
      }else{
        const bytes=new Uint8Array(await file.arrayBuffer());
        const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
        const text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
        const parsed=window.BIR_TEXT_IMPORT.parse(text,{filename:file.name});
        if(!alive(token))return;
        selection={file,type:'text',text,parsed,mapping:{...parsed.suggested},separator:'auto',header:'auto'};
      }
      showPreview();
    }catch(error){
      if(!alive(token))return;
      selection=null;adapter.openModal(t('importTitle'),picker(),'file-import');$('#file-import-error').textContent=errorText(error);
    }
  }
  function columnSelect(name,label,selected,optional=false){
    const columns=selection.parsed.columns;
    return `<div class="field"><label for="import-${name}">${esc(t(label))}</label><select id="import-${name}" name="${name}" data-import-column="${name}">${optional?`<option value="-1" ${selected===-1?'selected':''}>${esc(t('skipColumn'))}</option>`:''}${columns.map((column,i)=>`<option value="${i}" ${selected===i?'selected':''}>${num(i+1)} · ${esc(column)}</option>`).join('')}</select></div>`;
  }
  function textCards(){
    const p=selection.parsed,m=selection.mapping,plain=value=>window.BIR_TEXT_IMPORT.plainText(value,p.metadata.html);
    return p.rows.map(row=>{
      const explicitGuid=p.metadata.guidColumn>=0 || /\bguid\b/i.test(p.columns[m.guid]||'');
      const guid=explicitGuid&&m.guid>=0?(row[m.guid]||'').trim():'';
      const tags=m.tags>=0?String(row[m.tags]||''):p.metadata.tags||undefined;
      return {front:plain(row[m.front]||''),back:plain(row[m.back]||''),definition:m.definition>=0?plain(row[m.definition]||''):undefined,deckName:(m.deck>=0?plain(row[m.deck]||''):'')||p.metadata.deck||selection.file.name.replace(/\.[^.]+$/,''),sourceKey:guid?`anki:${guid}:0`:'',guid,templateOrd:0,tags:tags===undefined?undefined:tags.split(/\s+/).filter(Boolean),mediaSupplied:false};
    });
  }
  function selectedCards(){return selection.type==='apkg'?selection.cards:textCards();}
  function showPreview(saved={}){
    const state=adapter.state(),sourceCards=selectedCards();
    const suggestedName=sourceCards[0]?.deckName||selection.file.name.replace(/\.[^.]+$/,'');
    const matched=state.decks.find(d=>d.name.normalize('NFC').toLocaleLowerCase()===suggestedName.normalize('NFC').toLocaleLowerCase());
    const target=saved.target||matched?.id||'__new__';
    const map=selection.type==='text'?`<h3 class="import-subheading">${esc(t('columnMapping'))}</h3><p class="settings-description">${esc(t('fieldMappingHint'))}</p><div class="import-options">${columnSelect('front','frontColumn',selection.mapping.front)}${columnSelect('back','backColumn',selection.mapping.back)}</div><details class="import-advanced"><summary>${esc(t('advancedImportOptions'))}</summary><div class="import-options"><div class="field"><label for="import-separator">${esc(t('separator'))}</label><select id="import-separator"><option value="auto">${esc(t('autoDetect'))}</option><option value="tab">${esc(t('tabSeparator'))}</option><option value="comma">${esc(t('commaSeparator'))}</option><option value="semicolon">${esc(t('semicolonSeparator'))}</option></select></div><div class="field"><label for="import-header">${esc(t('headerRow'))}</label><select id="import-header"><option value="auto">${esc(t('autoDetect'))}</option><option value="present">${esc(t('yes'))}</option><option value="none">${esc(t('no'))}</option></select></div>${columnSelect('definition','definitionColumn',selection.mapping.definition,true)}${columnSelect('deck','deckColumn',selection.mapping.deck,true)}</div></details>`:'';
    const media=selection.type==='apkg'?`<p class="import-summary">${num(selection.counts.media)} ${esc(t('mediaImported'))}</p>`:'';
    const warnings=selection.type==='apkg'&&selection.warnings.length?`<div class="import-notice">${esc(t('importWarningsSummary'))}</div><p class="settings-description">${esc(t('importImageNote'))}</p>`:`<p class="settings-description">${esc(t('importImageNote'))}</p>`;
    const body=`<form id="file-import-form" data-import-modal><div class="import-form-body"><div class="import-file-summary"><strong dir="auto">${esc(selection.file.name)}</strong><span>${num(sourceCards.length)} ${esc(t('rowsFound'))} · ${selection.type==='apkg'?'APKG':esc(selection.file.name.split('.').pop().toUpperCase())}</span></div>${media}${map}<h3 class="import-subheading">${esc(t('preview'))}</h3><div id="import-samples">${samples(sourceCards)}</div><div class="field"><label for="import-layout">${esc(t('deckLayout'))}</label><select id="import-layout"><option value="single">${esc(t('oneDeck'))}</option><option value="file">${esc(t('keepFileDecks'))}</option></select></div><div id="import-destination"><div class="field"><label for="import-target">${esc(t('destinationDeck'))}</label><select id="import-target">${state.decks.map(d=>`<option value="${esc(d.id)}" ${target===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}<option value="__new__" ${target==='__new__'?'selected':''}>${esc(t('newDeckName'))}</option></select></div><div class="field" id="import-new-deck-field" ${target==='__new__'?'':'hidden'}><label for="import-new-deck">${esc(t('newDeckName'))}</label><input id="import-new-deck" maxlength="100" value="${esc(saved.name||suggestedName)}" dir="auto"></div></div><div class="field"><label for="import-mode">${esc(t('importMode'))}</label><select id="import-mode"><option value="merge">${esc(t('mergeMatching'))}</option><option value="skip">${esc(t('keepExisting'))}</option></select></div><p class="settings-description" style="margin-top:13px">${esc(t('duplicateFileNote'))}</p>${warnings}<p id="file-import-error" class="form-error" role="alert"></p></div><div class="modal-actions"><button type="button" class="btn secondary" data-action="close-modal">${esc(t('cancel'))}</button><button type="submit" class="btn">${esc(t('importAction'))}</button></div></form>`;
    adapter.openModal(t('importPreview'),body,'file-import');
    if(selection.type==='text'){$('#import-separator').value=selection.separator;$('#import-header').value=selection.header;}
    if(saved.layout)$('#import-layout').value=saved.layout;
    if(saved.mode)$('#import-mode').value=saved.mode;
    $('#import-destination').hidden=$('#import-layout').value==='file';
  }
  function sampleCard(card){
    const short=value=>String(value||'').slice(0,2000);
    const frontImage=card.frontImages?.[0],backImage=card.backImages?.[0]||card.image;
    return `<div class="import-sample"><div dir="auto"><small>${esc(t('frontColumn'))}</small><p>${esc(short(card.front)||t('image'))}</p>${frontImage?`<img src="media/${encodeURIComponent(frontImage)}" alt="" loading="lazy">`:''}</div><div dir="auto"><small>${esc(t('backColumn'))}</small><p>${esc(short(card.back)||t('image'))}</p>${card.definition?`<p class="muted" dir="ltr">${esc(short(card.definition))}</p>`:''}${backImage?`<img src="media/${encodeURIComponent(backImage)}" alt="" loading="lazy">`:''}</div></div>`;
  }
  function samples(cards){
    if(!cards.length)return '';
    return sampleCard(cards[0])+(cards.length>1?`<details class="import-advanced"><summary>${esc(t('morePreviewCards'))}</summary>${cards.slice(1,3).map(sampleCard).join('')}</details>`:'');
  }
  function currentOptions(){return {target:$('#import-target')?.value,name:$('#import-new-deck')?.value,layout:$('#import-layout')?.value,mode:$('#import-mode')?.value};}
  function reparse(){
    const saved=currentOptions();
    selection.separator=$('#import-separator').value;selection.header=$('#import-header').value;
    try{selection.parsed=window.BIR_TEXT_IMPORT.parse(selection.text,{filename:selection.file.name,separator:selection.separator,header:selection.header});selection.mapping={...selection.parsed.suggested};showPreview(saved);}catch(error){$('#file-import-error').textContent=errorText(error);}
  }
  function init(value){
    adapter=value;
    document.addEventListener('change',event=>{
      if(event.target.id==='flashcard-file')readFile(event.target.files[0]);
      if(event.target.dataset.importColumn){selection.mapping[event.target.dataset.importColumn]=Number(event.target.value);$('#import-samples').innerHTML=samples(textCards());}
      if(event.target.id==='import-separator'||event.target.id==='import-header')reparse();
      if(event.target.id==='import-target')$('#import-new-deck-field').hidden=event.target.value!=='__new__';
      if(event.target.id==='import-layout')$('#import-destination').hidden=event.target.value==='file';
    });
    document.addEventListener('submit',event=>{
      if(event.target.id!=='file-import-form')return;
      event.preventDefault();const error=$('#file-import-error');error.textContent='';
      if(selection.type==='text'&&(selection.mapping.front<0||selection.mapping.back<0||selection.mapping.front===selection.mapping.back)){error.textContent=t('selectDifferentColumns');return;}
      const options=currentOptions();if(options.layout==='single'&&options.target==='__new__'&&!options.name.trim()){error.textContent=t('newDeckName');return;}
      try{
        const cards=selectedCards();
        if(!cards.some(c=>(c.front.trim()||(c.frontImages||[]).length)&&(c.back.trim()||(c.backImages||[]).length||c.image))){error.textContent=t('noValidCards');return;}
        const counts=adapter.apply(cards,{deckId:options.target==='__new__'?'':options.target,newDeckName:options.name,keepDecks:options.layout==='file',mode:options.mode});
        if(!counts)return;
        selection=null;attempt++;
        adapter.openModal(t('importSuccess'),`<div class="import-result" role="status"><p><strong>${num(counts.added)}</strong> ${esc(t('addedCards'))}</p><p><strong>${num(counts.updated)}</strong> ${esc(t('updatedCards'))}</p><p><strong>${num(counts.skipped)}</strong> ${esc(t('skippedCards'))}</p>${counts.empty?`<p>${num(counts.empty)} ${esc(t('emptyRows'))}</p>`:''}</div><div class="modal-actions"><button class="btn" data-action="close-modal">${esc(adapter.t('done'))}</button></div>`,'file-import');
      }catch(errorValue){error.textContent=errorText(errorValue);}
    });
  }
  window.BIR_FILE_IMPORT={init,open};
})();
