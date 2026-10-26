(function(root){
  'use strict';
  function copy(value){return JSON.parse(JSON.stringify(value));}
  const normalized=value=>String(value??'').normalize('NFC').trim();
  const fieldKey=value=>normalized(value).toLocaleLowerCase();
  const identity=(deckId,front,images=[])=>`${deckId}\u001f${fieldKey(front)||'media:'+JSON.stringify(images)}`;
  function merge(previous,incoming,options){
    const state=copy(previous), counts={added:0,updated:0,skipped:0,empty:0};
    const bySource=new Map(),byFront=new Map(),deckByName=new Map(state.decks.map(d=>[fieldKey(d.name),d]));
    for(const card of state.cards){
      if(card.sourceKey)bySource.set(card.sourceKey,card);
      else if(!card.id.startsWith('import:'))bySource.set(`anki:${card.id}:0`,card);
      byFront.set(identity(card.deckId,card.front,card.frontImages),card);
    }
    let fallback=state.decks.find(d=>d.id===options.deckId);
    function ensureDeck(name){
      const key=fieldKey(name||options.newDeckName||'Imported');
      if(deckByName.has(key))return deckByName.get(key);
      const deck={id:`deck-${crypto.randomUUID()}`,name:normalized(name||options.newDeckName||'Imported')};
      state.decks.push(deck);deckByName.set(key,deck);return deck;
    }
    for(const row of incoming){
      const front=normalized(row.front),back=normalized(row.back);
      const frontImages=Array.isArray(row.frontImages)?[...new Set(row.frontImages)]:[];
      const backImages=Array.isArray(row.backImages)?[...new Set(row.backImages)]:[];
      if((!front&&!frontImages.length)||(!back&&!backImages.length&&!row.image)){counts.empty++;continue;}
      const target=options.keepDecks?ensureDeck(row.deckName):(fallback||=ensureDeck(options.newDeckName));
      const sourceKey=typeof row.sourceKey==='string'?row.sourceKey:'';
      const frontIdentity=identity(target.id,front,frontImages);
      const existing=sourceKey?bySource.get(sourceKey):byFront.get(frontIdentity);
      if(existing && options.mode==='skip'){counts.skipped++;continue;}
      const content={deckId:target.id,front,back};
      if(row.definition!==undefined)content.definition=normalized(row.definition);
      if(row.mediaSupplied){
        content.image=row.image||'';content.imageCaption=normalized(row.imageCaption);
        content.frontImages=frontImages;content.backImages=backImages;
      }
      if(sourceKey)content.sourceKey=sourceKey;
      if(row.guid)content.sourceGuid=row.guid;
      if(Number.isInteger(row.templateOrd))content.templateOrd=row.templateOrd;
      if(Array.isArray(row.tags))content.tags=row.tags.map(String);
      if(existing){
        const changed=Object.keys(content).some(key=>JSON.stringify(existing[key])!==JSON.stringify(content[key]));
        byFront.delete(identity(existing.deckId,existing.front,existing.frontImages));
        Object.assign(existing,content);
        if(changed)counts.updated++;else counts.skipped++;
        byFront.set(frontIdentity,existing);
      }else{
        const card={id:`import:${crypto.randomUUID()}`,definition:'',image:'',imageCaption:'',...content};
        state.cards.push(card);byFront.set(frontIdentity,card);if(sourceKey)bySource.set(sourceKey,card);counts.added++;
      }
    }
    return {state,counts};
  }
  root.BIR_IMPORT_CARDS={merge};
})(typeof window==='undefined'?globalThis:window);
