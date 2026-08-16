// ============================================================================
//  INDICADORES · Consolidado General (MVP)
//  Nivel de Servicio · Pesos por Kilo · Margen Cobrado vs Pagado · Flete Tercero
//  Lee en vivo las vistas v_ind_* de Supabase (RLS: usuario @ebema.cl con rol).
//  Paleta alineada a las presentaciones (PPT) del Comité de Transporte.
// ============================================================================
import { supabase } from './supabase-client.js';

// --- Paleta PPT -------------------------------------------------------------
const C = {
  navy:  '#0B2B4A',  // serie principal / OTIF
  blue:  '#2E75B6',  // secundaria / cobertura / toneladas
  orange:'#E97132',  // tarifa / costo
  red:   '#EE1B22',  // margen negativo
  green: '#1E8449',  // positivo
  ink:   '#333333',
  muted: '#808285',
  grid:  '#D9D5CF'
};

let _mounted = false;
// Subtab expuesto para simetría con el resto de módulos (MVP: solo 'general').
let currentSub = 'general';
export function setIndicadoresSubTab(sub){ if (sub) currentSub = sub; }

// --- Helpers de formato -----------------------------------------------------
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct  = v => (v==null? '–' : nf1.format(v) + '%');
const money= v => (v==null? '–' : '$' + nf1.format(v));
const mm   = v => (v==null? '–' : '$' + nf1.format(v) + ' MM');
const mesCorto = lbl => ({'01':'ene','02':'feb','03':'mar','04':'abr','05':'may','06':'jun','07':'jul','08':'ago','09':'sep','10':'oct','11':'nov','12':'dic'}[lbl.slice(5,7)]||lbl);

// ============================================================================
//  ENTRYPOINT
// ============================================================================
export async function renderIndicadoresView(container){
  container.innerHTML = loadingHTML();
  try {
    const y = '2026-01';
    const [ns, tar, mar, ft, sc] = await Promise.all([
      supabase.from('v_ind_ns_general_mes').select('*').gte('mes_label', y).order('mes_label'),
      supabase.from('v_ind_tarifa_general_mes').select('*').gte('mes_label', y).order('mes_label'),
      supabase.from('v_ind_margen_general_mes').select('*').gte('mes_label', y).order('mes_label'),
      supabase.from('v_ind_ftercero_mes').select('*').gte('mes_label', y).order('mes_label'),
      supabase.from('v_ind_sin_cobro_centro').select('*')
    ]);
    const err = ns.error||tar.error||mar.error||ft.error||sc.error;
    if (err) throw err;

    const data = {
      ns:  ns.data||[],
      tar: tar.data||[],
      mar: mar.data||[],
      ft:  ft.data||[],
      sc:  sc.data||[]
    };
    container.innerHTML = layoutHTML(data);
    ensureTip();
    drawAll(data);
  } catch (e) {
    container.innerHTML = errorHTML(e);
  }
}

// ============================================================================
//  LAYOUT
// ============================================================================
function card(title, lead, tiles, chartsHTML){
  return `
  <section class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md md:p-lg mb-lg">
    <div class="text-label-caps text-secondary uppercase mb-1">${title}</div>
    <div class="text-headline-sm font-bold mb-md">${lead}</div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div>
    ${chartsHTML}
  </section>`;
}
function tile(k, v, d, cls=''){
  return `<div class="bg-surface-container-low border border-surface-variant rounded-lg px-md py-sm">
    <div class="text-[11px] text-secondary">${k}</div>
    <div class="text-2xl font-bold leading-tight ${cls}">${v}</div>
    <div class="text-[11px] text-secondary mt-[2px]">${d||''}</div>
  </div>`;
}
function legend(items){
  return `<div class="flex flex-wrap gap-md text-[12px] text-secondary mb-sm">` +
    items.map(i=>`<span class="inline-flex items-center gap-[6px]"><span style="width:10px;height:10px;border-radius:2px;background:${i.c};display:inline-block"></span>${i.n}</span>`).join('') +
    `</div>`;
}

function layoutHTML(d){
  // Derivar KPIs en vivo
  const nsLast = d.ns[d.ns.length-1] || {};
  const nsAvgO = avg(d.ns.map(r=>r.otif_pct));
  const nsAvgF = avg(d.ns.map(r=>r.fillrate_pct));
  const nsLines= sum(d.ns.map(r=>r.lineas_evaluadas));
  const tarLastClosed = d.tar.length>1 ? d.tar[d.tar.length-2] : (d.tar[d.tar.length-1]||{});
  const tarAvg = wavg(d.tar.map(r=>[r.tarifa_kg, r.toneladas]));
  const tonAcc = sum(d.tar.map(r=>r.toneladas));
  const marAcc = sum(d.mar.map(r=>r.margen))/1e6;
  const cobAvg = avg(d.mar.map(r=>r.cobertura_pct));
  const scMonto= sum(d.sc.map(r=>r.monto_no_cobrado))/1e6;
  const scEnt  = sum(d.sc.map(r=>r.entregas_sin_cobro));
  const worst  = d.mar.reduce((a,b)=> (b.margen<(a?.margen??1e15)? b : a), null) || {};
  const ftLast = lastFT(d.ft);

  return `
  <div class="max-w-[1120px] mx-auto">
    <div class="flex items-start justify-between gap-md flex-wrap mb-md">
      <div>
        <div class="text-secondary text-body-md max-w-[640px]">Nivel de servicio, costo de transporte y margen de flete. Meses cerrados 2026 (el mes es la base general). <b>Agosto es parcial.</b></div>
      </div>
      <span class="text-[11px] text-secondary border border-surface-variant rounded-full px-md py-[3px]">Actualización diaria 08:00 · fuente Supabase</span>
    </div>

    ${card('1 · Nivel de Servicio','OTIF y Fill Rate — evolución mensual',
      tile('OTIF — '+mesCorto(nsLast.mes_label||'')+' (último)', pct(nsLast.otif_pct), 'Fill Rate '+pct(nsLast.fillrate_pct)) +
      tile('OTIF promedio', pct(nsAvgO), 'año cerrado') +
      tile('Fill Rate promedio', pct(nsAvgF), 'año cerrado') +
      tile('Líneas evaluadas', nf0.format(nsLines), 'acumulado'),
      legend([{n:'OTIF %',c:C.navy},{n:'Fill Rate %',c:C.blue}]) +
      `<div id="ind_ns"></div>`)}

    ${card('2 · Pesos por Kilo','Tarifa $/kg y toneladas — evolución mensual',
      tile('Tarifa — '+mesCorto(tarLastClosed.mes_label||'')+' (último)', money(tarLastClosed.tarifa_kg), '$/kg') +
      tile('Tarifa promedio', money(tarAvg), '$/kg · ponderado') +
      tile('Toneladas', nf0.format(tonAcc)+' t', 'acumulado') +
      tile('Peor mes margen', mm(worst.margen/1e6), mesCorto(worst.mes_label||'')),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Tarifa $/kg',c:C.orange}])+`<div id="ind_tar"></div></div>`+
      `<div>`+legend([{n:'Toneladas (t)',c:C.blue}])+`<div id="ind_ton"></div></div>`+
      `</div>`)}

    ${card('3 · Margen Cobrado vs Pagado','Margen de flete ($MM) y cobertura — evolución mensual',
      tile('Margen acumulado', mm(marAcc), 'excl. EbemaClick', marAcc<0?'text-[#EE1B22]':'') +
      tile('Cobertura promedio', pct(cobAvg), 'cobrado / pagado') +
      tile('Sin cobrar (red)', mm(scMonto), nf0.format(scEnt)+' entregas', 'text-[#EE1B22]') +
      tile('Peor mes', mm(worst.margen/1e6), mesCorto(worst.mes_label||''), 'text-[#EE1B22]'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Margen $MM',c:C.red}])+`<div id="ind_mar"></div></div>`+
      `<div>`+legend([{n:'Cobertura %',c:C.navy}])+`<div id="ind_cob"></div></div>`+
      `</div>`)}

    ${card('4 · Flete Tercero (Nivel de Servicio REVEX)','OTIF por modalidad — CD → sucursal → cliente',
      tile('OTIF Despacha', pct(ftLast.despO), (ftLast.despN||0)+' pedidos') +
      tile('OTIF Retira', pct(ftLast.retiO), (ftLast.retiN||0)+' pedidos') +
      tile('Pedidos', nf0.format(sum(d.ft.map(r=>r.pedidos))), 'período') +
      tile('Ciclo Despacha', (ftLast.despCiclo!=null? nf1.format(ftLast.despCiclo)+' d':'–'), 'último mes'),
      legend([{n:'Despacha',c:C.navy},{n:'Retira',c:C.orange}]) +
      `<div id="ind_ft"></div>`)}

    <div class="text-[11px] text-secondary mt-lg leading-relaxed">
      Datos leídos en vivo de las vistas <code>v_ind_*</code> (Supabase), refrescadas a diario a las 08:00.
      OTIF/Fill hasta el último mes cerrado; tarifa y margen incluyen agosto parcial. Próximo: drill por centro (semana móvil).
    </div>
  </div>`;
}

// ============================================================================
//  DIBUJO DE GRÁFICOS (SVG inline)
// ============================================================================
const W=560,H=210,PL=46,PR=14,PT=14,PB=26;
function px(i,n){return PL+(W-PL-PR)*(n===1?0.5:i/(n-1));}
function bx(i,n){var w=(W-PL-PR)/n;return PL+w*i+w/2;}
function py(v,mn,mx){return PT+(H-PT-PB)*(1-(v-mn)/(mx-mn));}

function gridY(out,mn,mx,fmt){
  for(var t=0;t<=4;t++){
    var val=mn+(mx-mn)*t/4, y=py(val,mn,mx);
    out.push('<line x1="'+PL+'" y1="'+y.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+y.toFixed(1)+'" stroke="'+C.grid+'" stroke-width="1"/>');
    out.push('<text x="'+(PL-6)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" fill="'+C.muted+'" font-size="10">'+fmt(val)+'</text>');
  }
}
function xLabels(out,labels){
  for(var i=0;i<labels.length;i++)
    out.push('<text x="'+bx(i,labels.length).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle" fill="'+C.muted+'" font-size="10">'+labels[i]+'</text>');
}
function lineChart(elId,series,labels,mn,mx,unit){
  var out=['<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;overflow:visible" role="img">'];
  gridY(out,mn,mx,function(v){return Math.round(v);});
  out.push('<line x1="'+PL+'" y1="'+(H-PB)+'" x2="'+(W-PR)+'" y2="'+(H-PB)+'" stroke="'+C.grid+'" stroke-width="1"/>');
  for(var s=0;s<series.length;s++){
    var ser=series[s], d='';
    for(var i=0;i<ser.v.length;i++){ var X=px(i,ser.v.length), Y=py(ser.v[i],mn,mx); d+=(i?'L':'M')+X.toFixed(1)+' '+Y.toFixed(1)+' '; }
    out.push('<path d="'+d+'" fill="none" stroke="'+ser.c+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    for(var j=0;j<ser.v.length;j++)
      out.push('<circle cx="'+px(j,ser.v.length).toFixed(1)+'" cy="'+py(ser.v[j],mn,mx).toFixed(1)+'" r="3.4" fill="'+ser.c+'" stroke="#fff" stroke-width="1.5" data-t="'+ser.n+' '+labels[j]+': '+fmtNum(ser.v[j])+unit+'"/>');
  }
  xLabels(out,labels); out.push('</svg>');
  var el=document.getElementById(elId); if(!el) return; el.innerHTML=out.join(''); bind(el);
}
function barChart(elId,vals,labels,mn,mx,color,unit,part,tickFmt){
  var out=['<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;overflow:visible" role="img">'];
  gridY(out,mn,mx,tickFmt||function(v){return Math.round(v);});
  var zeroY=py(0,mn,mx);
  out.push('<line x1="'+PL+'" y1="'+zeroY.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+zeroY.toFixed(1)+'" stroke="'+C.grid+'" stroke-width="1"/>');
  var bw=(W-PL-PR)/vals.length*0.6;
  for(var i=0;i<vals.length;i++){
    var v=vals[i], y=py(v,mn,mx), top=Math.min(y,zeroY), h=Math.max(Math.abs(y-zeroY),1);
    var op=(part!=null&&i>=part)?'0.5':'1', extra=(part!=null&&i>=part)?' (parcial)':'';
    out.push('<rect x="'+(bx(i,vals.length)-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" fill="'+color+'" opacity="'+op+'" data-t="'+labels[i]+': '+fmtNum(v)+unit+extra+'"/>');
  }
  xLabels(out,labels); out.push('</svg>');
  var el=document.getElementById(elId); if(!el) return; el.innerHTML=out.join(''); bind(el);
}
function fmtNum(v){ return nf1.format(v); }

function drawAll(d){
  // Nivel de servicio
  const nsL = d.ns.map(r=>mesCorto(r.mes_label));
  lineChart('ind_ns',[{n:'OTIF',v:d.ns.map(r=>r.otif_pct),c:C.navy},{n:'Fill',v:d.ns.map(r=>r.fillrate_pct),c:C.blue}],nsL,60,100,'%');
  // Tarifa + toneladas (agosto parcial = último si es el mes en curso)
  const tarL = d.tar.map(r=>mesCorto(r.mes_label));
  const partIdx = d.tar.length-1; // último mes = parcial
  barChart('ind_tar',d.tar.map(r=>r.tarifa_kg),tarL,0,niceMax(d.tar.map(r=>r.tarifa_kg)),C.orange,' $/kg',partIdx,function(v){return '$'+Math.round(v);});
  barChart('ind_ton',d.tar.map(r=>r.toneladas),tarL,0,niceMax(d.tar.map(r=>r.toneladas)),C.blue,' t',partIdx,function(v){return Math.round(v/1000)+'k';});
  // Margen + cobertura
  const marL = d.mar.map(r=>mesCorto(r.mes_label));
  const marVals = d.mar.map(r=>r.margen/1e6);
  barChart('ind_mar',marVals,marL,Math.min(-2,niceMin(marVals)),2,C.red,' MM',d.mar.length-1,function(v){return '$'+Math.round(v);});
  lineChart('ind_cob',[{n:'Cobertura',v:d.mar.map(r=>r.cobertura_pct),c:C.navy}],marL,60,100,'%');
  // Flete tercero (por mes, dos series)
  const ftBy = groupFT(d.ft);
  lineChart('ind_ft',[{n:'Despacha',v:ftBy.desp,c:C.navy},{n:'Retira',v:ftBy.reti,c:C.orange}],ftBy.labels,0,100,'%');
}

// ============================================================================
//  TOOLTIP
// ============================================================================
let _tip;
function ensureTip(){
  if (_tip) return;
  _tip = document.createElement('div');
  _tip.style.cssText='position:fixed;pointer-events:none;background:#111;color:#fff;font-size:11.5px;padding:6px 9px;border-radius:7px;opacity:0;transition:opacity .08s;z-index:9999;white-space:nowrap';
  document.body.appendChild(_tip);
}
function bind(el){
  const nodes=el.querySelectorAll('[data-t]');
  nodes.forEach(n=>{
    n.addEventListener('mousemove',e=>{ _tip.textContent=n.getAttribute('data-t'); _tip.style.opacity=1;
      let x=e.clientX+12,y=e.clientY+12; if(x>window.innerWidth-180)x=e.clientX-_tip.offsetWidth-12;
      _tip.style.left=x+'px'; _tip.style.top=y+'px'; });
    n.addEventListener('mouseleave',()=>{ _tip.style.opacity=0; });
  });
}

// ============================================================================
//  UTILIDADES DE DATOS
// ============================================================================
function sum(a){ return a.reduce((s,x)=>s+(Number(x)||0),0); }
function avg(a){ const v=a.filter(x=>x!=null); return v.length? sum(v)/v.length : null; }
function wavg(pairs){ let n=0,d=0; pairs.forEach(([val,w])=>{ if(val!=null&&w!=null){ n+=val*w; d+=w; } }); return d? n/d : null; }
function niceMax(a){ const m=Math.max.apply(null,a.map(Number)); return Math.ceil(m*1.15/ (m>1000?1000:1))*(m>1000?1000:1); }
function niceMin(a){ const m=Math.min.apply(null,a.map(Number)); return Math.floor(m*1.15); }
function lastFT(ft){
  if(!ft.length) return {};
  const last=ft[ft.length-1].mes_label;
  const rows=ft.filter(r=>r.mes_label===last);
  const dsp=rows.find(r=>r.modalidad==='Despacha')||{}, ret=rows.find(r=>r.modalidad==='Retira')||{};
  return { despO:dsp.otif_pct, despN:dsp.pedidos, despCiclo:dsp.ciclo_prom_dias, retiO:ret.otif_pct, retiN:ret.pedidos };
}
function groupFT(ft){
  const labels=[...new Set(ft.map(r=>r.mes_label))].sort();
  const desp=labels.map(l=>{const r=ft.find(x=>x.mes_label===l&&x.modalidad==='Despacha');return r?r.otif_pct:null;});
  const reti=labels.map(l=>{const r=ft.find(x=>x.mes_label===l&&x.modalidad==='Retira');return r?r.otif_pct:null;});
  return { labels:labels.map(mesCorto), desp:desp.map(v=>v==null?0:v), reti:reti.map(v=>v==null?0:v) };
}

// ============================================================================
//  ESTADOS
// ============================================================================
function loadingHTML(){
  return `<div class="flex justify-center items-center py-2xl text-secondary">
    <div class="text-center">
      <div class="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mx-auto mb-md"></div>
      <div>Cargando indicadores…</div>
    </div></div>`;
}
function errorHTML(e){
  return `<div class="max-w-[720px] mx-auto bg-error-container text-on-error-container rounded-xl p-lg">
    <div class="font-bold mb-1">No se pudieron cargar los indicadores</div>
    <div class="text-body-md">${(e&&e.message)||e}</div>
    <div class="text-[12px] mt-sm">Verifica tu sesión (rol reconocido) o que la carga de las 08:00 haya corrido (tabla <code>ind_log</code>).</div>
  </div>`;
}
