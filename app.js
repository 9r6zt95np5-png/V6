
// Auto-format HH:MM:SS while typing in Tempo macchina.
// Supporta anche ore superiori a 99, per esempio 125:30:00.
// Con 6 cifre mantiene il formato classico HHMMSS; dalla settima cifra
// tutte le cifre prima degli ultimi quattro numeri rappresentano le ore.
document.addEventListener("input", (e) => {
  if(!e.target || e.target.id !== "machineHoursInput") return;

  const digits = e.target.value.replace(/\D/g, "");
  let out = digits;

  if(digits.length > 6){
    out = digits.slice(0, -4) + ":" + digits.slice(-4, -2) + ":" + digits.slice(-2);
  } else if(digits.length > 4){
    out = digits.slice(0, 2) + ":" + digits.slice(2, 4) + ":" + digits.slice(4);
  } else if(digits.length > 2){
    out = digits.slice(0, 2) + ":" + digits.slice(2);
  }

  e.target.value = out;
});


function parseMachineTime(v){
  const m = String(v).trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if(!m) return null;

  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);

  if(!Number.isFinite(hours) || hours < 0 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}
function fmtHMS(sec){
  sec=Math.max(0,Math.floor(sec));
  const h=Math.floor(sec/3600), mi=Math.floor((sec%3600)/60), s=sec%60;
  return `${String(h).padStart(2,"0")}:${String(mi).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const STORE = "tablettracking.data.v2";

function legacyState(){
  const candidates = [];
  for(let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i);
    if(/^tablettracking\.v\d+$/i.test(key || "")){
      const score = Number((key.match(/\d+/)||[0])[0]);
      candidates.push({key,score});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  for(const item of candidates){
    try{
      const value = JSON.parse(localStorage.getItem(item.key));
      if(value && Array.isArray(value.machines)) return value;
    }catch{}
  }
  return null;
}

const defaultState = () => ({
  machines: defaultMachines(),
  products: [],
  alerts: [],
  feedback: [],
  shiftEnd: null,
  currentView: "dashboard",
  dashboardMachine: 0
});


function defaultMachines(){
  return [
    {name:"Macchina 1"},
    {name:"Macchina 2"},
    {name:"Macchina 3"},
    {name:"Macchina 4"}
  ];
}

function ensureFourMachines(){
  state.machines ||= defaultMachines();
  for(let i=0;i<4;i++){
    state.machines[i] ||= {name:`Macchina ${i+1}`};
    state.machines[i].name ||= `Macchina ${i+1}`;
  }
  if(state.machines.length < 4){
    while(state.machines.length < 4) state.machines.push({name:`Macchina ${state.machines.length+1}`});
  }
}

let state;
try { state = JSON.parse(localStorage.getItem(STORE)) || legacyState() || defaultState(); }
catch { state = legacyState() || defaultState(); }
ensureFourMachines();
state.products ||= [];
state.alerts ||= [];
state.feedback ||= [];
state.dashboardMachine = Number.isInteger(state.dashboardMachine) ? state.dashboardMachine : 0;
// Pulizia degli eventuali duplicati creati dalle versioni precedenti.
// Per macchina può esserci una sola Uniformità attiva e una sola Uniformità per compresse attiva.
const __seenSpecialAlerts = new Set();
state.alerts = state.alerts.filter(a => {
  if(a.name !== "Uniformità" && a.name !== "Uniformità per compresse") return true;
  const k = `${num(a.machineIndex)}|${a.name}`;
  if(__seenSpecialAlerts.has(k)) return false;
  __seenSpecialAlerts.add(k);
  return true;
});
localStorage.setItem(STORE, JSON.stringify(state));

function save(){ localStorage.setItem(STORE, JSON.stringify(state)); }
function pad(n){ return String(n).padStart(2,"0"); }
function fmtTime(d){ return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function fmtHM(d){ return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDuration(ms){
  if(ms <= 0) return "00:00:00";
  const s = Math.floor(ms/1000);
  return `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;
}
function num(v){ return Number(v || 0); }

function nextShiftDate(hhmm){
  const [h,m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h,m,0,0);
  if(d <= new Date()) d.setDate(d.getDate()+1);
  return d.toISOString();
}

function manualTimeToDate(value){
  const match = String(value || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if(!match) return null;
  const d = new Date();
  d.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return d;
}

function calculateBin(machine){
  const counter = num(machine.counter);
  const rate = num(machine.rate);
  const bin = num(machine.bin);
  const margin = num(machine.margin);
  if(rate <= 0 || bin <= 0 || !machine.lastUpdateAt) return null;

  const nextMultiple = Math.floor(counter / bin + 1) * bin;
  const alertCounter = Math.max(nextMultiple - margin, counter);
  const missing = Math.max(0, alertCounter - counter);
  const baseTime = new Date(machine.lastUpdateAt);
  const ms = missing / rate * 3600000;
  const at = new Date(baseTime.getTime() + ms);
  return {type:"bin", title:`Cambio fusto — ${machine.name || "Macchina"}`, at, nextMultiple, alertCounter, missing, baseTime, totalMs:ms};
}

function buildBinSchedule(machine, limit=20){
  const calc = calculateBin(machine);
  if(!calc) return [];
  const rate = num(machine.rate);
  const bin = num(machine.bin);
  const margin = num(machine.margin);
  const counter = num(machine.counter);
  const out = [];
  for(let i=0;i<limit;i++){
    const target = calc.nextMultiple + bin*i;
    const alertCounter = target - margin;
    const missing = Math.max(0, alertCounter - counter);
    const at = new Date(calc.baseTime.getTime() + missing / rate * 3600000);
    if(state.shiftEnd && at > new Date(state.shiftEnd)) break;
    out.push({target, alertCounter, at});
  }
  return out;
}


function nextRepeatingDate(lastAt, intervalMinutes){
  if(!lastAt || !intervalMinutes) return null;
  const intervalMs = Number(intervalMinutes) * 60000;
  let next = new Date(new Date(lastAt).getTime() + intervalMs);
  while(next <= new Date()){
    next = new Date(next.getTime() + intervalMs);
  }
  return next;
}

function nextAlert(alert){
  const machine = state.machines[alert.machineIndex] || {};
  const titleBase = `${alert.name} — ${machine.name || `Macchina ${num(alert.machineIndex)+1}`}`;

  // Uniformità: calcolo sulle ore macchina, sempre ogni 8 ore macchina.
  // Esempio: ore macchina 14 -> prossima soglia 16 -> mancano 2 ore.
  if(alert.name === "Uniformità" && alert.mode === "machineHours"){
    const current = Number(alert.machineHours || 0);
    if(Number.isNaN(current)) return null;

    const interval = 8;
    const nextThreshold = Math.floor(current / interval + 1) * interval;
    const missingHours = Math.max(0, nextThreshold - current);

    // L'orario dell'uniformità deve essere un EVENTO FISSO.
    // Non deve essere ricalcolato usando Date.now() ad ogni refresh della Dashboard.
    let at = alert.scheduledAt ? new Date(alert.scheduledAt) : null;
    if(!at || isNaN(at.getTime())){
      const base = new Date(alert.updatedAt || Date.now());
      at = new Date(base.getTime() + missingHours * 3600000);
      alert.scheduledAt = at.toISOString();
      save();
    }

    return {
      type:"uniformita",
      title:`Uniformità — ${machine.name || `Macchina ${num(alert.machineIndex)+1}`}`,
      at,
      alert,
      nextThreshold,
      missingHours
    };
  }

  // Uniformità per compresse: calcolo in base al contatore e alla produzione/ora della macchina.
  if(alert.name === "Uniformità per compresse"){
    const machine = state.machines[alert.machineIndex] || {};
    const rate = Number(machine.rate || alert.rate || 0);
    const currentCounter = Number(alert.counter || 0);
    const targetCounter = Number(alert.targetCounter || 0);

    if(rate <= 0 || targetCounter <= currentCounter) return null;

    const missingTablets = targetCounter - currentCounter;
    // Anche questo è un evento singolo: fissiamo l'orario alla prima programmazione.
    let at = alert.scheduledAt ? new Date(alert.scheduledAt) : null;
    if(!at || isNaN(at.getTime())){
      const base = new Date(alert.updatedAt || Date.now());
      at = new Date(base.getTime() + (missingTablets / rate) * 3600000);
      alert.scheduledAt = at.toISOString();
      save();
    }
    const machineName = state.machines[alert.machineIndex]?.name || `Macchina ${Number(alert.machineIndex)+1}`;

    return {
      type:"uniformita",
      title:`Uniformità per compresse — ${machineName}`,
      at,
      alert,
      targetCounter,
      missingTablets
    };
  }

  // Altri avvisi: calcolo classico da ultimo orario fatto + frequenza.
  if(!alert.lastAt || !alert.intervalMinutes) return null;
  const at = nextRepeatingDate(alert.lastAt, alert.intervalMinutes);
  const type = "extra";
  return {type, title:titleBase, at, alert};
}

function allEvents(){
  const events = [];
  // Inserisce TUTTI i cambi fusto futuri, non solo il primo.
  // In questo modo i cambi fusto entrano nella stessa coda delle altre attività.
  state.machines.forEach(m=>{
    if(m.paused) return;
    const schedule = buildBinSchedule(m, 50);
    schedule.forEach(item=>{
      events.push({
        type: "bin",
        title: `Cambio fusto — ${m.name || "Macchina"}`,
        at: item.at,
        target: item.target,
        alertCounter: item.alertCounter
      });
    });
  });
  state.alerts.forEach(a=>{
    const ev = nextAlert(a);
    if(ev) events.push(ev);
  });
  return events.filter(e=>e && e.at instanceof Date && !isNaN(e.at.getTime()))
    .sort((a,b)=>a.at-b.at);
}

function fillProducts(){
  $$(".product-picker").forEach(picker=>{
    const sel = $(".productSelect", picker);
    const search = $(".productSearch", picker);
    const options = $(".product-options", picker);
    if(!sel || !search || !options) return;

    const current = sel.value;
    const selected = current !== "" ? state.products[num(current)] : null;
    if(selected) search.value = selected.name;

    const renderOptions = (query="") => {
      const q = String(query || "").trim().toLocaleLowerCase("it-IT");
      const matches = state.products.map((prod,i)=>({prod,i})).filter(({prod}) =>
        !q || String(prod.name || "").toLocaleLowerCase("it-IT").includes(q)
      );
      options.innerHTML = matches.length
        ? matches.map(({prod,i})=>`<button type="button" class="product-option" data-product-index="${i}"><strong>${escapeHtml(prod.name)}</strong><span>${num(prod.rate).toLocaleString("it-IT")} comp/h · fusto ${num(prod.bin).toLocaleString("it-IT")}</span></button>`).join("")
        : `<div class="product-options-empty">Nessun prodotto trovato</div>`;
      options.classList.remove("hidden");
    };

    search.oninput = () => renderOptions(search.value);
    search.onfocus = () => renderOptions(search.value);
    search.onkeydown = e => {
      if(e.key === "Escape") options.classList.add("hidden");
    };
    options.onclick = e => {
      const btn = e.target.closest("[data-product-index]");
      if(!btn) return;
      const index = num(btn.dataset.productIndex);
      const prod = state.products[index];
      if(!prod) return;
      sel.value = String(index);
      search.value = prod.name;
      options.classList.add("hidden");
      sel.dispatchEvent(new Event("change", {bubbles:true}));
    };
    if(current !== "") sel.value = current;
    options.classList.add("hidden");
  });
}

function escapeHtml(str){
  return String(str ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}


function machineDisplayName(index){
  return state.machines[index]?.name || `Macchina ${Number(index)+1}`;
}

function refreshMachineNameSelects(){
  const productMachine = $("#productMachine");
  if(productMachine){
    const current = productMachine.value || "0";
    productMachine.innerHTML = [0,1,2,3].map(i => `<option value="${i}">${machineDisplayName(i)}</option>`).join("");
    productMachine.value = current;
  }

  const alertMachine = $("#alertMachine");
  if(alertMachine){
    const current = alertMachine.value || "0";
    alertMachine.innerHTML = [0,1,2,3].map(i => `<option value="${i}">${machineDisplayName(i)}</option>`).join("");
    alertMachine.value = current;
  }

  $$(".machine-jump").forEach(btn => {
    const i = Number(btn.dataset.targetMachine);
    const name = machineDisplayName(i);
    btn.textContent = name.length > 12 ? name.slice(0, 11) + "…" : name;
  });
}

function hydrate(){
  fillProducts();
  $("#shiftEndDisplay").value = state.shiftEnd ? fmtTime(new Date(state.shiftEnd)) : "";
  $$(".machine").forEach(card=>{
    const i = num(card.dataset.machine);
    const m = state.machines[i] || {};
    $(".machine-name", card).value = m.name || `Macchina ${i+1}`;
    $(".counter", card).value = m.counter ?? "";
    $(".rate", card).value = m.rate ?? "";
    $(".bin", card).value = m.bin ?? "";
    $(".margin", card).value = m.margin ?? 0;
    const productSelect = $(".productSelect", card);
    const productSearch = $(".productSearch", card);
    if(productSelect && m.productIndex !== null && m.productIndex !== undefined){
      productSelect.value = String(m.productIndex);
      if(productSearch) productSearch.value = state.products[m.productIndex]?.name || m.productName || "";
    } else if(productSearch) {
      productSearch.value = m.productName || "";
    }
    $(".pauseMachine", card).textContent = m.paused ? "Riprendi" : "Macchina ferma";
  });
  refreshMachineNameSelects();
  renderProducts();
  renderAlerts();
  renderFeedback();
}

function readFields(card){
  const productSelect = $(".productSelect", card);
  const productIndex = productSelect && productSelect.value !== "" ? num(productSelect.value) : null;
  const productName = productIndex !== null ? (state.products[productIndex]?.name || productSelect?.selectedOptions?.[0]?.textContent || "") : "";
  return {
    name: $(".machine-name",card).value || `Macchina ${num(card.dataset.machine)+1}`,
    counter: num($(".counter",card).value),
    rate: num($(".rate",card).value),
    bin: num($(".bin",card).value),
    margin: num($(".margin",card).value),
    productIndex,
    productName
  };
}


function chooseStartMode(){
  return Promise.resolve("now");
}

async function startMachine(card){
  const start = new Date();
  const data = readFields(card);
  if(data.rate <= 0 || data.bin <= 0){ alert("Inserisci produzione/ora e capacità fusto."); return; }

  const i = num(card.dataset.machine);
  state.machines[i] = {...(state.machines[i]||{}), ...data, lastUpdateAt:start.toISOString(), paused:false};
  save();
  hydrate();
  render();
}

function updateCounter(card, reason="aggiornamento"){
  const i = num(card.dataset.machine);
  const m = state.machines[i] || {};
  const old = num(m.counter);
  const valueRaw = prompt(`Inserisci il contatore reale (${reason}):`, old || "");
  if(valueRaw === null) return false;
  const value = Number(valueRaw);
  if(Number.isNaN(value)){ alert("Contatore non valido."); return false; }
  if(value < old && !confirm("Il nuovo contatore è inferiore al precedente. Confermi?")) return false;

  $(".counter", card).value = value;
  const data = readFields(card);
  state.machines[i] = {...m, ...data, counter:value, lastUpdateAt:new Date().toISOString(), paused:false};
  save();
  hydrate();
  render();
  return true;
}

function render(){
  const events = allEvents();
  const top = events[0];
  $("#priorityCard").classList.remove("uniformita","extra","badSoon");
  if(top){
    $("#priorityTitle").textContent = top.title;
    $("#priorityCountdown").textContent = fmtDuration(top.at - new Date());
    $("#priorityTime").textContent = `Ora: ${fmtTime(top.at)}`;
    if(top.type) $("#priorityCard").classList.add(top.type);
  } else {
    $("#priorityTitle").textContent = "Configura il turno";
    $("#priorityCountdown").textContent = "--:--:--";
    $("#priorityTime").textContent = "Ora: --";
  }

  $$(".machine").forEach(card=>{
    const i = num(card.dataset.machine);
    const m = state.machines[i] || {};
    const calc = calculateBin(m);
    card.classList.toggle("paused", !!m.paused);
    card.classList.remove("warn","bad");
    $(".machine-status",card).textContent = m.paused ? "Ferma" : (calc ? "In produzione" : "Non avviata");

    if(!calc || m.paused){
      $(".countdown",card).textContent = m.paused ? "FERMA" : "--:--:--";
      $(".changeTime",card).textContent = "Ora: --";
      $(".changeCounter",card).textContent = "Contatore: --";
      $(".bar i",card).style.width = "0%";
      $(".schedule",card).innerHTML = "";
    } else {
      const remaining = calc.at - new Date();
      $(".countdown",card).textContent = fmtDuration(remaining);
      $(".changeTime",card).textContent = `Ora: ${fmtTime(calc.at)}`;
      $(".changeCounter",card).textContent =
        `Cambio: ${calc.nextMultiple.toLocaleString("it-IT")} · Avviso: ${calc.alertCounter.toLocaleString("it-IT")}`;
      const progress = Number.isFinite(calc.progress) ? calc.progress : 0;
      $(".bar i",card).style.width = `${progress}%`;
      if(remaining <= 2*60000) card.classList.add("bad");
      else if(remaining <= 10*60000) card.classList.add("warn");
      $(".schedule",card).innerHTML = buildBinSchedule(m).map(x=>`<li>${fmtTime(x.at)} — ${x.target.toLocaleString("it-IT")}</li>`).join("");
    }

    const machineAlerts = state.alerts.filter(a=>num(a.machineIndex)===i).map(a=>{
      const ev = nextAlert(a);
      return ev ? `<div class="alert-mini"><b>${escapeHtml(a.name)}</b> · ${fmtDuration(ev.at-new Date())} · ${fmtTime(ev.at)}</div>` : "";
    }).join("");
    $(".machine-alerts",card).innerHTML = machineAlerts;
  });

  renderAlerts(false);
  renderDashboardSummary();
}

function renderProducts(){
  const list = $("#productList");
  if(!list) return;
  if(!state.products.length){ list.innerHTML = "<p class='hint'>Nessun prodotto salvato.</p>"; $("#productCount") && ($("#productCount").textContent = "0"); return; }
  list.innerHTML = state.products.map((p,i)=>`
    <div class="list-item">
      <b>${escapeHtml(p.name)}</b>
      <span>${num(p.rate).toLocaleString("it-IT")}/h · fusto ${num(p.bin).toLocaleString("it-IT")} · margine ${num(p.margin).toLocaleString("it-IT")}</span>
      <div class="row">
        <button class="btn secondary" data-load-product="${i}">Modifica</button>
        <button class="btn ghost danger" data-delete-product="${i}">Elimina</button>
      </div>
    </div>
  `).join("");
  $("#productCount") && ($("#productCount").textContent = state.products.length);
  $$("[data-delete-product]").forEach(b=>b.onclick=()=>{ if(confirm("Eliminare prodotto?")){ state.products.splice(num(b.dataset.deleteProduct),1); save(); fillProducts(); renderProducts(); }});
  $$("[data-load-product]").forEach(b=>b.onclick=()=>{
    const p = state.products[num(b.dataset.loadProduct)];
    $("#productName").value=p.name; $("#productRate").value=p.rate; $("#productBin").value=p.bin; $("#productMargin").value=p.margin||0; $("#productMachine").value=p.preferredMachine??"0";
    state.editProductIndex = num(b.dataset.loadProduct); save();
    alert("Prodotto caricato. Modifica i dati e premi Salva prodotto.");
  });
}

function renderAlerts(updateList=true){
  if(!updateList) return;
  const list = $("#alertList");
  if(!list) return;
  if(!state.alerts.length){ list.innerHTML = "<p class='hint'>Nessun avviso attivo.</p>"; $("#alertCount") && ($("#alertCount").textContent = "0"); return; }

  list.innerHTML = state.alerts.map((a,i)=>{
    const ev = nextAlert(a);
    const machineName = state.machines[a.machineIndex]?.name || machineDisplayName(a.machineIndex);

    if(a.name === "Uniformità" && a.mode === "machineHours"){
      return `<div class="alert-item">
        <b>Uniformità — ${escapeHtml(machineName)}</b>
        <span>Ore macchina attuali: ${Number(a.machineHours || 0).toLocaleString("it-IT")}</span>
        <span>Prossima soglia: ${ev ? ev.nextThreshold.toLocaleString("it-IT") : "--"} ore macchina</span>
        <span>Mancano ${ev ? fmtDuration(ev.at - new Date()) : "--:--:--"} · previsto ${ev ? fmtTime(ev.at) : "--"}</span>
        <div class="uniformity-note">Regola: ogni 8 ore macchina</div>
        <div class="row">
          <button class="btn secondary" data-alert-hours="${i}">Aggiorna ore macchina</button>
          <button class="btn ghost danger" data-alert-delete="${i}">Elimina</button>
        </div>
      </div>`;
    }

    if(a.name === "Uniformità per compresse"){
      return `<div class="alert-item">
        <b>Uniformità per compresse — ${escapeHtml(machineName)}</b>
        <span>Contatore attuale: ${Number(a.counter || 0).toLocaleString("it-IT")}</span>
        <span>Controllo a: ${Number(a.targetCounter || 0).toLocaleString("it-IT")} compresse</span>
        <span>Mancano: ${ev ? Number(ev.missingTablets).toLocaleString("it-IT") : "--"} compresse · previsto ${ev ? fmtTime(ev.at) : "--"}</span>
        <div class="uniformity-note">Calcolo basato sulla produzione/ora della macchina</div>
        <div class="row">
          <button class="btn secondary" data-alert-counter="${i}">Aggiorna contatore</button>
          <button class="btn ghost danger" data-alert-delete="${i}">Elimina</button>
        </div>
      </div>`;
    }

    return `<div class="alert-item">
      <b>${escapeHtml(a.name)} — ${escapeHtml(machineName)}</b>
      <span>Ogni ${(num(a.intervalMinutes)/60).toLocaleString("it-IT")} ore · prossimo ${ev ? fmtTime(ev.at) : "--"}</span>
      <span>Mancano ${ev ? fmtDuration(ev.at - new Date()) : "--:--:--"}</span>
      <div class="row">
        <button class="btn secondary" data-alert-done="${i}">Fatto ora</button>
        <button class="btn ghost danger" data-alert-delete="${i}">Elimina</button>
      </div>
    </div>`;
  }).join("");
  $("#alertCount") && ($("#alertCount").textContent = state.alerts.length);

  $$("[data-alert-done]").forEach(b=>b.onclick=()=>{
    state.alerts[num(b.dataset.alertDone)].lastAt = new Date().toISOString();
    save(); renderAlerts(); render();
  });

  $$("[data-alert-hours]").forEach(b=>b.onclick=()=>{
    const i = num(b.dataset.alertHours);
    const old = state.alerts[i].machineHours ?? "";
    const value = prompt("Inserisci ore macchina attuali, esempio 14 oppure 14.5", old);
    if(value === null) return;
    const hours = Number(String(value).replace(",", "."));
    if(Number.isNaN(hours) || hours < 0){ alert("Ore macchina non valide."); return; }
    state.alerts[i].machineHours = hours;
    state.alerts[i].updatedAt = new Date().toISOString();
    save(); renderAlerts(); render();
  });

  $$("[data-alert-counter]").forEach(b=>b.onclick=()=>{
    const i = num(b.dataset.alertCounter);
    const old = state.alerts[i].counter ?? "";
    const value = prompt("Inserisci contatore attuale", old);
    if(value === null) return;
    const counter = Number(value);
    if(Number.isNaN(counter) || counter < 0){ alert("Contatore non valido."); return; }
    state.alerts[i].counter = counter;
    state.alerts[i].updatedAt = new Date().toISOString();
    save(); renderAlerts(); render();
  });

  $$("[data-alert-delete]").forEach(b=>b.onclick=()=>{
    if(confirm("Eliminare avviso?")){
      state.alerts.splice(num(b.dataset.alertDelete),1);
      save(); renderAlerts(); render();
    }
  });
}

function renderFeedback(){
  const list = $("#feedbackList");
  if(!list) return;
  if(!state.feedback.length){ list.innerHTML = "<p class='hint'>Nessun feedback salvato.</p>"; return; }
  list.innerHTML = state.feedback.map((f,i)=>`<div class="feedback-item"><b>${new Date(f.at).toLocaleString("it-IT")}</b><span>${escapeHtml(f.text)}</span><div class="row"><button class="btn ghost danger" data-feedback-delete="${i}">Elimina</button></div></div>`).join("");
  $$("[data-feedback-delete]").forEach(b=>b.onclick=()=>{ state.feedback.splice(num(b.dataset.feedbackDelete),1); save(); renderFeedback(); });
}

const VIEW_META = {
  dashboard:["Dashboard","Centro di controllo"],
  machines:["Macchine","Gestione operativa"],
  products:["Prodotti","Database produzione"],
  alerts:["Avvisi e controlli","Qualità e controllo"],
  shift:["Turno","Gestione turno"],
  backup:["Backup","Sicurezza dati"],
  settings:["Impostazioni","Personalizzazione"],
  info:["Informazioni","Sistema"]
};

function setView(view){
  if(!VIEW_META[view]) view = "dashboard";
  $$(".view").forEach(section => section.classList.toggle("hidden", section.id !== `${view}View`));
  $$(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  $("#pageTitle").textContent = VIEW_META[view][0];
  $("#pageEyebrow").textContent = VIEW_META[view][1];
  state.currentView = view;
  save();
  document.body.classList.remove("sidebar-open");
  renderAlerts();
  renderFeedback();
  renderDashboardSummary();
  window.scrollTo({top:0,behavior:"smooth"});
}

$$(".tab").forEach(btn=>btn.onclick=()=>setView(btn.dataset.view));
$$("[data-open-view]").forEach(btn=>btn.onclick=()=>setView(btn.dataset.openView));

$$("[data-shift]").forEach(btn=>btn.onclick=()=>{
  state.shiftEnd = nextShiftDate(btn.dataset.shift);
  $("#shiftEndDisplay").value = fmtTime(new Date(state.shiftEnd));
  save();
  render();
  alert(`Fine turno impostata: ${fmtTime(new Date(state.shiftEnd))}`);
});


$("#endShiftBtn").onclick = () => {
  if(!confirm("Terminare il turno? Tutte le macchine verranno svuotate e tutti gli avvisi attivi saranno eliminati. I nomi delle macchine e i prodotti salvati resteranno disponibili.")) return;

  // Svuota completamente le macchine, conservando solo i nomi personalizzati.
  state.machines = [0,1,2,3].map(i => ({
    name: state.machines[i]?.name || `Macchina ${i+1}`
  }));

  // Elimina tutti gli avvisi attivi e azzera la fine turno.
  state.alerts = [];
  state.shiftEnd = null;

  // Azzera anche le selezioni prodotto rimaste visibili nelle schede.
  $$(".productSelect").forEach(select => select.value = "");

  save();
  hydrate();
  render();
  renderAlerts();

  alert("Turno terminato: macchine svuotate e avvisi eliminati.");
};

$$(".startMachine").forEach(btn=>btn.onclick=e=>startMachine(e.target.closest(".machine")));
$$(".updateCounter").forEach(btn=>btn.onclick=e=>updateCounter(e.target.closest(".machine"), "aggiornamento manuale"));
$$(".pauseMachine").forEach(btn=>btn.onclick=e=>{
  const card = e.target.closest(".machine");
  const i = num(card.dataset.machine);
  const m = state.machines[i] ||= {};
  if(!m.paused){
    m.paused = true; save(); hydrate(); render();
  } else {
    updateCounter(card, "ripartenza macchina");
  }
});


$$(".resetMachine").forEach(btn=>{
  btn.onclick = e => {
    const card = e.target.closest(".machine");
    const i = Number(card.dataset.machine);
    const oldName = state.machines[i]?.name || `Macchina ${i+1}`;

    if(!confirm(`Pulire solo ${oldName}? Le altre macchine non verranno modificate.`)) return;

    state.machines[i] = { name: oldName };

    $(".counter",card).value = "";
    $(".rate",card).value = "";
    $(".bin",card).value = "";
    $(".margin",card).value = 0;

    const productSelect = $(".productSelect", card);
    if(productSelect) productSelect.value = "";

    const pauseBtn = $(".pauseMachine", card);
    if(pauseBtn) pauseBtn.textContent = "Macchina ferma";

    save();
    hydrate();
    render();
    alert(`${oldName} pulita.`);
  };
});

$$(".productSelect").forEach(sel=>sel.onchange=e=>{
  const p = state.products[num(e.target.value)];
  if(!p) return;
  const card = e.target.closest(".machine");
  $(".rate",card).value = p.rate;
  $(".bin",card).value = p.bin;
  $(".margin",card).value = p.margin || 0;
  const i = num(card.dataset.machine);
  state.machines[i] = {...(state.machines[i]||{}), ...readFields(card)};
  save();
  renderDashboardSummary();
});

// Ricerca prodotti: chiudi i risultati cliccando fuori dal selettore.
document.addEventListener("click", e=>{
  $$(".product-picker").forEach(picker=>{
    if(!picker.contains(e.target)) $(".product-options", picker)?.classList.add("hidden");
  });
});

$("#saveProductBtn").onclick = () => {
  const p = {
    name: $("#productName").value.trim(),
    rate: num($("#productRate").value),
    bin: num($("#productBin").value),
    margin: num($("#productMargin").value),
    preferredMachine: $("#productMachine").value
  };
  if(!p.name || p.rate<=0 || p.bin<=0){ alert("Inserisci nome prodotto, produzione e capacità fusto."); return; }
  if(Number.isInteger(state.editProductIndex)){
    state.products[state.editProductIndex] = p;
    delete state.editProductIndex;
  } else state.products.push(p);
  save();
  $("#productName").value=""; $("#productRate").value=""; $("#productBin").value=""; $("#productMargin").value=0;
  fillProducts(); renderProducts();
  alert("Prodotto salvato.");
};

$("#lastNowBtn").onclick = () => $("#alertLastTime").value = fmtHM(new Date());

$("#addAlertBtn").onclick = () => {
  const name = $("#alertName").value;
  const machineIndex = num($("#alertMachine").value);

  if(name === "Uniformità"){
    const raw=$("#machineHoursInput").value;
    const machineSeconds=parseMachineTime(raw);
    if(machineSeconds===null){alert("Inserisci il tempo macchina nel formato HHH:MM:SS, per esempio 125:30:00");return;}
    const machineHours=machineSeconds/3600;
    const interval = 8;
    const nextThreshold = Math.floor(machineHours / interval + 1) * interval;
    const missingHours = Math.max(0, nextThreshold - machineHours);
    const createdAt = new Date();
    const scheduledAt = new Date(createdAt.getTime() + missingHours * 3600000);

    state.alerts.push({
      name:"Uniformità",
      machineIndex,
      mode:"machineHours",
      machineHours,
      updatedAt:createdAt.toISOString(),
      scheduledAt:scheduledAt.toISOString()
    });

    save();
    $("#machineHoursInput").value = "";
    renderAlerts();
    render();
    alert("Uniformità aggiunta. Regola: prossimo scaglione multiplo di 8 ore macchina.");
    return;
  }

  if(name === "Uniformità per compresse"){
    const machineIndex = Number($("#alertMachine").value);
    const machine = state.machines[machineIndex] || {};
    const rate = Number(machine.rate || 0);

    if(rate <= 0){
      alert("Prima inserisci la produzione/ora nella macchina scelta, oppure seleziona un prodotto.");
      return;
    }

    const targetCounter = Number($("#uniformityTabletsInput").value);
    let counter = $("#uniformityCounterInput").value === "" ? Number(machine.counter || 0) : Number($("#uniformityCounterInput").value);

    if(!targetCounter || targetCounter <= 0){
      alert("Inserisci il numero di compresse a cui vuoi fare il controllo.");
      return;
    }

    if(Number.isNaN(counter) || counter < 0){
      alert("Contatore attuale non valido.");
      return;
    }

    if(targetCounter <= counter){
      alert("Il numero di compresse del controllo deve essere superiore al contatore attuale.");
      return;
    }

    const createdAt = new Date();
    const missingTablets = targetCounter - counter;
    const scheduledAt = new Date(createdAt.getTime() + (missingTablets / rate) * 3600000);

    state.alerts.push({
      name:"Uniformità per compresse",
      machineIndex,
      targetCounter,
      counter,
      rate,
      updatedAt:createdAt.toISOString(),
      scheduledAt:scheduledAt.toISOString()
    });

    $("#uniformityTabletsInput").value = "";
    $("#uniformityCounterInput").value = "";

    save();
    renderAlerts();
    render();
    alert("Uniformità per compresse aggiunta.");
    return;
  }

  const hours = Number($("#alertHours").value);
  const time = $("#alertLastTime").value;
  if(!name || hours <= 0 || !time){ alert("Inserisci tipo avviso, frequenza e ultimo orario fatto."); return; }
  const last = manualTimeToDate(time);
  if(!last){ alert("Orario ultimo controllo non valido."); return; }
  if(last > new Date()) last.setDate(last.getDate()-1);
  state.alerts.push({name, machineIndex, intervalMinutes: hours*60, lastAt: last.toISOString()});
  save();
  $("#alertLastTime").value="";
  renderAlerts(); render();
  alert("Avviso aggiunto.");
};

function updateAlertFormMode(){
  const selected = $("#alertName").value;
  const isUniformity = selected === "Uniformità";
  const isUniformityTablets = selected === "Uniformità per compresse";
  const isSpecial = isUniformity || isUniformityTablets;

  $("#machineHoursWrap").classList.toggle("hidden", !isUniformity);
  $("#uniformityTabletsWrap")?.classList.toggle("hidden", !isUniformityTablets);
  $("#uniformityCounterWrap")?.classList.toggle("hidden", !isUniformityTablets);

  $("#alertHoursWrap").classList.toggle("hidden", isSpecial);
  $("#alertLastTimeWrap").classList.toggle("hidden", isSpecial);
  $("#lastNowBtn").classList.toggle("hidden", isSpecial);
}

$("#alertName").addEventListener("change", updateAlertFormMode);
updateAlertFormMode();

$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "TabletTracking_backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
};

$("#importFile").onchange = async e => {
  const file = e.target.files[0];
  if(!file) return;
  try{
    const imported = JSON.parse(await file.text());
    if(!confirm("Importare questo backup e sostituire i dati attuali?")) return;
    state = {...defaultState(), ...imported};
    save();
    hydrate(); render();
    alert("Backup importato.");
  }catch(err){ alert("File backup non valido."); }
};

$("#saveFeedbackBtn").onclick = () => {
  const text = $("#feedbackText").value.trim();
  if(!text) return;
  state.feedback.push({text, at:new Date().toISOString()});
  $("#feedbackText").value="";
  save();
  renderFeedback();
};


// Dashboard: swipe or tap to switch machine cards
function setupMachineScroller(){
  const scroller = $("#machinesScroller");
  if(!scroller) return;

  const buttons = $$(".machine-jump");

  buttons.forEach(btn => {
    btn.onclick = () => {
      const index = Number(btn.dataset.targetMachine);
      const card = $(`.machine[data-machine="${index}"]`);
      if(card) card.scrollIntoView({behavior:"smooth", inline:"start", block:"nearest"});
    };
  });

  scroller.addEventListener("scroll", () => {
    const cards = $$(".machine", scroller);
    let activeIndex = 0;
    let best = Infinity;

    cards.forEach(card => {
      const distance = Math.abs(card.getBoundingClientRect().left - scroller.getBoundingClientRect().left);
      if(distance < best){
        best = distance;
        activeIndex = Number(card.dataset.machine);
      }
    });

    buttons.forEach(b => b.classList.toggle("active", Number(b.dataset.targetMachine) === activeIndex));
  }, {passive:true});
}

setupMachineScroller();

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js?v=210").catch(()=>{}));
}


function selectedDashboardMachine(){
  return Math.max(0, Math.min(3, Number(state.dashboardMachine || 0)));
}
function fmtNumber(value){ return Number(value || 0).toLocaleString("it-IT"); }
function renderDashboardSummary(){
  const i = selectedDashboardMachine();
  const machine = state.machines[i] || {};
  const calc = calculateBin(machine);
  const running = !!calc && !machine.paused;
  const status = machine.paused ? "Ferma" : running ? "In produzione" : "Non avviata";
  const product = machine.productName || (machine.productIndex != null ? state.products[machine.productIndex]?.name : "") || "Nessun prodotto selezionato";

  $("#dashMachineName").textContent = machine.name || `Macchina ${i+1}`;
  $("#dashProduct").textContent = product;
  $("#dashCounter").textContent = fmtNumber(machine.counter);
  $("#dashBin").textContent = fmtNumber(machine.bin);
  $("#dashRate").textContent = fmtNumber(machine.rate);
  $("#dashMargin").textContent = fmtNumber(machine.margin);
  $("#dashMachineStatus").textContent = status;
  $("#dashMachineStatus").className = `status-badge ${machine.paused ? "paused" : running ? "running" : "idle"}`;

  if(calc && !machine.paused){
    $("#dashNextBin").textContent = fmtDuration(calc.at - new Date());
    $("#dashNextBinTime").textContent = `Ora: ${fmtTime(calc.at)}`;
    const progress = Math.round(Number(calc.progress || 0));
    $("#dashProgress").style.width = `${progress}%`;
    $("#dashProgressText").textContent = `${progress}%`;
  }else{
    $("#dashNextBin").textContent = machine.paused ? "FERMA" : "--:--:--";
    $("#dashNextBinTime").textContent = "Ora: --";
    $("#dashProgress").style.width = "0%";
    $("#dashProgressText").textContent = "0%";
  }

  if(machine.lastUpdateAt){
    const elapsed = Math.max(0, Date.now() - new Date(machine.lastUpdateAt).getTime());
    $("#dashMachineTime").textContent = machine.paused ? "FERMA" : fmtDuration(elapsed);
    $("#dashStartTime").textContent = `Avviata alle ${fmtTime(new Date(machine.lastUpdateAt))}`;
  }else{
    $("#dashMachineTime").textContent = "--:--:--";
    $("#dashStartTime").textContent = "Non avviata";
  }

  $$(".dashboard-machine-tab").forEach((btn,index)=>{
    const m = state.machines[index] || {};
    const c = calculateBin(m);
    btn.classList.toggle("active", index===i);
    btn.classList.toggle("running", !!c && !m.paused);
    btn.classList.toggle("paused", !!m.paused);
    $("span",btn).textContent = m.name || `Macchina ${index+1}`;
  });

  // Programma completo di tutte le macchine attualmente in produzione fino a fine turno.
  const scheduleBox = $("#dashMachineSchedule");
  const shiftEnd = state.shiftEnd ? new Date(state.shiftEnd) : null;
  const scheduleEvents = [];
  const now = new Date();

  state.machines.slice(0,4).forEach((machine, machineIndex) => {
    const calc = calculateBin(machine);
    if (!machine.lastUpdateAt || machine.paused || !calc || num(machine.rate) <= 0 || num(machine.bin) <= 0) return;

    const rate = num(machine.rate);
    const bin = num(machine.bin);
    let target = calc.nextMultiple;
    for(let n=0; n<100; n++, target += bin){
      const missing = Math.max(0, target - num(machine.counter));
      const at = new Date(calc.baseTime.getTime() + missing / rate * 3600000);
      if(shiftEnd && at > shiftEnd) break;
      if(at >= now){
        scheduleEvents.push({
          type:"bin",
          title:`Cambio fusto — ${machine.name || `Macchina ${machineIndex+1}`}`,
          at
        });
      }
    }

    // Avvisi associati alla macchina in produzione.
    const seenAlerts = new Set();
    state.alerts.filter(a => num(a.machineIndex) === machineIndex).forEach(a => {
      const alertKey = `${machineIndex}|${a.id || a.name || "avviso"}|${a.mode || ""}|${a.intervalMinutes || 0}|${a.lastAt || ""}|${a.targetCounter || 0}`;
      if(seenAlerts.has(alertKey)) return;
      seenAlerts.add(alertKey);

      let ev = nextAlert(a);
      if(!ev || !ev.at) return;
      let count = 0;
      while(ev && ev.at >= now && (!shiftEnd || ev.at <= shiftEnd) && count < 100){
        scheduleEvents.push({
          type:ev.type || "extra",
          title:`${ev.title || "Avviso"} — ${machine.name || `Macchina ${machineIndex+1}`}`,
          at:new Date(ev.at)
        });
        count++;
        if(a.intervalMinutes){
          ev = {...ev, at:new Date(ev.at.getTime() + Number(a.intervalMinutes)*60000)};
        }else{
          ev = null;
        }
      }
    });
  });

  const uniqueSchedule = new Map();
  scheduleEvents.forEach(ev => {
    const key = `${ev.type || "extra"}|${ev.title}|${Math.floor(ev.at.getTime()/1000)}`;
    if(!uniqueSchedule.has(key)) uniqueSchedule.set(key, ev);
  });
  scheduleEvents.length = 0;
  scheduleEvents.push(...uniqueSchedule.values());
  scheduleEvents.sort((a,b)=>a.at-b.at);
  if(scheduleBox){
    if(!state.shiftEnd){
      scheduleBox.innerHTML = '<div class="schedule-empty">Imposta la fine turno per vedere il programma completo.</div>';
    } else if(!scheduleEvents.length){
      scheduleBox.innerHTML = '<div class="schedule-empty">Nessun cambio fusto o avviso previsto fino a fine turno.</div>';
    } else {
      scheduleBox.innerHTML = scheduleEvents.map(ev => `
        <div class="dashboard-schedule-item ${escapeHtml(ev.type)}">
          <span class="schedule-time">${fmtTime(ev.at)}</span>
          <span class="schedule-title">${escapeHtml(ev.title)}</span>
        </div>`).join("");
    }
  }
  $("#dashShiftPlanEnd").textContent = state.shiftEnd ? `Fine turno: ${fmtTime(new Date(state.shiftEnd))}` : "Fine turno: —";

  $("#alertsBadge").textContent = state.alerts.length;
  $("#alertCount").textContent = state.alerts.length;
  $("#productCount").textContent = state.products.length;
  $("#shiftAlertCount").textContent = state.alerts.length;
  $("#shiftProductCount").textContent = state.products.length;
  const active = state.machines.filter(m=>calculateBin(m) && !m.paused).length;
  $("#shiftActiveMachines").textContent = `${active} / 4`;
  $("#shiftRemaining").textContent = state.shiftEnd ? fmtDuration(new Date(state.shiftEnd)-new Date()) : "--:--:--";
  $("#priorityDescription").textContent = allEvents().length ? "Attività prioritaria calcolata automaticamente." : "Imposta macchine, prodotti e controlli per iniziare.";
  renderIndustrialMachineCards();
}

function renderIndustrialMachineCards(){
  const grid = $("#machineDashboardGrid");
  if(!grid) return;
  const now = new Date();
  const shiftEnd = state.shiftEnd ? new Date(state.shiftEnd) : null;
  const activeEvents = allEvents();
  $("#dashShiftCountdown").textContent = shiftEnd ? fmtDuration(shiftEnd-now) : "--:--:--";
  $("#dashShiftEndTop").textContent = shiftEnd ? `Fine turno: ${fmtTime(shiftEnd)}` : "Fine turno: --";
  $("#dashShiftLabel").textContent = shiftEnd ? ({14:"MATTINA",22:"POMERIGGIO",6:"NOTTE",12:"STRAORDINARIO"}[shiftEnd.getHours()] || "TURNO ATTIVO") : "NON IMPOSTATO";

  const next60 = activeEvents.filter(e => e.at >= now && e.at <= new Date(now.getTime()+60*60000));
  $("#dashUpcomingAlerts").textContent = next60.filter(e => e.type !== "bin").length;
  $("#dashUpcomingBins").textContent = next60.filter(e => e.type === "bin").length;
  const activeMachines = state.machines.slice(0,4).map((m,index)=>({m,index,calc:calculateBin(m)}))
    .filter(({m,calc}) => !!calc && !m.paused);

  if(!activeMachines.length){
    grid.innerHTML = `<div class="dashboard-no-production"><div class="dash-card-icon blue"><svg><use href="#i-machine"/></svg></div><strong>Nessuna macchina in produzione</strong><span>Avvia una macchina dalla sezione Macchine per visualizzarla qui.</span></div>`;
    return;
  }

  grid.innerHTML = activeMachines.map(({m,index,calc})=>{
    const running = true;
    const status = "ATTIVA";
    const product = m.productName || (m.productIndex != null ? state.products[m.productIndex]?.name : "") || "Nessun prodotto";
    const progress = calc ? Math.round(Number(calc.progress || 0)) : 0;
    const nextBin = fmtTime(calc.at);
    const nextBinRemaining = fmtDuration(calc.at-now);
    const alert = state.alerts.filter(a=>num(a.machineIndex)===index).map(a=>nextAlert(a)).filter(e=>e && e.at).sort((a,b)=>a.at-b.at)[0];
    const alertDiff = alert ? alert.at-now : Infinity;
    const alertClass = alertDiff <= 0 ? "due" : alertDiff <= 10*60000 ? "soon" : "";
    return `
      <article class="machine-dash-card running ${alertClass}">
        <div class="machine-dash-head"><h3>${escapeHtml(m.name || `Macchina ${index+1}`)}</h3><span class="machine-dash-status"><i></i>${status}</span></div>
        <div class="machine-dash-body">
          <div class="machine-dash-product"><small>Prodotto</small>${escapeHtml(product)}</div>
          <div class="machine-dash-kpis">
            <div class="machine-dash-kpi"><span>Produzione</span><strong>${fmtNumber(m.rate)}</strong><em>compresse/h</em></div>
            <div class="machine-dash-kpi"><span>Fusto</span><strong>${fmtNumber(m.bin)}</strong><em>capacità compresse</em></div>
          </div>
          <div class="machine-dash-counter"><span>Contatore</span><strong>${fmtNumber(m.counter)}</strong><div class="machine-dash-progress"><i style="width:${Math.max(0,Math.min(100,progress))}%"></i></div></div>
          <div class="machine-dash-next"><span>Prossimo cambio fusto</span><strong>${nextBin}</strong><small>Tra ${nextBinRemaining}</small></div>
          ${alert ? `<div class="machine-dash-alert ${alertClass}"><b>${escapeHtml(alert.title || "Avviso")}</b><span>${fmtTime(alert.at)}</span></div>` : `<div class="machine-dash-alert"><b>Nessun avviso programmato</b><span>—</span></div>`}
        </div>
      </article>`;
  }).join("");
}


$("#mobileMenuBtn").onclick=()=>document.body.classList.toggle("sidebar-open");
$("#sidebarScrim").onclick=()=>document.body.classList.remove("sidebar-open");
$("#endShiftSecondary").onclick=()=>$("#endShiftBtn").click();


hydrate();
render();
setView(state.currentView || "dashboard");
renderDashboardSummary();

// All'apertura dell'app chiedi il turno e imposta automaticamente la fine turno.
function openShiftOnStartup(){
  const modal = $("#shiftStartupModal");
  if(!modal) return;
  modal.classList.remove("hidden");
  $$("[data-startup-shift]").forEach(btn=>{
    btn.onclick = () => {
      state.shiftEnd = nextShiftDate(btn.dataset.startupShift);
      save();
      modal.classList.add("hidden");
      hydrate();
      render();
      renderDashboardSummary();
    };
  });
}
openShiftOnStartup();
setInterval(()=>{ render(); renderAlerts(true); },1000);


document.addEventListener("change", (event) => {
  if(event.target && event.target.classList.contains("machine-name")){
    setTimeout(() => {
      $$(".machine").forEach(card => {
        const i = Number(card.dataset.machine);
        if(state.machines[i]){
          state.machines[i].name = $(".machine-name", card).value || `Macchina ${i+1}`;
        }
      });
      save();
      refreshMachineNameSelects();
      renderAlerts();
      renderProducts();
      render();
    }, 0);
  }
});

document.addEventListener("click",(e)=>{
 const b=e.target.closest(".resetMachine");
 if(!b)return;
 const card=b.closest(".machine");
 if(!card)return;
 if(!confirm("Pulire questa macchina?")) return;
 ["counter","rate","bin","margin"].forEach(c=>{
   const el=card.querySelector("."+c);
   if(el) el.value=(c=="margin"?"0":"");
 });
 const ps=card.querySelector(".productSelect");
 if(ps) ps.value="";
 if(typeof save==="function") save();
 if(typeof render==="function") render();
});


// v2.0 - temi professionali
(function(){
  const THEME_KEY = "tablettracking.theme";
  const classes = ["theme-dark","theme-blue","theme-compact"];
  function applyTheme(theme){
    document.body.classList.remove(...classes);
    if(theme === "dark") document.body.classList.add("theme-dark");
    if(theme === "blue") document.body.classList.add("theme-blue");
    if(theme === "compact") document.body.classList.add("theme-compact");
    $$('[data-theme-choice]').forEach(btn=>btn.classList.toggle('active-theme', btn.dataset.themeChoice===theme));
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.content = theme === "dark" ? "#07111e" : theme === "blue" ? "#06172c" : "#0b5cff";
  }
  function saveTheme(theme){ localStorage.setItem(THEME_KEY,theme); applyTheme(theme); }
  document.addEventListener("DOMContentLoaded",()=>{
    const saved = localStorage.getItem(THEME_KEY) || "light";
    applyTheme(saved);
    $$('[data-theme-choice]').forEach(btn=>btn.onclick=()=>saveTheme(btn.dataset.themeChoice));
  });
  if(document.body) applyTheme(localStorage.getItem(THEME_KEY)||"light");
})();

// v1.3.3 - inserimento forzato pulsante Pulisci su ogni scheda macchina
(function(){
  function clearMachineCard(card){
    const index = Number(card.dataset.machine ?? card.getAttribute("data-machine") ?? 0);
    const oldName =
      (window.state && state.machines && state.machines[index]?.name) ||
      card.querySelector(".machine-name")?.value ||
      `Macchina ${index + 1}`;

    if(!confirm(`Pulire solo ${oldName}? Verranno cancellati contatore attuale, capacità fusto, prodotto, margine sicurezza e produzione oraria.`)){
      return;
    }

    const counter = card.querySelector(".counter");
    const rate = card.querySelector(".rate");
    const bin = card.querySelector(".bin");
    const margin = card.querySelector(".margin");
    const product = card.querySelector(".productSelect");

    if(counter) counter.value = "";
    if(rate) rate.value = "";
    if(bin) bin.value = "";
    if(margin) margin.value = 0;
    if(product) product.value = "";

    if(typeof state !== "undefined" && state.machines && state.machines[index]){
      state.machines[index] = { name: oldName };
    }

    if(typeof save === "function") save();
    if(typeof hydrate === "function") hydrate();
    if(typeof render === "function") render();

    alert(`${oldName} pulita.`);
  }

  function ensureCleanButtons(){
    document.querySelectorAll(".machine").forEach(card => {
      if(card.querySelector(".forceCleanMachine")) return;

      const updateBtn = card.querySelector(".updateCounter");
      if(!updateBtn) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "forceCleanMachine btn danger";
      btn.textContent = "Pulisci";

      updateBtn.insertAdjacentElement("afterend", btn);
      btn.addEventListener("click", () => clearMachineCard(card));
    });
  }

  document.addEventListener("DOMContentLoaded", ensureCleanButtons);
  document.addEventListener("click", () => setTimeout(ensureCleanButtons, 50));
  setInterval(ensureCleanButtons, 1000);
})();



// v1.3.5 - correzione timer: quando arriva a zero passa al prossimo fusto/avviso
(function(){
  window.TabletTrackingAutoNextPatch = true;

  // Override calculateBin if global function exists
  if(typeof calculateBin === "function"){
    calculateBin = function(machine){
      const counter = Number(machine.counter || 0);
      const rate = Number(machine.rate || 0);
      const bin = Number(machine.bin || 0);
      const margin = Number(machine.margin || 0);

      if(rate <= 0 || bin <= 0 || !machine.lastUpdateAt) return null;

      const baseTime = new Date(machine.lastUpdateAt);
      const elapsedHours = Math.max(0, (Date.now() - baseTime.getTime()) / 3600000);
      const estimatedCounter = counter + elapsedHours * rate;

      const nextMultiple = Math.floor(estimatedCounter / bin + 1) * bin;
      const alertCounter = Math.max(nextMultiple - margin, estimatedCounter);
      const missing = Math.max(0, alertCounter - estimatedCounter);
      const at = new Date(Date.now() + (missing / rate) * 3600000);

      const previousMultiple = nextMultiple - bin;
      const cycleStartCounter = Math.max(previousMultiple - margin, counter);
      const cycleTotal = Math.max(1, alertCounter - cycleStartCounter);
      const cycleDone = Math.max(0, estimatedCounter - cycleStartCounter);
      const progress = Math.min(100, Math.max(0, cycleDone / cycleTotal * 100));

      return {
        type:"bin",
        title:`Cambio fusto — ${machine.name || "Macchina"}`,
        at,
        nextMultiple,
        alertCounter,
        missing,
        baseTime,
        totalMs: missing / rate * 3600000,
        estimatedCounter,
        progress
      };
    };
  }

  if(typeof buildBinSchedule === "function"){
    buildBinSchedule = function(machine, limit=20){
      const calc = calculateBin(machine);
      if(!calc) return [];

      const rate = Number(machine.rate || 0);
      const bin = Number(machine.bin || 0);
      const margin = Number(machine.margin || 0);
      const estimatedCounter = Number(calc.estimatedCounter || machine.counter || 0);
      const out = [];

      for(let i=0;i<limit;i++){
        const target = calc.nextMultiple + bin*i;
        const alertCounter = target - margin;
        const missing = Math.max(0, alertCounter - estimatedCounter);
        const at = new Date(Date.now() + missing / rate * 3600000);

        if(typeof state !== "undefined" && state.shiftEnd && at > new Date(state.shiftEnd)) break;
        out.push({target, alertCounter, at});
      }

      return out;
    };
  }

  // Patch del rendering barra: se calc.progress esiste usa quello
  const originalSetInterval = window.setInterval;
  // Non tocchiamo setInterval: render userà calculateBin già corretto.
})();



// v1.3.6 - elimina automaticamente Uniformità quando è scaduta
(function(){
  function autoDeleteExpiredUniformity(){
    if(typeof state === "undefined" || !Array.isArray(state.alerts)) return;
    if(typeof nextAlert !== "function") return;

    const now = Date.now();
    const before = state.alerts.length;

    state.alerts = state.alerts.filter(alert => {
      if(alert.name !== "Uniformità") return true;

      const event = nextAlert(alert);
      if(!event || !event.at) return true;

      // Elimina quando il controllo è arrivato o superato.
      return event.at.getTime() > now;
    });

    if(state.alerts.length !== before){
      if(typeof save === "function") save();
      if(typeof renderAlerts === "function") renderAlerts();
      if(typeof render === "function") render();
    }
  }

  setInterval(autoDeleteExpiredUniformity, 1000);
  document.addEventListener("visibilitychange", autoDeleteExpiredUniformity);
  window.addEventListener("focus", autoDeleteExpiredUniformity);
})();



// v1.3.7 - mostra le 5 prossime attività nel banner principale
(function(){
  function formatSmallTime(date){
    if(typeof fmtTime === "function") return fmtTime(date);
    const p = n => String(n).padStart(2,"0");
    return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  }

  function formatSmallDuration(ms){
    if(typeof fmtDuration === "function") return fmtDuration(ms);
    if(ms <= 0) return "00:00:00";
    const s = Math.floor(ms / 1000);
    const p = n => String(n).padStart(2,"0");
    return `${p(Math.floor(s/3600))}:${p(Math.floor((s%3600)/60))}:${p(s%60)}`;
  }

  function getUpcomingEvents(){
    try{
      if(typeof allEvents === "function"){
        return allEvents();
      }
    }catch{}

    const events = [];

    try{
      if(typeof state !== "undefined" && Array.isArray(state.machines) && typeof calculateBin === "function"){
        state.machines.forEach(machine => {
          if(!machine || machine.paused) return;

          // Inserisce i cambi fusto futuri tra le attività successive,
          // non soltanto il primo cambio previsto per la macchina.
          const rate = Number(machine.rate || 0);
          const bin = Number(machine.bin || 0);
          const counter = Number(machine.counter || 0);
          const start = machine.lastUpdateAt ? new Date(machine.lastUpdateAt) : null;
          if(rate <= 0 || bin <= 0 || !start || isNaN(start.getTime())) return;

          let target = Math.floor(counter / bin + 1) * bin;
          const shiftEnd = (typeof state.shiftEnd !== "undefined" && state.shiftEnd)
            ? new Date(state.shiftEnd) : null;

          for(let n=0; n<20; n++, target += bin){
            const missing = Math.max(0, target - counter);
            const at = new Date(start.getTime() + (missing / rate) * 3600000);
            if(at < new Date()) continue;
            if(shiftEnd && at > shiftEnd) break;
            events.push({
              type:"bin",
              title:`Cambio fusto — ${machine.name || "Macchina"}`,
              at
            });
          }
        });
      }

      if(typeof state !== "undefined" && Array.isArray(state.alerts) && typeof nextAlert === "function"){
        state.alerts.forEach(alert => {
          const ev = nextAlert(alert);
          if(ev && ev.at){
            events.push(ev);
          }
        });
      }
    }catch{}

    return events.sort((a,b)=>a.at-b.at);
  }

  function renderNextFiveActivities(){
    const box = document.getElementById("nextFiveActivities");
    if(!box) return;

    const events = getUpcomingEvents()
      .filter(event => event && event.at)
      .sort((a,b)=>a.at-b.at)
      .slice(1, 6);

    if(!events.length){
      box.innerHTML = `<div class="next-five-empty">Nessun'altra attività programmata</div>`;
      return;
    }

    box.innerHTML = events.map(event => {
      const diff = event.at.getTime() - Date.now();
      const cls = diff <= 0 ? "due" : diff <= 10*60*1000 ? "soon" : "";
      return `
        <div class="next-five-item ${cls}">
          <div class="next-five-name">${event.title || "Attività"}</div>
          <div class="next-five-meta">
            <span>${formatSmallDuration(diff)}</span>
            <span>${formatSmallTime(event.at)}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  const originalRender = typeof render === "function" ? render : null;
  if(originalRender && !window.__nextFiveRenderPatched){
    window.__nextFiveRenderPatched = true;
    render = function(){
      const result = originalRender.apply(this, arguments);
      setTimeout(renderNextFiveActivities, 0);
      return result;
    };
  }

  setInterval(renderNextFiveActivities, 1000);
  document.addEventListener("DOMContentLoaded", renderNextFiveActivities);
})();

