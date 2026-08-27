const state = { contacts: {}, completed: JSON.parse(localStorage.getItem("next-touch-completed") || "{}"), query: "", priority: "all", selected: null, returnFocus: null };
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const iconCheck = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m3 8 3.1 3L13 4.5"/></svg>';
const priorityRank = { High: 0, Medium: 1, Low: 2 };
const verbiageGuideUrl = "https://claude.ai/code/artifact/19d06ea7-3178-46ff-bf4d-13f1dca37906";

function slugFor(c){ return Object.entries(state.contacts).find(([,v]) => v === c)?.[0] || ""; }
function allContacts(){ return Object.entries(state.contacts).map(([id,c]) => ({...c,id})); }
function isDone(id){ return !!state.completed[id]; }
function saveState(){ localStorage.setItem("next-touch-completed", JSON.stringify(state.completed)); }
function showToast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>t.classList.remove("show"),2200); }
function toggleDone(id){
  state.completed[id] = !state.completed[id];
  if(!state.completed[id]) delete state.completed[id];
  saveState(); render();
  showToast(state.completed[id] ? "Next touch complete. Good work." : "Reopened for another pass.");
}
function filtered(){
  const q=state.query.toLowerCase();
  return allContacts().filter(c => (!q || [c.name,c.business,c.signal,c.action].some(v=>String(v||"").toLowerCase().includes(q))) && (state.priority==="all" || (state.priority==="none" ? !c.priority : c.priority===state.priority))).sort((a,b)=>(priorityRank[a.priority]??3)-(priorityRank[b.priority]??3) || Number(isDone(a.id))-Number(isDone(b.id)));
}
function card(c){
  const p=(c.priority||"unmatched").toLowerCase();
  return `<article class="contact-card ${isDone(c.id)?"done":""}" id="c-${esc(c.id)}" data-id="${esc(c.id)}">
    <div class="card-top"><button class="check" data-action="toggle" aria-label="${isDone(c.id)?"Reopen":"Complete"} ${esc(c.name)}">${iconCheck}</button><div class="identity"><a class="contact-name" href="#c-${esc(c.id)}" data-action="open">${esc(c.name)}</a><div class="biz">${esc(c.business)}</div></div><span class="priority ${p}">${esc(c.priority||"Unmatched")}</span></div>
    <p class="reason">${esc(c.action||"Review contact context and choose the next useful touch.")}</p>
    <div class="card-footer"><span class="signal">${c.signal ? esc(c.signal) : "Imported from calendar only"}</span><span>${c.upcoming ? esc(c.upcoming) : "No upcoming date"}</span></div>
    <div class="card-actions"><button class="btn primary" data-action="open">Open contact</button>${c.email?`<a class="btn" href="mailto:${esc(c.email)}">Email</a>`:""}</div>
  </article>`;
}
function renderList(){
  const list=filtered(), groups=[["High","High priority"],["Medium","Medium priority"],["Low","Low priority"],["none","Unmatched records"]];
  $("#resultCount").textContent=`${list.length} shown`;
  $("#contactList").innerHTML=groups.map(([key,label])=>{
    const items=list.filter(c=>key==="none"?!c.priority:c.priority===key);
    if(!items.length)return "";
    return `<div class="section-label">${label}<span>${items.length}</span></div><div class="cards">${items.map(card).join("")}</div>`;
  }).join("") || `<div class="empty"><strong>No contacts match this view.</strong>Try a different name, business, or priority.</div>`;
}
function updateProgress(){
  const all=allContacts(), focus=all.filter(c=>c.priority==="High"||c.priority==="Medium"), done=focus.filter(c=>isDone(c.id)).length, pct=focus.length?Math.round(done/focus.length*100):0;
  $("#completedCount").textContent=done; $("#progressPct").textContent=`${pct}%`;
  const circ=2*Math.PI*27; $("#progressFill").style.strokeDasharray=circ; $("#progressFill").style.strokeDashoffset=circ-(circ*pct/100);
  $("#progressTitle").textContent=pct===100?"Focus list cleared":"Your day is "+(pct?"moving":"open");
  $("#progressCopy").textContent=pct===100?"You finished the high-signal work. Reopen a card if something changed.":`${focus.length-done} high-signal next touch${focus.length-done===1?"":"es"} remain. Local check-offs stay on this device.`;
}
function renderFocus(){
  const first=allContacts().filter(c=>!isDone(c.id)).sort((a,b)=>(priorityRank[a.priority]??3)-(priorityRank[b.priority]??3))[0];
  if(!first){$("#focusTitle").textContent="The board is clear.";$("#focusText").textContent="Everything in the imported focus list is checked off. That is a good place to be.";$("#focusButton").disabled=true;return}
  $("#focusTitle").textContent=`Start with ${first.name}.`;
  $("#focusText").textContent=first.action||"Open the contact and choose the next useful touch.";
  $("#focusButton").disabled=false; $("#focusButton").onclick=()=>openModal(first.id);
}
function activityCount(day){
  return allContacts().filter(c=>{const s=c.lastContact||""; if(day===26)return /today/i.test(s); return new RegExp(`(?:Aug\\s*)${day}\\b`,"i").test(s)}).length;
}
function weeklyMeetingEntries(){
  const entries=[];
  allContacts().forEach(c=>{
    [["upcoming",c.upcoming],["lastContact",c.lastContact]].forEach(([field,text])=>{
      if(!text||!/(\d{1,2}):(\d{2})\s*(AM|PM)/i.test(text))return;
      const day=/^today\b/i.test(text)?26:Number(text.match(/Aug\s+(2[6-8])\b/i)?.[1]);
      if(!day||entries.some(entry=>entry.id===c.id&&entry.day===day))return;
      const timeMatch=text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      let hour=Number(timeMatch[1])%12;if(timeMatch[3].toUpperCase()==="PM")hour+=12;
      const declined=/(declined|cancelled|canceled)/i.test(text);
      entries.push({
        ...c,
        day,
        field,
        text,
        sortTime:hour*60+Number(timeMatch[2]),
        dayLabel:day===26?"Today":day===27?"Thursday":"Friday",
        status:declined?"Declined":day===26?"Today":field==="upcoming"?"Upcoming":"Calendar",
        unmatched:c.tier==="unmatched"||!c.priority
      });
    });
  });
  return entries.sort((a,b)=>a.day-b.day||a.sortTime-b.sortTime);
}
function renderWeek(){
  const days=[20,21,22,23,24,25,26], labels=days.map(day=>new Intl.DateTimeFormat("en",{weekday:"narrow",timeZone:"UTC"}).format(new Date(Date.UTC(2026,7,day)))), counts=days.map(activityCount), max=Math.max(...counts,1);
  $("#weekDays").innerHTML=days.map((d,i)=>`<div class="day ${d===26?"today":""}"><div class="day-name">${labels[i]}</div><div class="day-bar" title="${counts[i]} recorded touch${counts[i]===1?"":"es"}"><i style="width:${Math.max(counts[i]/max*100,counts[i]?12:0)}%"></i></div></div>`).join("");
  $("#activityTotal").textContent=counts.reduce((a,b)=>a+b,0);
  const meetings=weeklyMeetingEntries();
  $("#weekAgenda").innerHTML=meetings.length
    ? `<div class="agenda-title">This week's meetings <span>${meetings.length}</span></div>${meetings.map(c=>`<button class="agenda-item" data-contact="${esc(c.id)}"><span><strong>${esc(c.name)}</strong><small>${esc(c.business||"Business not recorded")}</small><em class="meeting-match ${c.unmatched?"unmatched":""}">${c.unmatched?"Unmatched calendar record":esc(c.priority+" priority contact")}</em></span><span class="agenda-when"><b>${esc(c.dayLabel+" · "+c.text.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/i)[0])}</b><em class="meeting-state ${c.status.toLowerCase()}">${esc(c.status)}</em></span></button>`).join("")}`
    : `<div class="agenda-empty">No meetings are recorded for this week in the imported snapshot.</div>`;
}
function renderMomentum(){
  const cs=allContacts(), high=cs.filter(c=>c.priority==="High"&&!isDone(c.id)).length, upcoming=cs.filter(c=>c.upcoming&&!/none/i.test(c.upcoming)).length, closed=cs.filter(c=>isDone(c.id)).length;
  $("#momentumNotes").innerHTML=`<div class="momentum"><i class="dot"></i><div><strong>${high} high-priority threads in view</strong><p>Keep the close-in work visible before dropping into the wider book.</p></div></div><div class="momentum"><i class="dot"></i><div><strong>${upcoming} dated activity records</strong><p>Dates shown only when they exist in the imported snapshot.</p></div></div><div class="momentum"><i class="dot"></i><div><strong>${closed} local check-off${closed===1?"":"s"} this pass</strong><p>Small completions create the signal to keep going.</p></div></div>`;
}
function render(){ renderList(); updateProgress(); renderFocus(); renderWeek(); renderMomentum(); }
function openModal(id){
  const c=state.contacts[id]; if(!c)return; state.selected=id;
  state.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  $("#modalPriority").textContent=(c.priority||"unmatched")+" contact"; $("#modalTitle").textContent=c.name; $("#modalBiz").textContent=c.business||"Business not recorded";
  $("#modalLast").textContent=c.lastContact||"Not recorded";$("#modalUpcoming").textContent=c.upcoming||"None scheduled";$("#modalAction").textContent=c.action||"No next action recorded.";
  $("#modalNotesWrap").hidden=!c.notes;$("#modalNotes").textContent=c.notes||"";
  $("#modalEmail").textContent=c.email||"No email recorded";
  const coach=c.coach,coachSkip=c.coachSkipNote; $("#coachWrap").hidden=!(coach||coachSkip);
  if(coach){$("#modalSituation").textContent=coach.situation||"";$("#coachLines").innerHTML=(coach.lines||[]).map(line=>`<div class="coach-line"><strong>${esc(line[0])}</strong><p>${esc(line[1])}</p></div>`).join("")}
  else{$("#modalSituation").textContent=coachSkip||"No coachable signal is recorded yet.";$("#coachLines").innerHTML=""}
  const resources=[c.briefUrl&&`<a class="btn primary" target="_blank" rel="noopener" href="${esc(c.briefUrl)}">Open contact brief</a>`,c.readingTapeUrl&&`<a class="btn" target="_blank" rel="noopener" href="${esc(c.readingTapeUrl)}">Open reading tape</a>`,`<a class="btn" target="_blank" rel="noopener" href="${verbiageGuideUrl}">Call Verbiage Field Guide</a>`].filter(Boolean);
  $("#resourcesWrap").hidden=false;$("#resources").innerHTML=resources.join("");
  $("#modalWrap").hidden=false; $("#appShell").inert=true; document.body.style.overflow="hidden";
  requestAnimationFrame(()=>{$("#modalWrap").classList.add("open");$("#modalClose").focus()});
}
function closeModal(){
  if($("#modalWrap").hidden)return;
  $("#modalWrap").classList.remove("open");$("#modalWrap").hidden=true;$("#appShell").inert=false;document.body.style.overflow="";state.selected=null;
  if(state.returnFocus&&document.contains(state.returnFocus))state.returnFocus.focus();
  state.returnFocus=null;
}
function keepFocusInModal(event){
  if(event.key!=="Tab"||$("#modalWrap").hidden)return;
  const focusable=[...$("#modalWrap").querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>!el.closest("[hidden],[inert]"));
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
async function boot(){
  try{const res=await fetch("/data/contacts_data.json"); state.contacts=await res.json(); render();}
  catch(e){$("#contactList").innerHTML='<div class="empty"><strong>Could not load the imported snapshot.</strong>Check that /data/contacts_data.json is available, then refresh.</div>'}
  $("#searchInput").addEventListener("input",e=>{state.query=e.target.value;renderList()});
  $("#priorityFilter").addEventListener("change",e=>{state.priority=e.target.value;renderList()});
  $("#contactList").addEventListener("click",e=>{const card=e.target.closest("[data-id]");if(!card)return;const id=card.dataset.id;if(e.target.closest('[data-action="toggle"]'))toggleDone(id);else if(e.target.closest('[data-action="open"]')){e.preventDefault();history.replaceState(null,"",`#c-${id}`);openModal(id)}});
  $("#weekAgenda").addEventListener("click",e=>{const item=e.target.closest("[data-contact]");if(item)openModal(item.dataset.contact)});
  $("#modalClose").addEventListener("click",closeModal);$("#modalWrap").addEventListener("click",e=>{if(e.target.id==="modalWrap")closeModal()});document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();keepFocusInModal(e)});
  const openHashContact=()=>{const match=location.hash.match(/^#c-([a-z0-9-]+)$/i);if(match&&state.contacts[match[1]])openModal(match[1])};
  window.addEventListener("hashchange",openHashContact);openHashContact();
}
boot();