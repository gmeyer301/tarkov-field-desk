'use strict';
const icons = {
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
  grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  log:'<path d="M4 19V5h16v14zM8 15v-3m4 3V8m4 7v-5"/>',
  tasks:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M8 12l2 2 5-5m-7 8h8"/>',
  map:'<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
  hide:'<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  shield:'<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
};
const icon = name => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = new Intl.NumberFormat();
const fmt = value => number.format(value);
const pages = {overview:['Overview','grid'],raids:['Raid journal','log'],quests:['Quest tracker','tasks'],maps:['Interactive maps','map'],hideout:['Hideout','hide']};
const storeKey = 'tarkov-field-desk-v1';
const empty = () => ({profile:{name:'',level:1,faction:'USEC'},raids:[],quests:{},objectives:{},hideout:{},materials:{}});
let db = empty();
try { const saved = JSON.parse(localStorage.getItem(storeKey)); if (saved) db = {...db,...saved}; } catch {}
let page, renderToken = 0, timer;
let mapId = 'customs', questTrader = '', questStatus = '', questSearch = '', stationSearch = '', raidType = '';
const layers = {extract:['Extracts','#c3f290',true],spawn:['Player spawns','#ffc16c',true],transit:['Transits','#91d7ff',false],loot:['Loot containers','#dbb9ff',false],switch:['Switches','#f59391',false]};
const cache = new Map();
function readData(path) {
  if (!cache.has(path)) {
    cache.set(path,fetch(path).then(r => {if (!r.ok) throw Error(r.status); return r.json();}).catch(e => {cache.delete(path); throw e;}));
  }
  return cache.get(path);
}
function notice(message) {
  $('#notice').textContent = message;
  clearTimeout(timer);
  timer = setTimeout(() => $('#notice').textContent = '',3200);
}
function save(message) {
  try { localStorage.setItem(storeKey,JSON.stringify(db)); if (message) notice(message); }
  catch { notice('Browser storage is unavailable. Changes may be lost on reload.'); }
}
function nav(pageId) {
  if (location.hash === '#'+pageId) render();
  else location.hash = pageId;
}
const metric = (label,value,note,glyph) => '<div class="metric"><div class="caption">'+label+icon(glyph)+'</div><strong>'+value+'</strong><small>'+note+'</small></div>';
const button = (text,attrs='',glyph='') => '<button type="button" '+attrs+'>'+(glyph?icon(glyph):'')+text+'</button>';
const head = (title,description) => '<div class="pagehead"><h1>'+title+'</h1><p>'+description+'</p></div>';
const card = (title,glyph,action,content) => '<section class="card"><div class="cardhead"><h2>'+icon(glyph)+title+'</h2>'+action+'</div><div class="cardbody">'+content+'</div></section>';
const progress = (n,total) => '<div class="progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="'+Math.max(1,total)+'" aria-valuenow="'+n+'"><i style="width:'+(total?Math.min(100,n/total*100):0)+'%"></i></div>';
function stats(raids) {
  const survived = raids.filter(r=>r.result==='Survived').length;
  const deaths = raids.filter(r=>['KIA','MIA'].includes(r.result)).length;
  const kills = raids.reduce((sum,r)=>sum+r.kills,0);
  const xp = raids.reduce((sum,r)=>sum+r.xp,0);
  return {survived,kills,xp,rate:raids.length?Math.round(survived/raids.length*100)+'%':'—',kd:deaths?(kills/deaths).toFixed(2):'—'};
}
function raidsList(raids,editable=false) {
  return raids.length ? raids.map(r=>'<div class="listrow"><div><h3>'+esc(r.map)+' <span class="meta">'+esc(r.role)+'</span></h3><small>'+esc(new Date(r.date).toLocaleDateString())+' · '+fmt(r.kills)+' kills · '+fmt(r.xp)+' XP</small></div><span class="pill '+(r.result==='KIA'?'danger':'')+'">'+esc(r.result)+'</span>'+(editable?button('Edit','data-edit="'+esc(r.id)+'" class="outline"'):'')+'</div>').join('') : '<p>No raids logged yet. Add a raid to start tracking your stats.</p>';
}
function parseProfileSnapshot(profile) {
  const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
  const fields = {
    raids:['Sessions'], survived:['ExitStatus','Survived'], kills:['Kills'],
    kia:['ExitStatus','Killed'], mia:['ExitStatus','Left']
  };
  const totals = {raids:0,survived:0,kills:0,kia:0,mia:0};
  let found = false;
  for (const side of ['pmcStats','scavStats']) {
    const items = profile?.[side]?.eft?.overAllCounters?.Items;
    if (!Array.isArray(items)) continue;
    found = true;
    for (const [field, keys] of Object.entries(fields)) {
      const row = items.find(item => Array.isArray(item?.Key) &&
        item.Key.length === keys.length && keys.every(key => item.Key.includes(key)));
      if (row && !nonnegative(row.Value)) throw new Error('Invalid profile counter');
      totals[field] += row?.Value ?? 0;
    }
  }
  const name = profile?.info?.nickname;
  const xp = profile?.info?.experience;
  if (!found || typeof name !== 'string' || !name.trim() || !nonnegative(xp) ||
      totals.survived + totals.kia + totals.mia > totals.raids) {
    throw new Error('Invalid Tarkov.dev profile snapshot');
  }
  return {...totals, name:name.trim().slice(0,80), xp, importedAt:new Date().toISOString()};
}
function accountSnapshot() {
  const p = db.snapshot;
  const action = button(p ? 'Update snapshot' : 'Import profile', 'class="outline" data-import');
  if (!p) return card('In-game profile','target',action,
    '<p>Import a profile JSON from <a href="https://tarkov.dev/players" target="_blank" rel="noopener">Tarkov.dev player lookup</a> to view your in-game totals.</p>');
  const rate = p.raids ? Math.round(100*p.survived/p.raids)+'%' : '—';
  const deaths = p.kia+p.mia;
  return card('In-game profile','target',action,
    '<p>'+esc(p.name)+' · Tarkov.dev snapshot imported '+esc(new Date(p.importedAt).toLocaleString())+'</p>'+
    '<div class="metrics snapshot-metrics">'+
    metric('In-game raids',fmt(p.raids),fmt(p.survived)+' survived','log')+
    metric('Survival rate',rate,'Survived / in-game raids','shield')+
    metric('Kills',fmt(p.kills),'K/D '+(deaths?(p.kills/deaths).toFixed(2):'—'),'target')+
    metric('Profile XP',fmt(p.xp),'In-game profile total','tasks')+'</div>');
}
function importProfile() {
  const form = $('#form');
  setDialog('<h2>Import Tarkov.dev profile</h2>'+
    '<p>Find your player on <a href="https://tarkov.dev/players" target="_blank" rel="noopener">Tarkov.dev</a>, click <strong>Save profile</strong>, then select the downloaded JSON.</p>'+
    '<label>Profile JSON<input type="file" name="snapshot" accept=".json,application/json" required></label>'+
    '<p role="alert" id="import-error"></p>'+dialogActions('Import'),()=>{});
  form.onsubmit = async event => {
    event.preventDefault();
    const file = new FormData(form).get('snapshot');
    const error = $('#import-error');
    const submit = form.querySelector('.primary');
    submit.disabled = true;
    try {
      if (file.size > 5000000) throw new Error('Profile file is too large');
      const snapshot = parseProfileSnapshot(JSON.parse(await file.text()));
      if (!form.contains(error) || !$('#dialog').open) return;
      db.snapshot = snapshot;
      save('Tarkov.dev profile imported');
      $('#dialog').close();
      render();
    } catch {
      error.textContent = 'Choose a valid Tarkov.dev profile JSON file under 5 MB.';
    } finally {
      submit.disabled = false;
    }
  };
}
function overview(quests,stations) {
  const s = stats(db.raids);
  const done = quests.filter(q=>db.quests[q.id]==='Completed').length;
  const active = quests.filter(q=>db.quests[q.id]==='In progress');
  const installed = stations.reduce((n,station)=>n+station.levels.filter(l=>l.level>0&&l.level<=(db.hideout[station.id]||0)).length,0);
  const total = stations.reduce((n,station)=>n+station.levels.filter(l=>l.level>0).length,0);
  $('#view').innerHTML = '<section class="hero"><div><h1>Tarkov <span>Field Desk</span></h1><p>'+(db.profile.name?esc(db.profile.name)+' · '+esc(db.profile.faction)+' · Level '+esc(db.profile.level):'Track your raids, plan your route, and keep your progression in view.')+'</p><div class="actions">'+button('Log raid','class="primary" data-add','plus')+button('Open maps','class="outline" data-go="maps"','map')+'</div></div></section>'+
  '<section class="metrics" aria-label="Raid statistics">'+metric('Raids logged',fmt(db.raids.length),fmt(s.survived)+' successful extracts','log')+metric('Survival rate',s.rate,'Survived / logged raids','shield')+metric('Kills',fmt(s.kills),'K/D '+s.kd,'target')+metric('Experience',fmt(s.xp),'XP from logged raids','tasks')+'</section>'+
  '<div class="snapshot-section">'+accountSnapshot()+'</div>'+
  '<div class="split">'+card('Quest progression','tasks',button('View quests','class="outline" data-go="quests"'),'<h3>'+fmt(done)+' of '+fmt(quests.length)+' completed</h3>'+progress(done,quests.length)+(active.length?active.slice(0,3).map(q=>'<div class="listrow"><div><h3>'+esc(q.name)+'</h3><small>'+esc(q.trader)+'</small></div><span class="pill">In progress</span></div>').join(''):'<p>Mark a quest in progress to see it here.</p>'))+
  card('Hideout progression','hide',button('View hideout','class="outline" data-go="hideout"'),'<h3>'+fmt(installed)+' of '+fmt(total)+' upgrades installed</h3>'+progress(installed,total)+'<p>Track station levels and the supplies you need for each upgrade.</p>')+'</div><div class="section">'+card('Recent raids','log',button('Raid journal','class="outline" data-go="raids"'),raidsList(db.raids.slice(0,5)))+'</div>';
}
function raidJournal(){
  const raids=db.raids.filter(r=>!raidType||r.role===raidType);
  const s=stats(raids);
  $('#view').innerHTML=head('Raid journal','Log your PMC and Scav runs to track performance over time.')+
    '<div class="toolbar">'+button('Log raid','class="primary" data-add','plus')+'<select id="raid-type" aria-label="Filter by character"><option value="">All characters</option><option>PMC</option><option>Scav</option></select></div>'+
    '<section class="metrics">'+metric('Raids logged',fmt(raids.length),'Selected character','log')+metric('Survival rate',s.rate,fmt(s.survived)+' successful extracts','shield')+metric('Kills',fmt(s.kills),'K/D '+s.kd,'target')+metric('Experience',fmt(s.xp),'Logged XP','tasks')+'</section>'+
    card('Raid history','log','',raidsList(raids,true));
  $('#raid-type').value=raidType;
  $('#raid-type').onchange=e=>{raidType=e.target.value;raidJournal();};
}
function setDialog(html,onSubmit) {
  const dialog=$('#dialog');
  const form=$('#form');
  form.innerHTML=html;
  form.onsubmit=e=>{e.preventDefault();onSubmit(new FormData(form));dialog.close();};
  form.querySelector('[data-cancel]').onclick=()=>dialog.close();
  dialog.showModal();
}
const input = (title,name,value,type='text',extra='') => '<label>'+title+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
const select = (title,name,options,selected) => '<label>'+title+'<select name="'+name+'">'+options.map(o=>'<option'+(o===selected?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select></label>';
const dialogActions = (submit,remove=false) => '<div class="actions"><button class="primary">'+submit+'</button>'+button('Cancel','data-cancel class="outline"')+(remove?button('Delete raid','data-remove class="outline danger"'):'')+'</div>';
function editProfile(){
  setDialog('<h2>Edit profile</h2>'+input('Operator name','name',db.profile.name,'text','maxlength="32"')+input('PMC level','level',db.profile.level,'number','min="1" max="100" required')+select('Faction','faction',['USEC','BEAR'],db.profile.faction)+dialogActions('Save profile'),data=>{
    db.profile={name:data.get('name').trim(),level:Number(data.get('level')),faction:data.get('faction')};save('Profile saved');render();
  });
}
async function editRaid(id){
  let maps;
  try { maps=await readData('maps.json'); } catch { notice('Could not load the map catalog. Try again.'); return; }
  const existing=db.raids.find(r=>r.id===id);
  const raid=existing||{map:'Customs',role:'PMC',result:'Survived',kills:0,xp:0};
  const names=[...new Set([...maps.map(m=>m.name),raid.map])].sort();
  setDialog('<h2>'+(existing?'Edit raid':'Log raid')+'</h2>'+select('Map','map',names,raid.map)+select('Character','role',['PMC','Scav'],raid.role)+select('Outcome','result',['Survived','KIA','Run through','MIA'],raid.result)+input('Kills','kills',raid.kills,'number','min="0" max="999" step="1" required')+input('Experience','xp',raid.xp,'number','min="0" max="9999999" step="1" required')+dialogActions('Save raid',!!existing),data=>{
    const record={id:existing?.id||crypto.randomUUID(),date:existing?.date||new Date().toISOString(),map:data.get('map'),role:data.get('role'),result:data.get('result'),kills:Number(data.get('kills')),xp:Number(data.get('xp'))};
    db.raids=existing?db.raids.map(r=>r.id===id?record:r):[record,...db.raids];save('Raid saved');render();
  });
  const remove=$('[data-remove]');
  if (remove) remove.onclick=()=>{
    if (!confirm('Delete this raid from your journal?')) return;
    db.raids=db.raids.filter(r=>r.id!==id);save('Raid deleted');$('#dialog').close();render();
  };
}
function questsView(quests){
  const traders=[...new Set(quests.map(q=>q.trader))].sort();
  $('#view').innerHTML=head('Quest tracker','Browse trader tasks, check objectives, and mark quests complete.')+
    '<div class="toolbar"><input id="quest-search" type="search" placeholder="Search quests, maps, or objectives" aria-label="Search quests"><select id="trader" aria-label="Filter by trader"><option value="">All traders</option>'+traders.map(t=>'<option>'+esc(t)+'</option>').join('')+'</select><select id="quest-status" aria-label="Filter by quest status"><option value="">All statuses</option><option>Not started</option><option>In progress</option><option>Completed</option></select></div><p id="matches" class="meta"></p><div id="quest-catalog" class="catalog section"></div>';
  function show(){
    const found=quests.filter(q=>(!questTrader||q.trader===questTrader)&&(!questStatus||(db.quests[q.id]||'Not started')===questStatus)&&[q.name,q.map,...q.objectives.map(o=>o.text)].join(' ').toLowerCase().includes(questSearch.trim().toLowerCase()));
    $('#matches').textContent=fmt(found.length)+' quests · '+fmt(quests.filter(q=>db.quests[q.id]==='Completed').length)+' completed';
    $('#quest-catalog').innerHTML=found.length?found.map(q=>{
      const status=db.quests[q.id]||'Not started';
      const checked=db.objectives[q.id]||{};
      const wiki=q.wiki?.startsWith('https://')?'<a href="'+esc(q.wiki)+'" target="_blank" rel="noopener">Quest guide</a>':'';
      return '<article class="card"><p class="meta">'+esc(q.trader)+' · Level '+esc(q.level||1)+(q.kappa?' · Kappa':'')+'</p><h3>'+esc(q.name)+'</h3><p>'+esc(q.map)+' · '+fmt(q.xp||0)+' XP</p><details><summary>Objectives ('+q.objectives.filter(o=>checked[o.id]).length+'/'+q.objectives.length+')</summary><ul>'+q.objectives.map(o=>'<li><label class="checkline"><input type="checkbox" data-objective="'+esc(o.id)+'" data-task="'+esc(q.id)+'" '+(checked[o.id]?'checked':'')+'><span>'+esc(o.text)+(o.optional?' (optional)':'')+'</span></label></li>').join('')+'</ul>'+wiki+'</details><div class="status"><label>Status<select data-status="'+esc(q.id)+'">'+['Not started','In progress','Completed'].map(s=>'<option'+(s===status?' selected':'')+'>'+s+'</option>').join('')+'</select></label></div></article>';
    }).join(''):'<p>No quests match your filters.</p>';
  }
  const search=$('#quest-search'), trader=$('#trader'), status=$('#quest-status');
  search.value=questSearch;trader.value=questTrader;status.value=questStatus;
  search.oninput=()=>{questSearch=search.value; show();};
  trader.onchange=()=>{questTrader=trader.value;show();};
  status.onchange=()=>{questStatus=status.value;show();};
  $('#quest-catalog').onchange=e=>{
    const el=e.target;
    if(el.dataset.status){
      db.quests[el.dataset.status]=el.value;save('Quest status saved');
      if(questStatus&&questStatus!==el.value)show();
      else $('#matches').textContent=$('#matches').textContent.split(' · ')[0]+' · '+fmt(quests.filter(q=>db.quests[q.id]==='Completed').length)+' completed';
    }
    if(el.dataset.objective){
      const task=quests.find(q=>q.id===el.dataset.task);
      const checks=db.objectives[task.id]??={};
      checks[el.dataset.objective]=el.checked;
      el.closest('details').querySelector('summary').textContent='Objectives ('+task.objectives.filter(o=>checks[o.id]).length+'/'+task.objectives.length+')';
      if(el.checked && (!db.quests[task.id] || db.quests[task.id]==='Not started')){
        db.quests[task.id]='In progress';
        el.closest('article').querySelector('select').value='In progress';
        if(questStatus==='Not started')show();
      }
      save();
    }
  };
  show();
}
function hideoutView(stations){
  $('#view').innerHTML=head('Hideout','Set your installed station levels and count supplies for your next upgrade.')+'<div class="toolbar"><input id="station-search" type="search" placeholder="Search stations" aria-label="Search stations"></div><div class="catalog" id="stations"></div>';
  const stationCard=s=>{
    const level=db.hideout[s.id]||0;
    const next=s.levels.find(l=>l.level>level);
    const max=s.levels.at(-1)?.level||0;
    const ready=next?.requirements.filter(r=>(db.materials[r.id]||0)>=r.count).length||0;
    return '<div class="stationtop"><span class="sigil">'+icon('hide')+'</span><div><h3>'+esc(s.name)+'</h3><p class="meta">Level '+level+' / '+max+'</p></div></div>'+progress(level,max)+
      '<label>Installed level<select data-level="'+esc(s.id)+'"><option value="0">0 · Not built</option>'+s.levels.filter(l=>l.level>0).map(l=>'<option value="'+l.level+'"'+(l.level===level?' selected':'')+'>Level '+l.level+'</option>').join('')+'</select></label>'+
      (next?'<details><summary>Level '+next.level+' requirements · <span data-ready>'+ready+'/'+next.requirements.length+' items</span></summary>'+ (next.prerequisites.length?'<p>'+next.prerequisites.map(esc).join(' · ')+'</p>':'')+(next.seconds?'<p>Build time '+(next.seconds/3600).toLocaleString(undefined,{maximumFractionDigits:2})+' hr</p>':'')+
      '<ul class="materials">'+next.requirements.map(r=>'<li><label><span>'+esc(r.name)+' <small>× '+fmt(r.count)+(r.fir?' · FIR':'')+'</small></span><input type="number" min="0" max="'+r.count+'" value="'+(db.materials[r.id]||0)+'" aria-label="'+esc(r.name)+' collected" data-material="'+esc(r.id)+'"></label></li>').join('')+'</ul></details>':'<span class="pill">Fully upgraded</span>');
  };
  const catalog=$('#stations');
  function show(){
    const filtered=stations.filter(s=>s.name.toLowerCase().includes(stationSearch.trim().toLowerCase()));
    catalog.innerHTML=filtered.length?filtered.map(s=>'<article class="card" data-station="'+esc(s.id)+'">'+stationCard(s)+'</article>').join(''):'<p>No stations match your search.</p>';
  }
  const search=$('#station-search');
  search.value=stationSearch;
  search.oninput=()=>{stationSearch=search.value;show();};
  catalog.onchange=e=>{
    const el=e.target, article=el.closest('article');
    const station=stations.find(s=>s.id===article.dataset.station);
    if(el.dataset.level){db.hideout[station.id]=Number(el.value);save('Station level saved');article.innerHTML=stationCard(station);article.querySelector('select').focus();}
    if(el.dataset.material){
      const next=station.levels.find(l=>l.level>(db.hideout[station.id]||0));
      const requirement=next.requirements.find(r=>r.id===el.dataset.material);
      db.materials[requirement.id]=Math.min(requirement.count,Math.max(0,Math.trunc(Number(el.value)||0)));
      el.value=db.materials[requirement.id];save();
      article.querySelector('[data-ready]').textContent=next.requirements.filter(r=>(db.materials[r.id]||0)>=r.count).length+'/'+next.requirements.length+' items';
    }
  };
  show();
}
async function mapView(maps,token){
  const selected=maps.find(m=>m.id===mapId)||maps[0];
  $('#view').innerHTML=head('Interactive maps','Explore raid locations with searchable extracts, spawns, transits, and loot overlays.')+
    '<div class="toolbar"><select id="map-select" aria-label="Raid location">'+maps.map(m=>'<option value="'+esc(m.id)+'"'+(m.id===selected.id?' selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select><span class="map-meta">'+(selected.duration?esc(selected.duration)+' min · ':'')+(selected.players?esc(selected.players)+' players':'')+'</span></div><div id="atlas"></div>';
  $('#map-select').onchange=e=>{mapId=e.target.value;render();};
  const atlas=$('#atlas');
  const source='<a href="'+esc(selected.source)+'" target="_blank" rel="noopener">Open full community map</a>';
  if(!selected.image){atlas.innerHTML='<section class="card mapinfo"><p>Open the community atlas for this location.</p>'+source+'</section>';return;}
  atlas.textContent='Loading map overlays…';
  const points=await readData(selected.markers);
  if(token!==renderToken)return;
  atlas.innerHTML='<div class="atlas"><div class="map-frame card" tabindex="0" aria-label="'+esc(selected.name)+' map. Use arrow keys to pan, plus or minus to zoom."><div class="map-world"><img alt="'+esc(selected.name)+' top-down map" draggable="false" src="'+esc(selected.image)+'"><canvas aria-hidden="true"></canvas></div><div class="map-controls">'+button('+','data-zoom="1.35" aria-label="Zoom in"')+button('−','data-zoom="0.74" aria-label="Zoom out"')+button('Fit','data-fit')+'</div></div><aside class="card mapinfo"><h2>Overlays</h2>'+Object.entries(layers).map(([id,[label,color,on]])=>'<label><input type="checkbox" data-layer="'+id+'" '+(on?'checked':'')+'><i class="dot" style="--dot:'+color+'"></i>'+label+'</label>').join('')+
    '<hr><label class="map-search">Find a marker<input id="point-search" type="search" placeholder="Filter visible layers"></label><ul id="point-list" aria-label="Map markers"></ul><div id="point-info" aria-live="polite"><p>Select a marker for details.</p></div><hr><p class="meta">'+esc(selected.author||'Community map')+' · Ground view</p>'+source+'</aside></div>';
  const frame=$('.map-frame'),world=$('.map-world'),canvas=world.querySelector('canvas'),ctx=canvas.getContext('2d');
  const active=new Set(Object.keys(layers).filter(id=>layers[id][2]));
  let x=0,y=0,w=1,h=1,z=1,focus=-1,visible=[],drag=null;
  function paint(){
    world.style.width=w+'px';world.style.height=h+'px';
    world.style.transform='translate('+x+'px,'+y+'px) scale('+z+')';
    const dpr=window.devicePixelRatio||1;
    const cw=Math.round(w*dpr),ch=Math.round(h*dpr);
    if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    for (const index of visible){
      const [kind,px,py]=points[index];
      const radius=(focus===index?8:kind==='loot'?3:5)/z;
      ctx.beginPath();ctx.arc(px*w,py*h,radius,0,Math.PI*2);ctx.fillStyle=layers[kind][1];ctx.fill();ctx.lineWidth=(focus===index?2:1.4)/z;ctx.strokeStyle=focus===index?'#fff':'#121511';ctx.stroke();
    }
  }
  function fit(){
    w=Math.min(frame.clientWidth*.96,frame.clientHeight*.94*selected.aspect);
    h=w/selected.aspect;z=1;x=(frame.clientWidth-w)/2;y=(frame.clientHeight-h)/2;paint();
  }
  function zoom(scale,cx=frame.clientWidth/2,cy=frame.clientHeight/2){
    const next=Math.max(.65,Math.min(9,z*scale)),ratio=next/z;
    x=cx-(cx-x)*ratio;y=cy-(cy-y)*ratio;z=next;paint();
  }
  function selectPoint(index,center){
    const [kind,px,py,name,note]=points[index];
    focus=index;
    if(center){x=frame.clientWidth/2-px*w*z;y=frame.clientHeight/2-py*h*z;}
    $('#point-info').innerHTML='<h3>'+esc(name)+'</h3><p>'+esc(layers[kind][0])+(note?' · '+esc(note):'')+'</p>';
    paint();
  }
  function update(){
    const search=$('#point-search').value.trim().toLowerCase();
    visible=points.flatMap(([kind,x,y,name,note],i)=>active.has(kind)&&(name+' '+note).toLowerCase().includes(search)?[i]:[]);
    if(!visible.includes(focus)){focus=-1;$('#point-info').innerHTML='<p>Select a marker for details.</p>';}
    $('#point-list').innerHTML=visible.length?visible.slice(0,100).map(i=>'<li><button type="button" data-point="'+i+'"><i class="dot" style="--dot:'+layers[points[i][0]][1]+'"></i>'+esc(points[i][3])+'</button></li>').join(''):'<li>No matching markers</li>';
    if(visible.length>100)$('#point-list').insertAdjacentHTML('beforeend','<li class="meta">First 100 of '+fmt(visible.length)+' markers. Search to narrow the list.</li>');
    paint();
  }
  atlas.querySelectorAll('[data-layer]').forEach(el=>el.onchange=()=>{if(el.checked)active.add(el.dataset.layer);else active.delete(el.dataset.layer);update();});
  $('#point-list').onclick=e=>{const el=e.target.closest('[data-point]');if(el)selectPoint(Number(el.dataset.point),true);};
  $('#point-search').oninput=update;
  frame.querySelectorAll('[data-zoom]').forEach(el=>el.onclick=()=>zoom(Number(el.dataset.zoom)));
  frame.querySelector('[data-fit]').onclick=fit;
  frame.onwheel=e=>{e.preventDefault();const rect=frame.getBoundingClientRect();zoom(e.deltaY<0?1.19:.84,e.clientX-rect.left,e.clientY-rect.top);};
  frame.onpointerdown=e=>{
    if(e.target.closest('button')||e.button!==0)return;
    drag={px:e.clientX,py:e.clientY,x,y};
    frame.setPointerCapture(e.pointerId);
  };
  frame.onpointermove=e=>{if(drag){x=drag.x+e.clientX-drag.px;y=drag.y+e.clientY-drag.py;paint();}};
  frame.onpointercancel=()=>{drag=null;};
  frame.onpointerup=e=>{
    if(!drag)return;
    const moved=Math.hypot(e.clientX-drag.px,e.clientY-drag.py);
    drag=null;
    if(moved>5)return;
    const rect=frame.getBoundingClientRect();
    const mx=e.clientX-rect.left,my=e.clientY-rect.top;
    let nearest=-1,distance=12;
    for(const i of visible){
      const [,px,py]=points[i];
      const d=Math.hypot(mx-(x+px*w*z),my-(y+py*h*z));
      if(d<distance){nearest=i;distance=d;}
    }
    if(nearest>=0)selectPoint(nearest,false);
  };
  frame.onkeydown=e=>{
    if(e.target!==frame)return;
    const directions={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};
    const movement=Object.hasOwn(directions,e.key)?directions[e.key]:null;
    if(movement){e.preventDefault();x+=movement[0];y+=movement[1];paint();}
    if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.35);}
    if(e.key==='-'){e.preventDefault();zoom(.74);}
  };
  const resize=new ResizeObserver(()=>{if(token!==renderToken)resize.disconnect();else fit();});
  resize.observe(frame);
  fit();update();
}
async function render(){
  const token=++renderToken;
  const requested=location.hash.slice(1);
  page=Object.hasOwn(pages,requested)?requested:'overview';
  $('#location').textContent=pages[page][0];
  $('nav').innerHTML='<div class="navlabel">WORKSPACE</div>'+Object.entries(pages).map(([id,[label,glyph]])=>button(label,'class="navitem" data-go="'+id+'" aria-current="'+(page===id)+'"',glyph)).join('');
  $('#view').innerHTML='<p role="status">Loading…</p>';
  try{
    if(page==='raids'){raidJournal();return;}
    const needs={overview:['quests.json','hideout.json'],quests:['quests.json'],hideout:['hideout.json'],maps:['maps.json']}[page];
    const data=await Promise.all(needs.map(readData));
    if(token!==renderToken)return;
    if(page==='overview')overview(...data);
    if(page==='quests')questsView(...data);
    if(page==='hideout')hideoutView(...data);
    if(page==='maps')await mapView(data[0],token);
  }catch(error){
    console.error(error);
    if(token===renderToken)$('#view').innerHTML='<p>Could not load this section.</p>'+button('Try again','data-retry class="outline"');
  }
}
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
document.addEventListener('click',e=>{
  const el=e.target.closest('button');
  if(!el)return;
  if(el.dataset.go)nav(el.dataset.go);
  if(el.hasAttribute('data-add'))editRaid();
  if(el.hasAttribute('data-import'))importProfile();
  if(el.dataset.edit)editRaid(el.dataset.edit);
  if(el.hasAttribute('data-retry'))render();
});
$('#profile').onclick=editProfile;
window.addEventListener('hashchange',render);
render();
