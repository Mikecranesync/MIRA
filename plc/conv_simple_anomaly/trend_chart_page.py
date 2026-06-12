"""
The trend chart HTML page, served by trend_historian at GET /chart.

Self-contained: dependency-free vanilla JS + a small canvas line renderer (no uPlot, no CDN,
no vendored asset) — so it works fully offline and embodies the product's "zero external
dependency" goal. ISA-101 / High-Performance HMI styling: muted-gray normal traces, strong
color ONLY on abnormal, mode-aware normal bands, comms-freshness + STALE banner, a
maintenance-intelligence panel (state + read + next-check), no raw-tag wall.

For the shipped product (Track B) this whole page is replaced by a native Perspective
Time-Series/Power Chart bound to the Tag Historian — this page is the bench bootstrap.
"""
from __future__ import annotations


def render(asset_id: str = "conveyor_demo") -> str:
    # The page polls same-origin /trend and /trends/summary (served by the historian).
    return _HTML.replace("__ASSET__", asset_id)


_HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MIRA Trends — __ASSET__</title>
<style>
  :root{ --bg:#161616; --panel:#1e1e1e; --line:#2a2a2a; --muted:#8a8f96; --text:#d6d9dd;
         --ok:#39b34a; --warn:#e0a32e; --bad:#d6453d; --accent:#00b4a6; }
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--text);font:13px/1.4 'Segoe UI',Arial,sans-serif;display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:14px;padding:8px 14px;background:#121212;border-bottom:1px solid var(--line)}
  header .ttl{font-weight:600;letter-spacing:.04em}
  header .asset{color:var(--muted)}
  .chip{margin-left:auto;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--muted);display:inline-block}
  .dot.ok{background:var(--ok)} .dot.bad{background:var(--bad)}
  select{background:#222;color:var(--text);border:1px solid var(--line);border-radius:4px;padding:3px 6px}
  main{flex:1;display:flex;min-height:0}
  .left{width:230px;border-right:1px solid var(--line);overflow:auto;padding:8px}
  .sig{display:flex;align-items:center;gap:8px;padding:6px 6px;border-radius:5px;cursor:pointer}
  .sig:hover{background:#222} .sig.off{opacity:.45}
  .sig .pip{width:9px;height:9px;border-radius:50%;background:var(--muted);flex:none}
  .sig .nm{flex:1} .sig .val{font-variant-numeric:tabular-nums;color:var(--text)}
  .sig .u{color:var(--muted);font-size:11px;margin-left:3px}
  .sig.disabled{opacity:.35;cursor:not-allowed}
  .right{flex:1;display:flex;flex-direction:column;min-width:0}
  .chartwrap{flex:1;position:relative;min-height:0}
  canvas{width:100%;height:100%;display:block}
  .stale{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
         background:rgba(20,20,20,.6);color:var(--warn);font-size:18px;font-weight:600;letter-spacing:.06em}
  .stale.show{display:flex}
  .intel{border-top:1px solid var(--line);padding:10px 14px;background:var(--panel);min-height:84px}
  .intel .state{font-weight:600;display:flex;align-items:center;gap:8px}
  .intel .read{color:var(--text);margin-top:4px}
  .intel .next{color:var(--muted);margin-top:3px}
  .badge{font-size:11px;padding:1px 7px;border-radius:9px;border:1px solid var(--line)}
  .badge.run{color:var(--ok);border-color:#2c5} .badge.stop{color:var(--muted)}
  .badge.abn{color:var(--bad);border-color:#a33}
</style></head>
<body>
<header>
  <span class="ttl">MIRA · LIVE TRENDS</span><span class="asset">__ASSET__</span>
  <label class="chip">window
    <select id="win">
      <option value="120">2 min</option><option value="300" selected>5 min</option>
      <option value="600">10 min</option><option value="1800">30 min</option>
    </select>
  </label>
  <span class="chip"><span id="cdot" class="dot"></span><span id="fresh">connecting…</span></span>
</header>
<main>
  <div class="left" id="siglist"></div>
  <div class="right">
    <div class="chartwrap"><canvas id="cv"></canvas><div class="stale" id="staleband">⚠ STALE — comms lost</div></div>
    <div class="intel">
      <div class="state"><span id="statebadge" class="badge stop">—</span><span id="statetext">waiting for data…</span></div>
      <div class="read" id="readline"></div>
      <div class="next" id="nextline"></div>
    </div>
  </div>
</main>
<script>
// ---- Signal registry: ISA-101 actual+setpoint+range+units+quality contract per tag ----
// band = mode-aware normal band [lo,hi]; bandRun overrides when motor_running=1.
// plaus = wider sanity range; outside => SUSPECT (tag lying, not process abnormal).
const REG = [
  {key:"vfd_dc_bus_v",   label:"DC Bus",     unit:"V",  band:[305,325], bandRun:[300,360], plaus:[50,500], on:true},
  {key:"vfd_frequency_hz",label:"Frequency", unit:"Hz", band:[-0.5,0.5],bandRun:[0,62],    plaus:[-1,80],  on:true, setpoint:"vfd_freq_setpoint"},
  {key:"vfd_current_a",  label:"Current",    unit:"A",  band:[-0.1,0.3],bandRun:[-0.1,6],  plaus:[-1,40],  on:true},
  {key:"vfd_voltage_v",  label:"Out Voltage",unit:"V",  band:[-1,5],    bandRun:[0,260],   plaus:[-5,400], on:false},
  {key:"vfd_freq_setpoint",label:"Setpoint", unit:"Hz", band:null,      plaus:[-1,80],     on:false},
  {key:"ambient_temp_c", label:"Ambient Temp",unit:"°C",band:[-10,45],  plaus:[-40,85],    on:false, future:true},
];
const TRACE_COLORS = {}; // assigned per active tag
const PALETTE = ["#7da6c6","#c6a87d","#9ac67d","#b08ac6","#c67d9a","#7dc6bf"];
let cfg = {asset:"__ASSET__", pollMs:2000};
let summary = {}; let series = {}; let lastGoodTs = 0;

function activeKeys(){ return REG.filter(r=>r.on && !r.future).map(r=>r.key); }
function regOf(k){ return REG.find(r=>r.key===k); }

// ---- data fetch ----
async function tick(){
  try{
    const win = +document.getElementById('win').value;
    const sres = await fetch('trends/summary?window=60',{cache:'no-store'});
    summary = (await sres.json()).summaries || {};
    const keys = activeKeys();
    await Promise.all(keys.map(async k=>{
      const r = await fetch(`trend?tag=${encodeURIComponent(k)}&window=${win}&points=400`,{cache:'no-store'});
      const j = await r.json(); series[k] = j.points || [];
    }));
    lastGoodTs = Date.now();
    document.getElementById('cdot').className = 'dot ok';
  }catch(e){
    document.getElementById('cdot').className = 'dot bad';
  }
  render();
}

// ---- freshness / stale ----
function freshnessSecs(){
  let newest = 0;
  for(const k of activeKeys()){ const s=series[k]; if(s&&s.length) newest=Math.max(newest, s[s.length-1].ts*1000); }
  return newest? (Date.now()-newest)/1000 : 999;
}

// ---- render ----
function render(){
  // signal list
  const list = document.getElementById('siglist'); list.innerHTML='';
  REG.forEach((r,i)=>{
    const s = summary[r.key];
    const div = document.createElement('div');
    const present = !!s && s.current!==null;
    div.className='sig'+(r.on?'':' off')+((r.future&&!present)?' disabled':'');
    const cur = present? (Math.round(s.current*100)/100) : (r.future?'n/c':'—');
    const q = present? (s.quality||'good') : 'no_data';
    const pipcol = !present? 'var(--muted)' : (q!=='good'?'var(--warn)':'var(--ok)');
    div.innerHTML = `<span class="pip" style="background:${TRACE_COLORS[r.key]||pipcol}"></span>`+
      `<span class="nm">${r.label}</span><span class="val">${cur}<span class="u">${r.unit}</span></span>`;
    if(!(r.future&&!present)) div.onclick=()=>{ r.on=!r.on; tick(); };
    list.appendChild(div);
  });
  // freshness chip + stale band
  const fs = freshnessSecs();
  document.getElementById('fresh').textContent = isFinite(fs)? (fs<2?'live':`${fs.toFixed(0)}s ago`) : '—';
  const stale = fs > Math.max(2, cfg.pollMs/1000*2);
  document.getElementById('staleband').className = 'stale'+(stale?' show':'');
  drawChart(stale);
  drawIntel(stale);
}

function drawChart(stale){
  const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);
  const padL=46,padR=12,padT=10,padB=20, pw=W-padL-padR, ph=H-padT-padB;
  // grid
  ctx.strokeStyle='#242424'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=padT+ph*i/4; ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();}
  const keys=activeKeys(); if(!keys.length){return;}
  // time domain across all series
  let tmin=Infinity,tmax=-Infinity;
  keys.forEach(k=>{(series[k]||[]).forEach(p=>{tmin=Math.min(tmin,p.ts);tmax=Math.max(tmax,p.ts);});});
  if(!isFinite(tmin)){return;} if(tmax<=tmin)tmax=tmin+1;
  const running = (summary['motor_running']||{}).current===1;
  keys.forEach((k,ci)=>{
    const r=regOf(k), pts=series[k]||[]; if(!pts.length)return;
    TRACE_COLORS[k]=PALETTE[ci%PALETTE.length];
    // per-trace value domain (auto from plausible+band)
    let vmin=Infinity,vmax=-Infinity; pts.forEach(p=>{if(p.value!=null){vmin=Math.min(vmin,p.value);vmax=Math.max(vmax,p.value);}});
    const band = (running&&r.bandRun)?r.bandRun:r.band;
    if(band){vmin=Math.min(vmin,band[0]);vmax=Math.max(vmax,band[1]);}
    if(!isFinite(vmin)){return;} if(vmax<=vmin)vmax=vmin+1; const vpad=(vmax-vmin)*0.08; vmin-=vpad;vmax+=vpad;
    const X=t=>padL+(t-tmin)/(tmax-tmin)*pw, Y=v=>padT+ph-(v-vmin)/(vmax-vmin)*ph;
    // normal band shading (very subtle) — only for the first/selected trace to avoid clutter
    if(band && keys.length<=2){ ctx.fillStyle='rgba(120,160,200,0.06)';
      ctx.fillRect(padL,Y(band[1]),pw,Math.max(1,Y(band[0])-Y(band[1]))); }
    // setpoint dashed overlay
    if(r.setpoint && summary[r.setpoint] && summary[r.setpoint].current!=null){
      const sp=summary[r.setpoint].current; ctx.strokeStyle='#666';ctx.setLineDash([4,4]);ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(padL,Y(sp));ctx.lineTo(W-padR,Y(sp));ctx.stroke();ctx.setLineDash([]); }
    // trace: muted gray normally; RED only where value leaves the band (abnormal-only color)
    ctx.lineWidth=1.5;
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i]; if(a.value==null||b.value==null)continue;
      const inBand = !band || (b.value>=band[0]&&b.value<=band[1]);
      const suspect = r.plaus && (b.value<r.plaus[0]||b.value>r.plaus[1]);
      ctx.strokeStyle = stale? '#555' : suspect? '#e0a32e' : inBand? (TRACE_COLORS[k]) : '#d6453d';
      ctx.beginPath();ctx.moveTo(X(a.ts),Y(a.value));ctx.lineTo(X(b.ts),Y(b.value));ctx.stroke();
    }
    // y-axis labels for the primary trace
    if(ci===0){ ctx.fillStyle='#8a8f96';ctx.font='10px Segoe UI';ctx.textAlign='right';
      for(let i=0;i<=4;i++){const v=vmax-(vmax-vmin)*i/4;ctx.fillText(v.toFixed(0),padL-4,padT+ph*i/4+3);}
      ctx.textAlign='left'; ctx.fillText(r.label+' ('+r.unit+')',padL+2,padT+9); }
  });
}

// ---- maintenance-intelligence panel: state + read + next-check (not a raw-tag wall) ----
function drawIntel(stale){
  const sb=document.getElementById('statebadge'), st=document.getElementById('statetext');
  const rd=document.getElementById('readline'), nx=document.getElementById('nextline');
  if(stale){ sb.className='badge abn'; sb.textContent='COMMS'; st.textContent='Lost comms to the historian';
    rd.textContent='No fresh data — the trend service or PLC link is down.'; nx.textContent='Next: confirm trend_historian is running and the PLC is reachable.'; return; }
  const running=(summary['motor_running']||{}).current===1;
  const cmd=(summary['vfd_cmd_word']||{}).current;
  const dirTxt = cmd===34?'REVERSE':cmd===18?'FORWARD':'';
  sb.className='badge '+(running?'run':'stop'); sb.textContent=running?('RUNNING'+(dirTxt?' '+dirTxt:'')):'STOPPED';
  st.textContent = running? 'Conveyor running':'Conveyor stopped';
  // find the most notable signal: any excursion, else any rising/falling, else nominal
  const notes=[]; let next='—';
  for(const k of activeKeys()){ const s=summary[k]; if(!s||s.current==null)continue; const r=regOf(k);
    if(s.note){ notes.push(r.label+': '+s.note); continue; }
    const band=(running&&r.bandRun)?r.bandRun:r.band;
    if(band && (s.current<band[0]||s.current>band[1])){
      notes.push(`${r.label} ${s.current.toFixed(1)}${r.unit} is OUTSIDE its normal band`);
      next=`Next: investigate ${r.label.toLowerCase()} — ${s.direction}, ${s.distance_to_threshold!=null? Math.abs(s.distance_to_threshold).toFixed(1)+r.unit+' past limit':''}.`;
    } else if(s.direction==='rising'||s.direction==='falling'){
      notes.push(`${r.label} ${s.direction} (${s.rate_per_min>0?'+':''}${s.rate_per_min.toFixed(1)} ${r.unit}/min)`);
    }
  }
  rd.textContent = notes.length? notes.slice(0,3).join(' · ') : 'All trended signals nominal and steady.';
  nx.textContent = next;
}

window.addEventListener('resize', ()=>render());
tick(); setInterval(tick, cfg.pollMs);
</script>
</body></html>"""
