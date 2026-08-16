// ============================================================================
//  INDICADORES · Consolidado General + Drill por Centro
//  Nivel de Servicio · Pesos por Kilo · Margen Cobrado vs Pagado · Flete Tercero
//  Lee en vivo las vistas v_ind_* de Supabase (RLS: usuario @ebema.cl con rol).
//  Paleta alineada a las presentaciones (PPT) del Comité de Transporte.
// ============================================================================
import { supabase } from './supabase-client.js';

// --- Paleta PPT -------------------------------------------------------------
const C = {
  navy:'#0B2B4A', blue:'#2E75B6', orange:'#E97132', red:'#EE1B22',
  green:'#1E8449', ink:'#333333', muted:'#808285', grid:'#D9D5CF'
};

// --- Estado -----------------------------------------------------------------
let _container = null;
let _mode = 'general';        // 'general' | 'centro'
let _grupo = null;            // grupo seleccionado en modo centro
let _cacheGen = null;         // datos generales
let _cacheCen = null;         // datos por grupo

export function setIndicadoresSubTab(sub){
  if (sub === 'centro' || sub === 'general') _mode = sub;
}

// --- Formato ----------------------------------------------------------------
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = v => (v==null?'–':nf1.format(v)+'%');
const money = v => (v==null?'–':'$'+nf1.format(v));
const mm = v => (v==null?'–':'$'+nf1.format(v)+' MM');
const mesCorto = lbl => (({'01':'ene','02':'feb','03':'mar','04':'abr','05':'may','06':'jun','07':'jul','08':'ago','09':'sep','10':'oct','11':'nov','12':'dic'})[String(lbl).slice(5,7)]||lbl);
const nice = s => s.charAt(0)+s.slice(1).toLowerCase();

// ============================================================================
//  ENTRYPOINT
// ============================================================================
export async function renderIndicadoresView(container){
  _container = container;
  paintShell();
  if (_mode === 'general') await loadGeneral(); else await loadCentro();
}

function paintShell(){
  _container.innerHTML = `
  <div class="max-w-[1120px] mx-auto">
    <div class="flex items-center justify-between gap-md flex-wrap mb-md">
      <div class="inline-flex rounded-lg border border-surface-variant overflow-hidden">
        <button id="ind_tab_gen" class="px-md py-sm text-body-md ${_mode==='general'?'bg-primary text-on-primary':'text-secondary'}">Consolidado General</button>
        <button id="ind_tab_cen" class="px-md py-sm text-body-md ${_mode==='centro'?'bg-primary text-on-primary':'text-secondary'}">Por Centro</button>
      </div>
      <span class="text-[11px] text-secondary border border-surface-variant rounded-full px-md py-[3px]">Actualización diaria 08:00 · Supabase</span>
    </div>
    <div id="ind_body"></div>
  </div>`;
  document.getElementById('ind_tab_gen').addEventListener('click', ()=>{ if(_mode!=='general'){_mode='general'; renderIndicadoresView(_container);} });
  document.getElementById('ind_tab_cen').addEventListener('click', ()=>{ if(_mode!=='centro'){_mode='centro'; renderIndicadoresView(_container);} });
}
function body(){ return document.getElementById('ind_body'); }

// ============================================================================
//  DATOS
// ============================================================================
async function loadGeneral(){
  body().innerHTML = loadingHTML();
  try {
    if (!_cacheGen){
      const y='2026-01';
      const [ns,tar,mar,ft,sc,con,tie] = await Promise.all([
        supabase.from('v_ind_ns_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_tarifa_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_margen_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_ftercero_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_sin_cobro_centro').select('*'),
        supabase.from('v_ind_consol_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_tiempo_general_mes').select('*').gte('mes_label',y).order('mes_label')
      ]);
      const e = ns.error||tar.error||mar.error||ft.error||sc.error||con.error||tie.error; if(e) throw e;
      _cacheGen = { ns:ns.data||[], tar:tar.data||[], mar:mar.data||[], ft:ft.data||[], sc:sc.data||[], con:con.data||[], tie:tie.data||[] };
    }
    body().innerHTML = generalHTML(_cacheGen);
    ensureTip(); drawGeneral(_cacheGen);
  } catch(e){ body().innerHTML = errorHTML(e); }
}

async function loadCentro(){
  body().innerHTML = loadingHTML();
  try {
    if (!_cacheCen){
      const [ns,tar,mar,spot,dest,tdest,vend,con,tie] = await Promise.all([
        supabase.from('v_ind_ns_grupo_semana').select('*'),
        supabase.from('v_ind_tarifa_grupo_semana').select('*'),
        supabase.from('v_ind_margen_grupo_semana').select('*'),
        supabase.from('v_ind_ns_spot_grupo').select('*'),
        supabase.from('v_ind_ns_destino_grupo').select('*'),
        supabase.from('v_ind_tarifa_destino_grupo').select('*'),
        supabase.from('v_ind_cobro_vendedor_grupo').select('*'),
        supabase.from('v_ind_consol_grupo_semana').select('*'),
        supabase.from('v_ind_tiempo_grupo_mes').select('*')
      ]);
      const e = ns.error||tar.error||mar.error||spot.error||dest.error||tdest.error||vend.error||con.error||tie.error; if(e) throw e;
      _cacheCen = { ns:ns.data||[], tar:tar.data||[], mar:mar.data||[],
        spot:spot.data||[], dest:dest.data||[], tdest:tdest.data||[], vend:vend.data||[],
        con:con.data||[], tie:tie.data||[] };
    }
    const grupos = [...new Set(_cacheCen.ns.map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
    if (!_grupo || grupos.indexOf(_grupo)<0){
      // default: grupo con más líneas evaluadas
      const tot={}; _cacheCen.ns.forEach(r=>{ tot[r.grupo]=(tot[r.grupo]||0)+(r.lineas||0); });
      _grupo = grupos.slice().sort((a,b)=>(tot[b]||0)-(tot[a]||0))[0] || grupos[0];
    }
    body().innerHTML = centroHTML(_cacheCen, grupos, _grupo);
    ensureTip();
    document.getElementById('ind_sel').addEventListener('change', ev=>{ _grupo=ev.target.value; body().innerHTML=centroHTML(_cacheCen,grupos,_grupo); ensureTip(); drawCentro(_cacheCen,_grupo); bindSelect(grupos); });
    drawCentro(_cacheCen, _grupo);
    bindSelect(grupos);
  } catch(e){ body().innerHTML = errorHTML(e); }
}
function bindSelect(grupos){
  const el=document.getElementById('ind_sel'); if(!el) return;
  el.onchange = ev=>{ _grupo=ev.target.value; body().innerHTML=centroHTML(_cacheCen,grupos,_grupo); ensureTip(); drawCentro(_cacheCen,_grupo); bindSelect(grupos); };
}

// ============================================================================
//  HTML · GENERAL
// ============================================================================
function generalHTML(d){
  const nsLast=d.ns[d.ns.length-1]||{}, nsAvgO=avg(d.ns.map(r=>r.otif_pct)), nsAvgF=avg(d.ns.map(r=>r.fillrate_pct)), nsLines=sum(d.ns.map(r=>r.lineas_evaluadas));
  const tarLastClosed=d.tar.length>1?d.tar[d.tar.length-2]:(d.tar[d.tar.length-1]||{});
  const tarAvg=wavg(d.tar.map(r=>[r.tarifa_kg,r.toneladas])), tonAcc=sum(d.tar.map(r=>r.toneladas));
  const marAcc=sum(d.mar.map(r=>r.margen))/1e6, cobAvg=avg(d.mar.map(r=>r.cobertura_pct));
  const scMonto=sum(d.sc.map(r=>r.monto_no_cobrado))/1e6, scEnt=sum(d.sc.map(r=>r.entregas_sin_cobro));
  const worst=d.mar.reduce((a,b)=>(b.margen<(a?a.margen:1e15)?b:a),null)||{};
  const ftLast=lastFT(d.ft);
  return `
    ${card('1 · Nivel de Servicio','OTIF y Fill Rate — evolución mensual',
      tile('OTIF — '+mesCorto(nsLast.mes_label||'')+' (último)',pct(nsLast.otif_pct),'Fill Rate '+pct(nsLast.fillrate_pct))+
      tile('OTIF promedio',pct(nsAvgO),'año cerrado')+
      tile('Fill Rate promedio',pct(nsAvgF),'año cerrado')+
      tile('Líneas evaluadas',nf0.format(nsLines),'acumulado'),
      legend([{n:'OTIF %',c:C.navy},{n:'Fill Rate %',c:C.blue}])+`<div id="g_ns"></div>`)}
    ${card('2 · Pesos por Kilo','Tarifa $/kg y toneladas — evolución mensual',
      tile('Tarifa — '+mesCorto(tarLastClosed.mes_label||'')+' (último)',money(tarLastClosed.tarifa_kg),'$/kg')+
      tile('Tarifa promedio',money(tarAvg),'$/kg · ponderado')+
      tile('Toneladas',nf0.format(tonAcc)+' t','acumulado')+
      tile('Peor mes margen',mm(worst.margen/1e6),mesCorto(worst.mes_label||'')),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Tarifa $/kg',c:C.orange}])+`<div id="g_tar"></div></div>`+
      `<div>`+legend([{n:'Toneladas (t)',c:C.blue}])+`<div id="g_ton"></div></div></div>`)}
    ${card('3 · Margen Cobrado vs Pagado','Margen de flete ($MM) y cobertura — evolución mensual',
      tile('Margen acumulado',mm(marAcc),'excl. EbemaClick',marAcc<0?'text-[#EE1B22]':'')+
      tile('Cobertura promedio',pct(cobAvg),'cobrado / pagado')+
      tile('Sin cobrar (red)',mm(scMonto),nf0.format(scEnt)+' entregas','text-[#EE1B22]')+
      tile('Peor mes',mm(worst.margen/1e6),mesCorto(worst.mes_label||''),'text-[#EE1B22]'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Margen $MM',c:C.red}])+`<div id="g_mar"></div></div>`+
      `<div>`+legend([{n:'Cobertura %',c:C.navy}])+`<div id="g_cob"></div></div></div>`)}
    ${card('4 · Flete Tercero (REVEX)','OTIF por modalidad — CD → sucursal → cliente',
      tile('OTIF Despacha',pct(ftLast.despO),(ftLast.despN||0)+' pedidos')+
      tile('OTIF Retira',pct(ftLast.retiO),(ftLast.retiN||0)+' pedidos')+
      tile('Pedidos',nf0.format(sum(d.ft.map(r=>r.pedidos))),'período')+
      tile('Ciclo Despacha',(ftLast.despCiclo!=null?nf1.format(ftLast.despCiclo)+' d':'–'),'último mes'),
      legend([{n:'Despacha',c:C.navy},{n:'Retira',c:C.orange}])+`<div id="g_ft"></div>`)}
    ${card('5 · Operación','Consolidación de camión y tiempo de facturación — mensual',
      tile('Consolidación — '+mesCorto((d.con[d.con.length-2]||d.con[d.con.length-1]||{}).mes_label||''),pct((d.con[d.con.length-2]||d.con[d.con.length-1]||{}).consol_pct),'% capacidad usada')+
      tile('Consolidación promedio',pct(avg(d.con.map(r=>r.consol_pct))),'año')+
      tile('Días entrega→transporte',(function(){var r=d.tie[d.tie.length-2]||d.tie[d.tie.length-1]||{};return r.dias_prom!=null?nf1.format(r.dias_prom)+' d':'–';})(),'último mes')+
      tile('Días promedio',(function(){var v=avg(d.tie.map(r=>r.dias_prom));return v!=null?nf1.format(v)+' d':'–';})(),'año'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Consolidación %',c:C.green}])+`<div id="g_consol"></div></div>`+
      `<div>`+legend([{n:'Días entrega→transporte',c:C.blue}])+`<div id="g_tiempo"></div></div></div>`)}

    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Datos en vivo de <code>v_ind_*</code> (Supabase, 08:00). OTIF/Fill hasta el último mes cerrado; tarifa, margen y operación incluyen agosto parcial. Consolidación = Σpeso ÷ (capacidad×1000) por viaje. Días = fecha transporte − fecha entrega (0–120).</div>`;
}

// ============================================================================
//  HTML · CENTRO
// ============================================================================
function centroHTML(d, grupos, grupo){
  const ns=weeks(d.ns.filter(r=>r.grupo===grupo));
  const tar=weeks(d.tar.filter(r=>r.grupo===grupo));
  const mar=weeks(d.mar.filter(r=>r.grupo===grupo));
  const nsLast=ns[ns.length-1]||{}, nsPrev=ns[ns.length-2]||{};
  const tarLast=tar[tar.length-1]||{}, marLast=mar[mar.length-1]||{};
  const opciones=grupos.map(g=>`<option value="${g}" ${g===grupo?'selected':''}>${nice(g)}</option>`).join('');
  const dOtif = (nsLast.otif_pct!=null&&nsPrev.otif_pct!=null)? (nsLast.otif_pct-nsPrev.otif_pct):null;
  return `
    <div class="flex items-center gap-md mb-md flex-wrap">
      <label class="text-secondary text-body-md">Centro:</label>
      <select id="ind_sel" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface">${opciones}</select>
      <span class="text-[12px] text-secondary">Ventana: últimas semanas cerradas (semana móvil)</span>
    </div>

    ${card('1 · Nivel de Servicio','OTIF y Fill Rate — '+nice(grupo),
      tile('OTIF — '+(nsLast.semana||'')+' (última)',pct(nsLast.otif_pct),'Fill Rate '+pct(nsLast.fillrate_pct))+
      tile('Variación OTIF',(dOtif==null?'–':(dOtif>0?'+':'')+nf1.format(dOtif)+' pp'),'vs semana previa',dOtif!=null&&dOtif<0?'text-[#EE1B22]':'text-[#1E8449]')+
      tile('OTIF promedio',pct(avg(ns.map(r=>r.otif_pct))),'ventana')+
      tile('Líneas evaluadas',nf0.format(sum(ns.map(r=>r.lineas))),'ventana'),
      legend([{n:'OTIF %',c:C.navy},{n:'Fill Rate %',c:C.blue}])+`<div id="c_ns"></div>`)}

    ${card('2 · Pesos por Kilo','Tarifa $/kg y toneladas — '+nice(grupo),
      tile('Tarifa — '+(tarLast.semana||''),money(tarLast.tarifa_kg),'$/kg')+
      tile('Tarifa promedio',money(wavg(tar.map(r=>[r.tarifa_kg,r.toneladas]))),'$/kg · ponderado')+
      tile('Toneladas — '+(tarLast.semana||''),nf0.format(tarLast.toneladas||0)+' t','semana')+
      tile('Toneladas ventana',nf0.format(sum(tar.map(r=>r.toneladas)))+' t','acum. ventana'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Tarifa $/kg',c:C.orange}])+`<div id="c_tar"></div></div>`+
      `<div>`+legend([{n:'Toneladas (t)',c:C.blue}])+`<div id="c_ton"></div></div></div>`)}

    ${card('3 · Margen Cobrado vs Pagado','Margen ($MM) y cobertura — '+nice(grupo),
      tile('Margen — '+(marLast.semana||''),mm(marLast.margen/1e6),'semana',(marLast.margen||0)<0?'text-[#EE1B22]':'')+
      tile('Cobertura — '+(marLast.semana||''),pct(marLast.cobertura_pct),'semana')+
      tile('Cobertura promedio',pct(avg(mar.map(r=>r.cobertura_pct))),'ventana')+
      tile('Margen ventana',mm(sum(mar.map(r=>r.margen))/1e6),'acum. ventana',(sum(mar.map(r=>r.margen))<0)?'text-[#EE1B22]':''),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Margen $MM',c:C.red}])+`<div id="c_mar"></div></div>`+
      `<div>`+legend([{n:'Cobertura %',c:C.navy}])+`<div id="c_cob"></div></div></div>`)}

    ${card('4 · Ranking de Centros','Última semana cerrada — de peor a mejor',
      '',
      `<div class="grid grid-cols-1 md:grid-cols-3 gap-md">`+
      `<div>`+legend([{n:'OTIF % ('+lastWeek(d.ns)+')',c:C.navy}])+`<div id="r_otif"></div></div>`+
      `<div>`+legend([{n:'Tarifa $/kg ('+lastWeek(d.tar)+')',c:C.orange}])+`<div id="r_tar"></div></div>`+
      `<div>`+legend([{n:'Margen $MM ('+lastWeek(d.mar)+')',c:C.red}])+`<div id="r_mar"></div></div></div>`)}

    ${card('5 · Detalle del Centro — '+nice(grupo),'Spot vs Planificado · comunas críticas · cumplimiento de cobro','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">
        <div>`+legend([{n:'OTIF % por tipo de despacho',c:C.navy}])+`<div id="c_spot"></div></div>
        <div>`+legend([{n:'OTIF % · peores comunas (ventana)',c:C.red}])+`<div id="c_peor"></div></div>
        <div>`+legend([{n:'Tarifa $/kg · comunas más caras (≥10 t)',c:C.orange}])+`<div id="c_caro"></div></div>
        <div>`+vendTablaHTML(d.vend, grupo)+`</div>
      </div>`)}

    ${card('6 · Operación — '+nice(grupo),'Consolidación de camión (semanal) y tiempo de facturación (mensual)',
      (function(){ var cw=weeks((d.con||[]).filter(r=>r.grupo===grupo)); var cl=cw[cw.length-1]||{};
        var tm=(d.tie||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1); var tl=tm[tm.length-1]||{};
        return tile('Consolidación — '+(cl.semana||''),pct(cl.consol_pct),'% capacidad')+
          tile('Consolidación promedio',pct(avg(cw.map(r=>r.consol_pct))),'ventana')+
          tile('Días — '+(tl.mes_label?mesCorto(tl.mes_label):''),(tl.dias_prom!=null?nf1.format(tl.dias_prom)+' d':'–'),'entrega→transp.')+
          tile('Días promedio',(function(){var v=avg(tm.map(r=>r.dias_prom));return v!=null?nf1.format(v)+' d':'–';})(),'año'); })(),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Consolidación %',c:C.green}])+`<div id="c_consol"></div></div>`+
      `<div>`+legend([{n:'Días entrega→transporte',c:C.blue}])+`<div id="c_tiempo"></div></div></div>`)}

    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Centro = grupo de origen (Centro Origen). OTIF por semana ISO llega al último mes cerrado; tarifa, margen y operación a la fecha más reciente. Comuna = 2º tramo de la ruta. Consolidación = Σpeso ÷ (capacidad×1000) por viaje. Planta C&D y Electrosoldado se agrupan en Santiago.</div>`;
}

function vendTablaHTML(rows, grupo){
  const v = (rows||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=> (a.brecha||0)-(b.brecha||0)).slice(0,6);
  if (!v.length) return legend([{n:'Cumplimiento de cobro por vendedor',c:C.navy}])+`<div class="text-secondary text-[12px] py-md">Sin datos en la ventana.</div>`;
  const filas = v.map(r=>`<tr class="border-t border-surface-variant">
    <td class="py-[4px] pr-sm">${r.vendedor||'—'}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums ${(r.brecha||0)<0?'text-[#EE1B22]':''}">${mm((r.brecha||0)/1e6)}</td>
    <td class="py-[4px] text-right tabular-nums">${pct(r.cumplimiento_pct)}</td></tr>`).join('');
  return legend([{n:'Cumplimiento de cobro por vendedor (los que más subcobran)',c:C.navy}])+
    `<table class="w-full text-[12px]"><thead><tr class="text-secondary text-left">
      <th class="font-medium pb-[4px]">Vendedor</th><th class="font-medium text-right pb-[4px]">Brecha</th><th class="font-medium text-right pb-[4px]">Cumpl.</th></tr></thead>
      <tbody>${filas}</tbody></table>`;
}

// ============================================================================
//  DIBUJO
// ============================================================================
const W=560,H=210,PL=46,PR=14,PT=14,PB=26;
function px(i,n){return PL+(W-PL-PR)*(n===1?0.5:i/(n-1));}
function bx(i,n){var w=(W-PL-PR)/n;return PL+w*i+w/2;}
function py(v,mn,mx){return PT+(H-PT-PB)*(1-(v-mn)/(mx-mn));}
function gridY(out,mn,mx,fmt){for(var t=0;t<=4;t++){var val=mn+(mx-mn)*t/4,y=py(val,mn,mx);out.push('<line x1="'+PL+'" y1="'+y.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+y.toFixed(1)+'" stroke="'+C.grid+'" stroke-width="1"/>');out.push('<text x="'+(PL-6)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" fill="'+C.muted+'" font-size="10">'+fmt(val)+'</text>');}}
function xLabels(out,labels){for(var i=0;i<labels.length;i++)out.push('<text x="'+bx(i,labels.length).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle" fill="'+C.muted+'" font-size="9.5">'+labels[i]+'</text>');}
function svgOpen(){return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;overflow:visible" role="img">';}

function lineChart(elId,series,labels,mn,mx,unit){
  var el=document.getElementById(elId); if(!el) return;
  var out=[svgOpen()]; gridY(out,mn,mx,function(v){return Math.round(v);});
  out.push('<line x1="'+PL+'" y1="'+(H-PB)+'" x2="'+(W-PR)+'" y2="'+(H-PB)+'" stroke="'+C.grid+'" stroke-width="1"/>');
  for(var s=0;s<series.length;s++){var ser=series[s],d='';
    for(var i=0;i<ser.v.length;i++){var X=px(i,ser.v.length),Y=py(ser.v[i],mn,mx);d+=(i?'L':'M')+X.toFixed(1)+' '+Y.toFixed(1)+' ';}
    out.push('<path d="'+d+'" fill="none" stroke="'+ser.c+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    for(var j=0;j<ser.v.length;j++)out.push('<circle cx="'+px(j,ser.v.length).toFixed(1)+'" cy="'+py(ser.v[j],mn,mx).toFixed(1)+'" r="3.4" fill="'+ser.c+'" stroke="#fff" stroke-width="1.5" data-t="'+ser.n+' '+labels[j]+': '+nf1.format(ser.v[j])+unit+'"/>');
  }
  xLabels(out,labels); out.push('</svg>'); el.innerHTML=out.join(''); bind(el);
}
function barChart(elId,vals,labels,mn,mx,color,unit,part,tickFmt){
  var el=document.getElementById(elId); if(!el) return;
  var out=[svgOpen()]; gridY(out,mn,mx,tickFmt||function(v){return Math.round(v);});
  var zeroY=py(0,mn,mx);
  out.push('<line x1="'+PL+'" y1="'+zeroY.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+zeroY.toFixed(1)+'" stroke="'+C.grid+'" stroke-width="1"/>');
  var bw=(W-PL-PR)/vals.length*0.6;
  for(var i=0;i<vals.length;i++){var v=vals[i],y=py(v,mn,mx),top=Math.min(y,zeroY),h=Math.max(Math.abs(y-zeroY),1);
    var op=(part!=null&&i>=part)?'0.5':'1',extra=(part!=null&&i>=part)?' (parcial)':'';
    out.push('<rect x="'+(bx(i,vals.length)-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" fill="'+color+'" opacity="'+op+'" data-t="'+labels[i]+': '+nf1.format(v)+unit+extra+'"/>');
  }
  xLabels(out,labels); out.push('</svg>'); el.innerHTML=out.join(''); bind(el);
}
// Ranking horizontal
function hbarChart(elId,items,color,unit,hlLabel){
  var el=document.getElementById(elId); if(!el) return;
  var n=items.length, rowH=Math.max(16,(H-8)/Math.max(n,1)), lblW=96;
  var vals=items.map(it=>it.value), mx=Math.max.apply(null,vals.concat([0])), mn=Math.min.apply(null,vals.concat([0]));
  var span=(mx-mn)||1, x0=lblW, xw=W-lblW-40;
  var zero=x0+(0-mn)/span*xw;
  var out=['<svg viewBox="0 0 '+W+' '+(rowH*n+6)+'" style="width:100%;height:auto;overflow:visible" role="img">'];
  for(var i=0;i<n;i++){var it=items[i],y=i*rowH+3,bxx=x0+(it.value-mn)/span*xw;
    var left=Math.min(zero,bxx),w=Math.max(Math.abs(bxx-zero),1);
    var hl=(it.label===hlLabel);
    out.push('<text x="'+(lblW-6)+'" y="'+(y+rowH*0.62).toFixed(1)+'" text-anchor="end" fill="'+(hl?C.ink:C.muted)+'" font-size="10.5" font-weight="'+(hl?'700':'400')+'">'+it.label+'</text>');
    out.push('<rect x="'+left.toFixed(1)+'" y="'+(y+2).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+(rowH-6).toFixed(1)+'" rx="2.5" fill="'+color+'" opacity="'+(hl?'1':'0.55')+'" data-t="'+it.label+': '+nf1.format(it.value)+unit+'"/>');
    out.push('<text x="'+(bxx+ (it.value>=0?4:-4)).toFixed(1)+'" y="'+(y+rowH*0.62).toFixed(1)+'" text-anchor="'+(it.value>=0?'start':'end')+'" fill="'+C.muted+'" font-size="9.5">'+nf1.format(it.value)+'</text>');
  }
  out.push('</svg>'); el.innerHTML=out.join(''); bind(el);
}

function drawGeneral(d){
  const nsL=d.ns.map(r=>mesCorto(r.mes_label));
  lineChart('g_ns',[{n:'OTIF',v:d.ns.map(r=>r.otif_pct),c:C.navy},{n:'Fill',v:d.ns.map(r=>r.fillrate_pct),c:C.blue}],nsL,60,100,'%');
  const tarL=d.tar.map(r=>mesCorto(r.mes_label)), pIdx=d.tar.length-1;
  barChart('g_tar',d.tar.map(r=>r.tarifa_kg),tarL,0,niceMax(d.tar.map(r=>r.tarifa_kg)),C.orange,' $/kg',pIdx,v=>'$'+Math.round(v));
  barChart('g_ton',d.tar.map(r=>r.toneladas),tarL,0,niceMax(d.tar.map(r=>r.toneladas)),C.blue,' t',pIdx,v=>Math.round(v/1000)+'k');
  const marL=d.mar.map(r=>mesCorto(r.mes_label)), marV=d.mar.map(r=>r.margen/1e6);
  barChart('g_mar',marV,marL,Math.min(-2,niceMin(marV)),2,C.red,' MM',d.mar.length-1,v=>'$'+Math.round(v));
  lineChart('g_cob',[{n:'Cobertura',v:d.mar.map(r=>r.cobertura_pct),c:C.navy}],marL,60,100,'%');
  const ftBy=groupFT(d.ft);
  lineChart('g_ft',[{n:'Despacha',v:ftBy.desp,c:C.navy},{n:'Retira',v:ftBy.reti,c:C.orange}],ftBy.labels,0,100,'%');
  const conL=d.con.map(r=>mesCorto(r.mes_label));
  barChart('g_consol',d.con.map(r=>r.consol_pct),conL,0,100,C.green,'%',d.con.length-1,v=>Math.round(v));
  const tieL=d.tie.map(r=>mesCorto(r.mes_label));
  barChart('g_tiempo',d.tie.map(r=>r.dias_prom),tieL,0,niceMax(d.tie.map(r=>r.dias_prom)),C.blue,' d',d.tie.length-1,v=>Math.round(v));
}

function drawCentro(d, grupo){
  const ns=weeks(d.ns.filter(r=>r.grupo===grupo));
  const tar=weeks(d.tar.filter(r=>r.grupo===grupo));
  const mar=weeks(d.mar.filter(r=>r.grupo===grupo));
  lineChart('c_ns',[{n:'OTIF',v:ns.map(r=>r.otif_pct),c:C.navy},{n:'Fill',v:ns.map(r=>r.fillrate_pct),c:C.blue}],ns.map(r=>r.semana.replace('2026-','')),0,100,'%');
  barChart('c_tar',tar.map(r=>r.tarifa_kg),tar.map(r=>r.semana.replace('2026-','')),0,niceMax(tar.map(r=>r.tarifa_kg)),C.orange,' $/kg',null,v=>'$'+Math.round(v));
  barChart('c_ton',tar.map(r=>r.toneladas),tar.map(r=>r.semana.replace('2026-','')),0,niceMax(tar.map(r=>r.toneladas)),C.blue,' t',null,v=>Math.round(v)+'');
  const marV=mar.map(r=>r.margen/1e6);
  barChart('c_mar',marV,mar.map(r=>r.semana.replace('2026-','')),Math.min(-0.5,niceMin(marV)),Math.max(0.5,niceMax(marV)),C.red,' MM',null,v=>nf1.format(v));
  lineChart('c_cob',[{n:'Cobertura',v:mar.map(r=>r.cobertura_pct),c:C.navy}],mar.map(r=>r.semana.replace('2026-','')),0,100,'%');
  // Rankings (última semana cerrada de cada familia)
  const hl=nice(grupo);
  hbarChart('r_otif',rankLast(d.ns,'otif_pct',true).map(r=>({label:nice(r.grupo),value:r.otif_pct})),C.navy,'%',hl);
  hbarChart('r_tar',rankLast(d.tar,'tarifa_kg',false).map(r=>({label:nice(r.grupo),value:r.tarifa_kg})),C.orange,' $/kg',hl);
  hbarChart('r_mar',rankLast(d.mar,'margen',true).map(r=>({label:nice(r.grupo),value:r.margen/1e6})),C.red,' MM',hl);
  // Detalle: spot vs planificado, peores comunas, comunas más caras
  const sp=(d.spot||[]).filter(r=>r.grupo===grupo && r.tipo!=='(s/i)').sort((a,b)=> a.tipo<b.tipo?-1:1);
  barChart('c_spot',sp.map(r=>r.otif_pct),sp.map(r=>r.tipo),0,100,C.navy,'%',null,v=>Math.round(v));
  const peor=(d.dest||[]).filter(r=>r.grupo===grupo && (r.lineas||0)>=5 && r.otif_pct!=null).sort((a,b)=>a.otif_pct-b.otif_pct).slice(0,8);
  hbarChart('c_peor',peor.map(r=>({label:r.destino,value:r.otif_pct})),C.red,'%','');
  const caro=(d.tdest||[]).filter(r=>r.grupo===grupo && (r.toneladas||0)>=10 && r.tarifa_kg!=null).sort((a,b)=>b.tarifa_kg-a.tarifa_kg).slice(0,8);
  hbarChart('c_caro',caro.map(r=>({label:r.destino,value:r.tarifa_kg})),C.orange,' $/kg','');
  // Operación
  const cw=weeks((d.con||[]).filter(r=>r.grupo===grupo));
  barChart('c_consol',cw.map(r=>r.consol_pct),cw.map(r=>r.semana.replace('2026-','')),0,100,C.green,'%',null,v=>Math.round(v));
  const tm=(d.tie||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  barChart('c_tiempo',tm.map(r=>r.dias_prom),tm.map(r=>mesCorto(r.mes_label)),0,niceMax(tm.map(r=>r.dias_prom)),C.blue,' d',null,v=>Math.round(v));
}

// ============================================================================
//  UI helpers
// ============================================================================
function card(title,lead,tiles,chartsHTML){
  return `<section class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md md:p-lg mb-lg">
    <div class="text-label-caps text-secondary uppercase mb-1">${title}</div>
    <div class="text-headline-sm font-bold mb-md">${lead}</div>
    ${tiles?`<div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div>`:''}
    ${chartsHTML}</section>`;
}
function tile(k,v,d,cls=''){
  return `<div class="bg-surface-container-low border border-surface-variant rounded-lg px-md py-sm">
    <div class="text-[11px] text-secondary">${k}</div>
    <div class="text-2xl font-bold leading-tight ${cls}">${v}</div>
    <div class="text-[11px] text-secondary mt-[2px]">${d||''}</div></div>`;
}
function legend(items){
  return `<div class="flex flex-wrap gap-md text-[12px] text-secondary mb-sm">`+
    items.map(i=>`<span class="inline-flex items-center gap-[6px]"><span style="width:10px;height:10px;border-radius:2px;background:${i.c};display:inline-block"></span>${i.n}</span>`).join('')+`</div>`;
}

// ============================================================================
//  TOOLTIP
// ============================================================================
let _tip;
function ensureTip(){
  if (_tip && document.body.contains(_tip)) return;
  _tip=document.createElement('div');
  _tip.style.cssText='position:fixed;pointer-events:none;background:#111;color:#fff;font-size:11.5px;padding:6px 9px;border-radius:7px;opacity:0;transition:opacity .08s;z-index:9999;white-space:nowrap';
  document.body.appendChild(_tip);
}
function bind(el){
  el.querySelectorAll('[data-t]').forEach(n=>{
    n.addEventListener('mousemove',e=>{ _tip.textContent=n.getAttribute('data-t'); _tip.style.opacity=1;
      let x=e.clientX+12,y=e.clientY+12; if(x>window.innerWidth-190)x=e.clientX-_tip.offsetWidth-12;
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
function niceMax(a){ const m=Math.max.apply(null,a.map(Number).concat([0])); if(m<=0)return 1; const step=m>1000?1000:(m>100?100:(m>10?5:1)); return Math.ceil(m*1.12/step)*step; }
function niceMin(a){ const m=Math.min.apply(null,a.map(Number).concat([0])); return Math.floor(m*1.12); }
function weeks(rows){ return rows.slice().sort((a,b)=> a.semana<b.semana?-1:1).slice(-6); }
function lastWeek(rows){ const w=rows.map(r=>r.semana).sort(); return (w[w.length-1]||'').replace('2026-',''); }
function rankLast(rows,field,asc){
  const w=rows.map(r=>r.semana).sort(), last=w[w.length-1];
  const r=rows.filter(x=>x.semana===last && x.grupo && x.grupo!=='OTROS' && x[field]!=null);
  r.sort((a,b)=> asc? a[field]-b[field] : b[field]-a[field]);
  return r;
}
function lastFT(ft){
  if(!ft.length) return {};
  const last=ft[ft.length-1].mes_label, rows=ft.filter(r=>r.mes_label===last);
  const dsp=rows.find(r=>r.modalidad==='Despacha')||{}, ret=rows.find(r=>r.modalidad==='Retira')||{};
  return { despO:dsp.otif_pct, despN:dsp.pedidos, despCiclo:dsp.ciclo_prom_dias, retiO:ret.otif_pct, retiN:ret.pedidos };
}
function groupFT(ft){
  const labels=[...new Set(ft.map(r=>r.mes_label))].sort();
  const desp=labels.map(l=>{const r=ft.find(x=>x.mes_label===l&&x.modalidad==='Despacha');return r?r.otif_pct:0;});
  const reti=labels.map(l=>{const r=ft.find(x=>x.mes_label===l&&x.modalidad==='Retira');return r?r.otif_pct:0;});
  return { labels:labels.map(mesCorto), desp, reti };
}

// ============================================================================
//  ESTADOS
// ============================================================================
function loadingHTML(){
  return `<div class="flex justify-center items-center py-2xl text-secondary"><div class="text-center">
    <div class="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mx-auto mb-md"></div>
    <div>Cargando indicadores…</div></div></div>`;
}
function errorHTML(e){
  return `<div class="max-w-[720px] mx-auto bg-error-container text-on-error-container rounded-xl p-lg">
    <div class="font-bold mb-1">No se pudieron cargar los indicadores</div>
    <div class="text-body-md">${(e&&e.message)||e}</div>
    <div class="text-[12px] mt-sm">Verifica tu sesión (rol reconocido) o la carga 08:00 (tabla <code>ind_log</code>).</div></div>`;
}
