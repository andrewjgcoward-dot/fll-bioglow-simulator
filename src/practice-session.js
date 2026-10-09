// Transactional workspace switching. Normal autosave stays untouched throughout
// practice; a failed editor load restores the visible snapshot and prior mode.
export function createPracticeSession({capture,install,makeDraft,readDraft=()=>null,writeDraft=()=>{},changed=()=>{}}) {
  let active=null,original=null,transitioning=false;const drafts=new Map();
  const remember=()=>{if(!active||transitioning)return;const data=capture();drafts.set(active,structuredClone(data));try{writeDraft(active,data);}catch{/* in-memory draft remains usable */}};
  function switchTo(id) {
    if(transitioning||id===active)return;
    const before=capture(),prior=active;
    if(prior)remember();
    const candidate=id?(drafts.get(id)||readDraft(id)||makeDraft(id)):original;
    if(!candidate)return;
    transitioning=true;
    try {
      if(!prior)original=structuredClone(before);
      active=id;install(structuredClone(candidate),id);
      if(!id)original=null;
    } catch(error) {active=prior;install(before,prior);if(!prior)original=null;throw error;}
    finally{transitioning=false;changed(active);}
  }
  return {get active(){return active;},get transitioning(){return transitioning;},enter:switchTo,leave:()=>switchTo(null),remember};
}
