const state = { contacts: {}, pipeline: null, pipelineTab: "opps", completed: JSON.parse(localStorage.getItem("next-touch-completed") || "{}"), query: "", priority: "all", selected: null, returnFocus: null };
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const iconCheck = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m3 8 3.1 3L13 4.5"/></svg>';
const priorityRank = { High: 0, Medium: 1, Low: 2 };
const stageRank = { "Pending Payment": 0, "Awaiting Decision": 1, Trial: 2, "Demo/Evaluation": 3, "Assessing Needs": 4 };
const apolloRank = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
const verbiageGuideUrl = "https://claude.ai/code/artifact/19d06ea7-3178-46ff-bf4d-13f1dca37906";

function slugFor(c){ return Object.entries(state.contacts).find(([,v]) => v === c)?.[0] || ""; }
function allContacts(){ return Object.entries(state.contacts).map(([id,c]) => ({...c,id})); }
function isDone(id){ return !!state.completed[id]; }
function saveState(){ localStorage.setItem("next-touch-completed", JSON.stringify(state.completed)); }
function showToast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>t.classList.remove("show"),2200); }
function normalizeBiz(value){ return String(value||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function pipelineLeads(){ return state.pipeline?.leads || []; }
function pipelineOpps(){
  const raw=state.pipeline?.opportunities||[], scope=state.pipeline?.metadata?.scope;
  if(!scope)return [];
  const stages=new Set(scope.stages||[]);
  return raw.filter(opp=>opp.owner===scope.owner&&stages.has(opp.stage));
}
function isPipelineStale(){
  const meta=state.pipeline?.metadata;if(!meta)return true;
  const ageHours=(Date.now()-new Date(meta.checkedAt).valueOf())/36e5;
  return !!meta.stale||Number.isNaN(ageHours)||ageHours>Number(meta.staleAfterHours||24);
}
function apolloFor(c){ return c.email && state.pipeline?.apollo?.contactSignals?.[c.email.toLowerCase()] || null; }
function pipelineFor(c){
  if(!state.pipeline)return { lead:null, opp:null };
  const lead=pipelineLeads().find(item=>c.email && item.email?.toLowerCase()===c.email.toLowerCase()) ||
    pipelineLeads().find(item=>normalizeBiz(item.name)===normalizeBiz(c.name) && normalizeBiz(item.company)===normalizeBiz(c.business));
  const opp=pipelineOpps().find(item=>normalizeBiz(item.account)===normalizeBiz(c.business));
  return { lead, opp };
}
function priorityScore(c){
  const { opp }=pipelineFor(c), apollo=apolloFor(c);
  const apolloScore=apollo ? apolloRank[apollo.tier]*100 : 600;
  const stageScore=opp ? (stageRank[opp.stage]??5)*10 : 50;
  return apolloScore+stageScore+(priorityRank[c.priority]??3);
}
function pipelineExplanation(c){
  const { lead, opp }=pipelineFor(c), apollo=apolloFor(c), parts=[];
  if(apollo){
    const meaning=state.pipeline.apollo.tiers?.[apollo.tier]?.meaning || "documented Apollo priority signal";
    parts.push(`Apollo Tier ${apollo.tier}: ${meaning}`);
  }
  if(opp)parts.push(`Salesforce opportunity is in ${opp.stage}`);
  if(lead)parts.push(`Salesforce lead is ${lead.status}`);
  if(!parts.length)parts.push("No Salesforce or Apollo match was captured for this contact");
  return parts.join(" · ")+(isPipelineStale()?" Snapshot is stale, so verify before acting.":"");
}
function sourceBadge(label,value,kind=""){ return `<span class="source-badge ${kind}">${esc(label)}: ${esc(value)}</span>`; }
function toggleDone(id){
  state.completed[id] = !state.completed[id];
  if(!state.completed[id]) delete state.completed[id];
  saveState(); render();
  showToast(state.completed[id] ? "Next touch complete. Good work." : "Reopened for another pass.");
}
function filtered(){
  const q=state.query.toLowerCase();
  return allContacts().filter(c => (!q || [c.name,c.business,c.signal,c.action].some(v=>String(v||"").toLowerCase().includes(q))) && (state.priority==="all" || (state.priority==="none" ? !c.priority : c.priority===state.priority))).sort((a,b)=>priorityScore(a)-priorityScore(b) || Number(isDone(a.id))-Number(isDone(b.id)));
}
function card(c){
  const p=(c.priority||"unmatched").toLowerCase();
  const { lead, opp }=pipelineFor(c), apollo=apolloFor(c);
  const sourceBadges=[
    opp&&sourceBadge("Salesforce",opp.stage,"salesforce"),
    lead&&sourceBadge("Lead",lead.status,"salesforce"),
    apollo&&sourceBadge("Apollo",`Tier ${apollo.tier}`,"apollo")
  ].filter(Boolean).join("");
  return `<article class="contact-card ${isDone(c.id)?"done":""}" id="c-${esc(c.id)}" data-id="${esc(c.id)}">
    <div class="card-top"><button class="check" data-action="toggle" aria-label="${isDone(c.id)?"Reopen":"Complete"} ${esc(c.name)}">${iconCheck}</button><div class="identity"><a class="contact-name" href="#c-${esc(c.id)}" data-action="open">${esc(c.name)}</a><div class="biz">${esc(c.business)}</div></div><span class="priority ${p}">${esc(c.priority||"Unmatched")}</span></div>
    <p class="reason">${esc(c.action||"Review contact context and choose the next useful touch.")}</p>
    <div class="pipeline-reason"><span>WHY THE RANK</span>${esc(pipelineExplanation(c))}</div>
    <div class="card-footer"><span class="signal">${c.signal ? esc(c.signal) : "Imported from calendar only"}</span><span>${c.upcoming ? esc(c.upcoming) : "No upcoming date"}</span></div>
    <div class="source-badges">${sourceBadges||sourceBadge("Pipeline","No match captured","muted")}</div>
    <div class="card-actions"><button class="btn primary" data-action="open">Open contact</button>${c.email?`<a class="btn" href="mailto:${esc(c.email)}">Email</a>`:""}</div>
  </article>`;
}
function renderList(){
  const list=filtered();
  $("#resultCount").textContent=`${list.length} shown`;
  $("#contactList").innerHTML=list.length
    ? `<div class="section-label">Ranked by pipeline signals <span>Apollo A→F · Salesforce stage · contact priority</span></div><div class="cards">${list.map(card).join("")}</div>`
    : `<div class="empty"><strong>No contacts match this view.</strong>Try a different name, business, or priority.</div>`;
}
function updateProgress(){
  const all=allContacts(), focus=all.filter(c=>c.priority==="High"||c.priority==="Medium"), done=focus.filter(c=>isDone(c.id)).length, pct=focus.length?Math.round(done/focus.length*100):0;
  $("#completedCount").textContent=done; $("#progressPct").textContent=`${pct}%`;
  const circ=2*Math.PI*27; $("#progressFill").style.strokeDasharray=circ; $("#progressFill").style.strokeDashoffset=circ-(circ*pct/100);
  $("#progressTitle").textContent=pct===100?"Focus list cleared":"Your day is "+(pct?"moving":"open");
  $("#progressCopy").textContent=pct===100?"You finished the high-signal work. Reopen a card if something changed.":`${focus.length-done} high-signal next touch${focus.length-done===1?"":"es"} remain. Local check-offs stay on this device.`;
}
function renderFocus(){
  const first=allContacts().filter(c=>!isDone(c.id)).sort((a,b)=>priorityScore(a)-priorityScore(b))[0];
  if(!first){$("#focusTitle").textContent="The board is clear.";$("#focusText").textContent="Everything in the imported focus list is checked off. That is a good place to be.";$("#focusButton").disabled=true;return}
  $("#focusTitle").textContent=`Start with ${first.name}.`;
  $("#focusText").textContent=first.action||"Open the contact and choose the next useful touch.";
  $("#focusButton").disabled=false; $("#focusButton").onclick=()=>openModal(first.id);
}
function relevantLeads(){
  const cutoff=new Date("2026-08-01T00:00:00");
  return pipelineLeads().filter(lead=>{
    const status=String(lead.status||"").toLowerCase();
    const created=new Date(lead.created);
    return lead.owner==="adam.rus" && !["converted","lost","nurture"].includes(status) && !Number.isNaN(created.valueOf()) && created>=cutoff;
  });
}
function recordLink(record,label){
  return record.link
    ? `<a class="record-link" target="_blank" rel="noopener" href="${esc(record.link)}">${esc(label)} ↗</a>`
    : `<span class="missing-data" title="The source row did not include a hyperlink">Link not captured</span>`;
}
function contactIdForRecord(record){
  const match=allContacts().find(c=>(record.email&&c.email&&record.email.toLowerCase()===c.email.toLowerCase()) || normalizeBiz(record.company||record.account)===normalizeBiz(c.business));
  return match?.id||"";
}
function renderPipelineView(){
  const target=$("#pipelineView"); if(!target)return;
  if(!state.pipeline){target.innerHTML='<div class="pipeline-empty"><strong>Pipeline data unavailable.</strong>The local source could not be loaded; no CRM fallback is being used.</div>';return}
  if(state.pipelineTab==="leads"){
    const leads=relevantLeads();
    target.innerHTML=leads.length?`<div class="pipeline-table-wrap"><table class="pipeline-table"><thead><tr><th>Lead</th><th>Status</th><th>Created</th><th>Source</th><th></th></tr></thead><tbody>${leads.map(lead=>{
      const contactId=contactIdForRecord(lead);
      return `<tr><td><strong>${esc(lead.name)}</strong><small>${esc(lead.company)}</small></td><td><span class="record-status">${esc(lead.status)}</span></td><td>${esc(lead.created)}</td><td>${esc(lead.source||"Not recorded")}</td><td>${contactId?`<button class="table-action" data-contact="${esc(contactId)}">Open touch</button>`:recordLink(lead,"Salesforce")}</td></tr>`;
    }).join("")}</tbody></table></div><p class="table-note">${leads.length} relevant lead${leads.length===1?"":"s"} shown from ${pipelineLeads().length} Adam-owned records. Converted, Lost, Nurture, and pre-Aug 1 records remain in the source but are hidden by the documented display rule.</p>`:'<div class="pipeline-empty"><strong>No relevant leads in this snapshot.</strong>The display rule excludes converted, lost, nurture, and pre-Aug 1 records.</div>';
  }else{
    const opps=pipelineOpps().slice().sort((a,b)=>(stageRank[a.stage]??9)-(stageRank[b.stage]??9)||String(a.account).localeCompare(String(b.account)));
    target.innerHTML=opps.length?`<div class="pipeline-table-wrap"><table class="pipeline-table"><thead><tr><th>Opportunity / account</th><th>Stage</th><th>Close date</th><th>Last updated</th><th></th></tr></thead><tbody>${opps.map(opp=>{
      const contactId=contactIdForRecord(opp);
      return `<tr><td><strong>${esc(opp.name)}</strong><small>${esc(opp.account)}</small></td><td><span class="stage-pill">${esc(opp.stage)}</span></td><td>${esc(opp.close_date||"No data")}</td><td>${esc(opp.lastUpdatedDate||"No data")}<small class="field-note">${opp.lastUpdatedDate?"":"not captured from source"}</small></td><td>${contactId?`<button class="table-action" data-contact="${esc(contactId)}">Open touch</button>`:recordLink(opp,"Salesforce")}</td></tr>`;
    }).join("")}</tbody></table></div><p class="table-note">${opps.length} open opportunities shown. Owner and stage are constrained to the documented Salesforce report scope; record links and last-updated dates were not present in this snapshot.</p>`:'<div class="pipeline-empty"><strong>No open opportunities captured.</strong>No fallback list is being substituted.</div>';
  }
}
function renderPipeline(){
  const summary=$("#pipelineSummary"), alert=$("#pipelineAlert"), kpis=$("#pipelineKpis"), strip=$("#stageStrip"), changes=$("#pipelineChanges"), rules=$("#apolloRules");
  if(!summary||!alert||!kpis||!strip||!changes||!rules)return;
  if(!state.pipeline){
    summary.textContent="Salesforce and Apollo signals could not be loaded.";
    alert.className="data-alert error";alert.innerHTML="<strong>Unavailable.</strong> The local source failed to load, so no CRM fallback is being used.";
    renderPipelineView();return;
  }
  const meta=state.pipeline.metadata, stale=isPipelineStale();
  const leads=relevantLeads(), knownApollo=Object.keys(state.pipeline.apollo?.contactSignals||{}).length;
  $("#salesforceReport").href=meta.sourceUrl||"#";
  summary.textContent=`${pipelineOpps().length} open opportunities · ${leads.length} relevant leads · priority signals from ${knownApollo} Apollo contacts`;
  alert.className=`data-alert ${stale?"stale":"fresh"}`;
  alert.innerHTML=`<strong>${stale?"Stale snapshot":"Snapshot loaded"}.</strong> Salesforce was last checked ${esc(meta.checkedAtLabel)}. Apollo was last looked up ${esc(state.pipeline.apollo.checkedAtLabel)}. This local dashboard has no live CRM connection, so missing fields are not guessed.`;
  kpis.innerHTML=`<div class="pipeline-kpi"><b>${pipelineOpps().length}</b><span>open opportunities</span></div><div class="pipeline-kpi"><b>${leads.length}<small> / ${pipelineLeads().length}</small></b><span>relevant leads</span></div><div class="pipeline-kpi"><b>${knownApollo}<small> / ${allContacts().length}</small></b><span>Apollo contacts ranked</span></div>`;
  const stages=meta.scope?.stages||Object.keys(stageRank), counts=Object.fromEntries(stages.map(stage=>[stage,pipelineOpps().filter(opp=>opp.stage===stage).length])), max=Math.max(...Object.values(counts),1);
  strip.innerHTML=stages.map(stage=>`<div class="stage-stat"><div><span>${esc(stage)}</span><b>${counts[stage]}</b></div><i><em style="width:${counts[stage]/max*100}%"></em></i></div>`).join("");
  renderPipelineView();
  const newLeads=state.pipeline.changes?.newLeads||[], updated=state.pipeline.changes?.updatedOpportunities||[];
  changes.innerHTML=(newLeads.length||updated.length)
    ? `<div class="change-title">Latest source changes <span>${newLeads.length+updated.length}</span></div>${newLeads.map(lead=>`<div class="change-item new"><b>New lead</b><span>${esc(lead.name||lead.company||"Unnamed lead")} — ${esc(lead.reason||"added to the latest source check")}</span></div>`).join("")}${updated.map(opp=>`<div class="change-item updated"><b>Opportunity changed</b><span>${esc(opp.name||opp.account||"Unnamed opportunity")} — ${esc(opp.reason||opp.detail||"stage or close-date change captured")}</span></div>`).join("")}`
    : `<div class="change-title">Latest source changes <span>0</span></div><div class="change-empty"><strong>No new leads or opportunity changes in the latest check.</strong>The source reported the pipeline unchanged on ${esc(meta.checkedAtLabel)}. A later live check is required to detect movement.</div>`;
  rules.innerHTML=Object.entries(state.pipeline.apollo?.tiers||{}).map(([tier,rule])=>`<div class="apollo-rule"><b>${esc(tier)}</b><span><strong>${esc(rule.sequence)}</strong>${esc(rule.meaning)}</span></div>`).join("");
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
function render(){ renderList(); updateProgress(); renderFocus(); renderWeek(); renderMomentum(); renderPipeline(); }
function openModal(id){
  const c=state.contacts[id]; if(!c)return; state.selected=id;
  state.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  $("#modalPriority").textContent=(c.priority||"unmatched")+" contact"; $("#modalTitle").textContent=c.name; $("#modalBiz").textContent=c.business||"Business not recorded";
  $("#modalLast").textContent=c.lastContact||"Not recorded";$("#modalUpcoming").textContent=c.upcoming||"None scheduled";$("#modalAction").textContent=c.action||"No next action recorded.";
  const relation=pipelineFor(c), apollo=apolloFor(c), pipelineFields=[];
  if(relation.opp)pipelineFields.push(`<div><small>Salesforce opportunity</small><strong>${esc(relation.opp.stage)}</strong><span>${esc(relation.opp.account)}</span></div>`);
  if(relation.lead)pipelineFields.push(`<div><small>Salesforce lead</small><strong>${esc(relation.lead.status)}</strong><span>${esc(relation.lead.created)}</span></div>`);
  if(apollo)pipelineFields.push(`<div><small>Apollo priority</small><strong>Tier ${esc(apollo.tier)}</strong><span>${esc(apollo.sequence)}</span></div>`);
  $("#modalPipelineWrap").hidden=!state.pipeline;$("#modalPipeline").innerHTML=state.pipeline?`${pipelineFields.join("")||'<p class="missing-copy">No Salesforce or Apollo match was captured for this contact.</p>'}<p class="modal-source-note">${esc(pipelineExplanation(c))}</p>`:"";
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
  const [contactsResult,pipelineResult]=await Promise.allSettled([fetch("/data/contacts_data.json"),fetch("/data/pipeline_data.json")]);
  try{if(contactsResult.status!=="fulfilled"||!contactsResult.value.ok)throw new Error("contacts");state.contacts=await contactsResult.value.json();}catch(e){$("#contactList").innerHTML='<div class="empty"><strong>Could not load the imported snapshot.</strong>Check that /data/contacts_data.json is available, then refresh.</div>'}
  try{if(pipelineResult.status!=="fulfilled"||!pipelineResult.value.ok)throw new Error("pipeline");state.pipeline=await pipelineResult.value.json();}catch(e){state.pipeline=null;}
  render();
  $("#searchInput").addEventListener("input",e=>{state.query=e.target.value;renderList()});
  $("#priorityFilter").addEventListener("change",e=>{state.priority=e.target.value;renderList()});
  document.querySelectorAll("[data-pipeline-tab]").forEach(tab=>tab.addEventListener("click",()=>{state.pipelineTab=tab.dataset.pipelineTab;document.querySelectorAll("[data-pipeline-tab]").forEach(item=>{const active=item.dataset.pipelineTab===state.pipelineTab;item.classList.toggle("active",active);item.setAttribute("aria-selected",String(active))});renderPipelineView()}));
  $("#contactList").addEventListener("click",e=>{const card=e.target.closest("[data-id]");if(!card)return;const id=card.dataset.id;if(e.target.closest('[data-action="toggle"]'))toggleDone(id);else if(e.target.closest('[data-action="open"]')){e.preventDefault();history.replaceState(null,"",`#c-${id}`);openModal(id)}});
  $("#pipelineView").addEventListener("click",e=>{const button=e.target.closest("[data-contact]");if(button){history.replaceState(null,"",`#c-${button.dataset.contact}`);openModal(button.dataset.contact)}});
  $("#weekAgenda").addEventListener("click",e=>{const item=e.target.closest("[data-contact]");if(item)openModal(item.dataset.contact)});
  $("#modalClose").addEventListener("click",closeModal);$("#modalWrap").addEventListener("click",e=>{if(e.target.id==="modalWrap")closeModal()});document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();keepFocusInModal(e)});
  const openHashContact=()=>{const match=location.hash.match(/^#c-([a-z0-9-]+)$/i);if(match&&state.contacts[match[1]])openModal(match[1])};
  window.addEventListener("hashchange",openHashContact);openHashContact();
}
boot();