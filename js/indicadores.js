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
// Paleta Consolidado: solo tonos rojos y grises
const R = {
  red:'#C0000C', red2:'#EE1B22', redL:'#E88A8F',
  grey:'#6B6E70', greyL:'#A9ACAE', ink:'#333333', grid:'#D9D5CF'
};
// Semáforo rojo→gris para heatmaps del Consolidado
function tintRG(t){ const s=['#F2EFEC','#F7D6D8','#EFAEB2','#E58990','#D9636B']; t=Math.min(1,Math.max(0,t)); return s[Math.min(s.length-1,Math.floor(t*s.length))]; }
function heatConsolRG(v){ return tintRG((v||0)/100); }
function heatTarRG(v){ return tintRG(Math.min(1,(v||0)/60)); }

// --- Estado -----------------------------------------------------------------
let _container = null;
let _mode = 'general';        // 'general' | 'centro'
let _grupo = null;            // grupo seleccionado en modo centro
let _cacheGen = null;         // datos generales
let _cacheCen = null;         // datos por grupo

let _view = 'consolidado';    // consolidado | nivel | tarifa | margen
export function setIndicadoresSubTab(sub){
  if (['consolidado','nivel','tarifa','margen'].indexOf(sub) >= 0) _view = sub;
  else if (sub === 'centro' || sub === 'general') _mode = sub;
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
  if (_view === 'nivel')  return renderNivel(container);
  if (_view === 'tarifa') return renderTarifa(container);
  if (_view === 'margen') return renderMargen(container);
  paintShell();
  await loadGeneral();
}

function renderStub(container, titulo){
  container.innerHTML = `<div class="max-w-[1120px] mx-auto">
    <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg text-center text-secondary">
      <div class="text-headline-sm font-bold text-on-surface mb-1">${titulo} — vista de detalle</div>
      <div class="text-body-md">En desarrollo. El detalle de Nivel de Servicio ya está disponible; Tarifa y Margen se construyen en la próxima iteración.</div>
      <div class="text-[12px] mt-sm">Mientras tanto, revisa el <b>Consolidado</b> y el <b>HOME</b>.</div>
    </div></div>`;
}

function paintShell(){
  _container.innerHTML = `
  <div class="max-w-[1120px] mx-auto">
    <div class="flex items-center justify-between gap-md flex-wrap mb-md">
      <div class="text-headline-sm font-bold">Consolidado General</div>
      <span class="text-[11px] text-secondary border border-surface-variant rounded-full px-md py-[3px]">Actualización diaria 08:00 · Supabase</span>
    </div>
    <div id="ind_body"></div>
  </div>`;
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
      const [ns,tar,mar,ft,sc,con,tie,scm,nsm,tarm] = await Promise.all([
        supabase.from('v_ind_ns_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_tarifa_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_margen_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_ftercero_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_sin_cobro_centro').select('*'),
        supabase.from('v_ind_consol_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_tiempo_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_sin_cobro_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_ns_grupo_mes').select('*').gte('mes_label',y),
        supabase.from('v_ind_troncal_quilicura_mes').select('*').gte('mes_label',y)
      ]);
      const e = ns.error||tar.error||mar.error||ft.error||sc.error||con.error||tie.error||scm.error||nsm.error||tarm.error; if(e) throw e;
      _cacheGen = { ns:ns.data||[], tar:tar.data||[], mar:mar.data||[], ft:ft.data||[], sc:sc.data||[], con:con.data||[], tie:tie.data||[], scm:scm.data||[], nsm:nsm.data||[], tq:tarm.data||[] };
    }
    body().innerHTML = generalHTML(_cacheGen);
    ensureTip(); drawGeneral(_cacheGen); sweepHeat();
  } catch(e){ body().innerHTML = errorHTML(e); }
}

async function loadCentro(){
  body().innerHTML = loadingHTML();
  try {
    if (!_cacheCen){
      const [ns,tar,mar,spot,dest,tdest,vend,con,tie,scm] = await Promise.all([
        supabase.from('v_ind_ns_grupo_semana').select('*'),
        supabase.from('v_ind_tarifa_grupo_semana').select('*'),
        supabase.from('v_ind_margen_grupo_semana').select('*'),
        supabase.from('v_ind_ns_spot_grupo').select('*'),
        supabase.from('v_ind_ns_destino_grupo').select('*'),
        supabase.from('v_ind_tarifa_destino_grupo').select('*'),
        supabase.from('v_ind_cobro_vendedor_grupo').select('*'),
        supabase.from('v_ind_consol_grupo_semana').select('*'),
        supabase.from('v_ind_tiempo_grupo_mes').select('*'),
        supabase.from('v_ind_sin_cobro_grupo_mes').select('*')
      ]);
      const e = ns.error||tar.error||mar.error||spot.error||dest.error||tdest.error||vend.error||con.error||tie.error||scm.error; if(e) throw e;
      _cacheCen = { ns:ns.data||[], tar:tar.data||[], mar:mar.data||[],
        spot:spot.data||[], dest:dest.data||[], tdest:tdest.data||[], vend:vend.data||[],
        con:con.data||[], tie:tie.data||[], scm:scm.data||[] };
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
  const _curM=mesEnCurso();
  const nsCur=d.ns.find(r=>r.mes_label===_curM)||{};
  const nsClosed=d.ns.filter(r=>r.mes_label<_curM);
  const avgOc=avg(nsClosed.map(r=>r.otif_pct)), avgFc=avg(nsClosed.map(r=>r.fillrate_pct));
  const closedRange=nsClosed.length?(mesCorto(nsClosed[0].mes_label)+'–'+mesCorto(nsClosed[nsClosed.length-1].mes_label)):'';
  const tarLastClosed=d.tar.length>1?d.tar[d.tar.length-2]:(d.tar[d.tar.length-1]||{});
  const tarAvg=wavg(d.tar.map(r=>[r.tarifa_kg,r.toneladas])), tonAcc=sum(d.tar.map(r=>r.toneladas));
  const marAcc=sum(d.mar.map(r=>r.margen))/1e6, cobAvg=avg(d.mar.map(r=>r.cobertura_pct));
  const scMonto=sum(d.sc.map(r=>r.monto_no_cobrado))/1e6, scEnt=sum(d.sc.map(r=>r.entregas_sin_cobro));
  const worst=d.mar.reduce((a,b)=>(b.margen<(a?a.margen:1e15)?b:a),null)||{};
  const ftLast=lastFT(d.ft);
  return `
    ${card('1 · Nivel de Servicio — última milla','OTIF y Fill Rate',
      tile('OTIF — promedio cerrado',pct(avgOc),(closedRange||'meses cerrados'))+
      tile('OTIF — '+mesCorto(_curM)+' (en curso)',pct(nsCur.otif_pct),(nsCur.otif_pct==null?'s/ dato en fuente':'parcial'),'opacity-60')+
      tile('Fill — promedio cerrado',pct(avgFc),(closedRange||'meses cerrados'))+
      tile('Fill — '+mesCorto(_curM)+' (en curso)',pct(nsCur.fillrate_pct),(nsCur.fillrate_pct==null?'s/ dato en fuente':'parcial'),'opacity-60'),
      legend([{n:'OTIF %',c:R.red},{n:'Fill Rate %',c:R.grey},{n:'Mes en curso',c:R.greyL}])+`<div id="g_ns"></div>`)}
    ${card('2 · Pesos por Kilo — última milla','Tarifa $/kg y toneladas — evolución mensual (mes en curso suave)',
      tile('Tarifa — '+mesCorto(tarLastClosed.mes_label||'')+' (último)',money(tarLastClosed.tarifa_kg),'$/kg')+
      tile('Tarifa promedio',money(tarAvg),'$/kg · ponderado')+
      tile('Toneladas',nf0.format(tonAcc)+' t','acumulado')+
      tile('Peor mes margen',mm(worst.margen/1e6),mesCorto(worst.mes_label||'')),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Tarifa $/kg',c:R.red2}])+`<div id="g_tar"></div></div>`+
      `<div>`+legend([{n:'Toneladas (t)',c:R.grey}])+`<div id="g_ton"></div></div></div>`)}
    ${card('3 · Margen de Flete — última milla','Margen ($MM) y cobertura — evolución mensual',
      tile('Margen acumulado',mm(marAcc),'excl. EbemaClick',marAcc<0?'text-[#C0000C]':'')+
      tile('Cobertura promedio',pct(cobAvg),'cobrado / pagado')+
      tile('Sin cobrar',mm(scMonto),nf0.format(scEnt)+' entregas','text-[#C0000C]')+
      tile('Peor mes',mm(worst.margen/1e6),mesCorto(worst.mes_label||''),'text-[#C0000C]'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Margen $MM',c:R.red}])+`<div id="g_mar"></div></div>`+
      `<div>`+legend([{n:'Cobertura %',c:R.grey}])+`<div id="g_cob"></div></div></div>`)}
    ${card('3.1 · Flete no cobrado — última milla','Flete pagado no cobrado — evolución mensual',
      tile('No cobrado acumulado',mm(sum(d.scm.map(r=>r.monto))/1e6),'2026','text-[#C0000C]')+
      tile('Entregas sin cobro',nf0.format(sum(d.scm.map(r=>r.entregas))),'acumulado')+
      tile('Líneas',nf0.format(sum(d.scm.map(r=>r.lineas))),'acumulado')+
      (function(){var w=d.scm.reduce((a,b)=>(b.monto>(a?a.monto:-1)?b:a),null)||{};return tile('Peor mes',mm((w.monto||0)/1e6),mesCorto(w.mes_label||''),'text-[#C0000C]');})(),
      legend([{n:'No cobrado $MM',c:R.red2}])+`<div id="g_scm"></div>`)}

    ${card('3c · Troncal Quilicura (CD 1003 → CD destino)','Nivel de consolidación y pesos por kilo por centro destino (reposición NL)','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div><div class="text-[12px] text-secondary mb-1 font-medium">Nivel de consolidación % — intensidad = mayor</div>`+
      heatmapHTML(d.tq,'consol_pct',heatConsolRG,v=>nf1.format(v))+`</div>`+
      `<div><div class="text-[12px] text-secondary mb-1 font-medium">Pesos por kilo $/kg — intensidad = más caro</div>`+
      heatmapHTML(d.tq,'tarifa_kg',heatTarRG,v=>'$'+nf1.format(v))+`</div></div>`)}

    ${card('4 · Flete Tercero (REVEX)','OTIF, pedidos y días por modalidad — evolutivo mensual (red)',
      tile('OTIF Despacha',pct(ftLast.despO),(ftLast.despN||0)+' pedidos')+
      tile('OTIF Retira',pct(ftLast.retiO),(ftLast.retiN||0)+' pedidos')+
      tile('Pedidos',nf0.format(sum(d.ft.map(r=>r.pedidos))),'período')+
      tile('Ciclo Despacha',(ftLast.despCiclo!=null?nf1.format(ftLast.despCiclo)+' d':'–'),'último mes'),
      `<div class="grid grid-cols-1 md:grid-cols-3 gap-md">`+
      `<div>`+legend([{n:'OTIF Despacha',c:R.red},{n:'OTIF Retira',c:R.grey}])+`<div id="g_rev_otif"></div></div>`+
      `<div>`+legend([{n:'Pedidos Despacha',c:R.red},{n:'Pedidos Retira',c:R.grey}])+`<div id="g_rev_ped"></div></div>`+
      `<div>`+legend([{n:'Días Despacha',c:R.red},{n:'Días Retira',c:R.grey}])+`<div id="g_rev_dias"></div></div></div>`)}
    ${card('5 · Operación — última milla','Consolidación de camión y tiempo de facturación — mensual',
      tile('Consolidación — '+mesCorto((d.con[d.con.length-2]||d.con[d.con.length-1]||{}).mes_label||''),pct((d.con[d.con.length-2]||d.con[d.con.length-1]||{}).consol_pct),'% capacidad usada')+
      tile('Consolidación promedio',pct(avg(d.con.map(r=>r.consol_pct))),'año')+
      tile('Días entrega→transporte',(function(){var r=d.tie[d.tie.length-2]||d.tie[d.tie.length-1]||{};return r.dias_prom!=null?nf1.format(r.dias_prom)+' d':'–';})(),'último mes')+
      tile('Días promedio',(function(){var v=avg(d.tie.map(r=>r.dias_prom));return v!=null?nf1.format(v)+' d':'–';})(),'año'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Consolidación %',c:R.red2}])+`<div id="g_consol"></div></div>`+
      `<div>`+legend([{n:'Días entrega→transporte',c:R.grey}])+`<div id="g_tiempo"></div></div></div>`)}

    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Todos los indicadores son de <b>última milla</b> (entregas a cliente); se excluye reposición troncal. El <b>3c</b> es específicamente troncal Quilicura. OTIF/Fill incluyen el mes en curso cuando el archivo de notas de venta lo trae (hoy la fuente llega a julio). Tarifa, margen y operación incluyen el mes en curso parcial.</div>`;
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

    ${card('7 · Entregas sin Cobro — '+nice(grupo),'Flete pagado no cobrado — evolución mensual',
      (function(){ var g=(d.scm||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
        var acum=sum(g.map(r=>r.monto))/1e6, ent=sum(g.map(r=>r.entregas)), li=sum(g.map(r=>r.lineas));
        var w=g.reduce((a,b)=>(b.monto>(a?a.monto:-1)?b:a),null)||{};
        return tile('No cobrado acumulado',mm(acum),'2026','text-[#EE1B22]')+
          tile('Entregas sin cobro',nf0.format(ent),'acumulado')+
          tile('Líneas',nf0.format(li),'acumulado')+
          tile('Peor mes',mm((w.monto||0)/1e6),mesCorto(w.mes_label||''),'text-[#EE1B22]'); })(),
      legend([{n:'No cobrado $MM',c:C.red}])+`<div id="c_scm"></div>`)}

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
//  HEATMAP (matriz centro × mes)
// ============================================================================
function heatOtif(v){ return v>=90?'#C6E0B4':v>=85?'#E2EFDA':v>=80?'#FFF2CC':v>=75?'#FCE4D6':v>=70?'#F8CBAD':'#F4B7B4'; }
function heatTarifa(v){ return v<18?'#C6E0B4':v<24?'#E2EFDA':v<30?'#FFF2CC':v<40?'#FCE4D6':v<55?'#F8CBAD':'#F4B7B4'; }
function heatmapHTML(rows, key, colorFn, fmt){
  if(!rows||!rows.length) return `<div class="text-secondary text-[12px] py-sm">Sin datos.</div>`;
  const months=[...new Set(rows.map(r=>r.mes_label))].sort();
  const grupos=[...new Set(rows.map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
  const map={}; rows.forEach(r=>{ (map[r.grupo]=map[r.grupo]||{})[r.mes_label]=r[key]; });
  const head=`<th class="text-left font-medium text-secondary pr-sm">Centro</th>`+months.map(m=>`<th class="font-medium text-secondary px-[6px] text-center">${mesCorto(m)}</th>`).join('');
  const bodyr=grupos.map(g=>{
    const cells=months.map(m=>{ const v=(map[g]||{})[m];
      return `<td class="text-center px-[6px] py-[3px] tabular-nums" style="background:${v==null?'transparent':colorFn(v)};color:#333">${v==null?'':fmt(v)}</td>`; }).join('');
    return `<tr><td class="pr-sm py-[3px] text-[12px] whitespace-nowrap">${nice(g)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="ind-heat overflow-x-auto"><table class="text-[11px] border-separate" style="border-spacing:2px"><thead><tr>${head}</tr></thead><tbody>${bodyr}</tbody></table></div>`;
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
function valLbl(v){ return Math.abs(v)>=1000? nf0.format(v) : nf1.format(v); }

function lineChart(elId,series,labels,mn,mx,unit,softFrom){
  var el=document.getElementById(elId); if(!el) return;
  if(softFrom==null) softFrom=labels.length;
  var out=[svgOpen()]; gridY(out,mn,mx,function(v){return Math.round(v);});
  out.push('<line x1="'+PL+'" y1="'+(H-PB)+'" x2="'+(W-PR)+'" y2="'+(H-PB)+'" stroke="'+C.grid+'" stroke-width="1"/>');
  for(var s=0;s<series.length;s++){var ser=series[s];
    // trazo por segmentos (rompe en nulos; tramo "en curso" punteado y translúcido)
    for(var i=1;i<ser.v.length;i++){
      if(ser.v[i]==null||ser.v[i-1]==null) continue;
      var X0=px(i-1,ser.v.length),Y0=py(ser.v[i-1],mn,mx),X1=px(i,ser.v.length),Y1=py(ser.v[i],mn,mx);
      var soft=(i>=softFrom);
      out.push('<path d="M'+X0.toFixed(1)+' '+Y0.toFixed(1)+' L'+X1.toFixed(1)+' '+Y1.toFixed(1)+'" fill="none" stroke="'+ser.c+'" stroke-width="2" stroke-linecap="round"'+(soft?' stroke-dasharray="4 3" opacity="0.5"':'')+'/>');
    }
    for(var j=0;j<ser.v.length;j++){ if(ser.v[j]==null) continue;
      var CX=px(j,ser.v.length),CY=py(ser.v[j],mn,mx),op=(j>=softFrom?'0.5':'1');
      out.push('<circle cx="'+CX.toFixed(1)+'" cy="'+CY.toFixed(1)+'" r="3.4" fill="'+ser.c+'" stroke="#fff" stroke-width="1.5" opacity="'+op+'" data-t="'+ser.n+' '+labels[j]+': '+nf1.format(ser.v[j])+unit+(j>=softFrom?' (en curso)':'')+'"/>');
      var lyy=(s===0? CY-7 : CY+13);
      out.push('<text x="'+CX.toFixed(1)+'" y="'+lyy.toFixed(1)+'" text-anchor="middle" fill="'+ser.c+'" font-size="8.5" font-weight="600" opacity="'+op+'">'+nf1.format(ser.v[j])+'</text>');
    }
  }
  xLabels(out,labels); out.push('</svg>'); el.innerHTML=out.join(''); bind(el);
}
// Devuelve etiqueta 'YYYY-MM' del mes en curso
function mesEnCurso(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
// Lista de meses 'YYYY-MM' desde enero del año en curso hasta el mes actual
function mesesPeriodo(){ var d=new Date(), y=d.getFullYear(), n=d.getMonth()+1, a=[]; for(var m=1;m<=n;m++) a.push(y+'-'+String(m).padStart(2,'0')); return a; }
// Agrega el mes en curso (si falta) a las filas ns; marca _curso=true en el slot añadido
function nsConCurso(ns){
  var rows=ns.slice(); var cur=mesEnCurso();
  var have=rows.some(r=>r.mes_label===cur);
  if(!have && rows.length && rows[rows.length-1].mes_label < cur){
    rows.push({mes_label:cur, otif_pct:null, fillrate_pct:null, lineas_evaluadas:null, _curso:true});
  } else if(have){ rows[rows.length-1]._curso=true; }
  return rows;
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
    var lblY=(v>=0? top-3 : top+h+9);
    out.push('<text x="'+bx(i,vals.length).toFixed(1)+'" y="'+lblY.toFixed(1)+'" text-anchor="middle" fill="'+C.ink+'" font-size="8.5" font-weight="600" opacity="'+op+'">'+valLbl(v)+'</text>');
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
  const nsC=nsConCurso(d.ns), nsL=nsC.map(r=>mesCorto(r.mes_label)), softNs=nsC.findIndex(r=>r._curso);
  lineChart('g_ns',[{n:'OTIF',v:nsC.map(r=>r.otif_pct),c:R.red},{n:'Fill',v:nsC.map(r=>r.fillrate_pct),c:R.grey}],nsL,60,100,'%',softNs<0?undefined:softNs);
  const tarL=d.tar.map(r=>mesCorto(r.mes_label)), pIdx=d.tar.length-1;
  barChart('g_tar',d.tar.map(r=>r.tarifa_kg),tarL,0,niceMax(d.tar.map(r=>r.tarifa_kg)),R.red2,' $/kg',pIdx,v=>'$'+Math.round(v));
  barChart('g_ton',d.tar.map(r=>r.toneladas),tarL,0,niceMax(d.tar.map(r=>r.toneladas)),R.grey,' t',pIdx,v=>Math.round(v/1000)+'k');
  const marL=d.mar.map(r=>mesCorto(r.mes_label)), marV=d.mar.map(r=>r.margen/1e6);
  barChart('g_mar',marV,marL,Math.min(-2,niceMin(marV)),2,R.red,' MM',d.mar.length-1,v=>'$'+Math.round(v));
  lineChart('g_cob',[{n:'Cobertura',v:d.mar.map(r=>r.cobertura_pct),c:R.grey}],marL,60,100,'%');
  const fm=[...new Set(d.ft.map(r=>r.mes_label))].sort();
  const ftv=(mod,f)=>fm.map(m=>{const r=d.ft.find(x=>x.mes_label===m&&x.modalidad===mod);return r?(r[f]||0):0;});
  lineChart('g_rev_otif',[{n:'Despacha',v:ftv('Despacha','otif_pct'),c:R.red},{n:'Retira',v:ftv('Retira','otif_pct'),c:R.grey}],fm.map(mesCorto),0,100,'%');
  const _ped=ftv('Despacha','pedidos').concat(ftv('Retira','pedidos'));
  lineChart('g_rev_ped',[{n:'Despacha',v:ftv('Despacha','pedidos'),c:R.red},{n:'Retira',v:ftv('Retira','pedidos'),c:R.grey}],fm.map(mesCorto),0,niceMax(_ped),'');
  const _dias=ftv('Despacha','ciclo_prom_dias').concat(ftv('Retira','ciclo_prom_dias'));
  lineChart('g_rev_dias',[{n:'Despacha',v:ftv('Despacha','ciclo_prom_dias'),c:R.red},{n:'Retira',v:ftv('Retira','ciclo_prom_dias'),c:R.grey}],fm.map(mesCorto),0,niceMax(_dias),' d');
  const conL=d.con.map(r=>mesCorto(r.mes_label));
  barChart('g_consol',d.con.map(r=>r.consol_pct),conL,0,100,R.red2,'%',d.con.length-1,v=>Math.round(v));
  const tieL=d.tie.map(r=>mesCorto(r.mes_label));
  barChart('g_tiempo',d.tie.map(r=>r.dias_prom),tieL,0,niceMax(d.tie.map(r=>r.dias_prom)),R.grey,' d',d.tie.length-1,v=>Math.round(v));
  const scmL=d.scm.map(r=>mesCorto(r.mes_label));
  barChart('g_scm',d.scm.map(r=>r.monto/1e6),scmL,0,niceMax(d.scm.map(r=>r.monto/1e6)),R.red2,' MM',d.scm.length-1,v=>'$'+Math.round(v));
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
  const sm=(d.scm||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  barChart('c_scm',sm.map(r=>r.monto/1e6),sm.map(r=>mesCorto(r.mes_label)),0,niceMax(sm.map(r=>r.monto/1e6)),C.red,' MM',null,v=>'$'+Math.round(v));
}

// ============================================================================
//  UI helpers
// ============================================================================
function card(title,lead,tiles,chartsHTML){
  return `<section data-card class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md md:p-lg mb-lg">
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
  attachExpand(el);
}

// --- Expansor: botón para ampliar cada gráfico en un modal --------------------
let _modal;
function ensureModal(){
  if(_modal && document.body.contains(_modal)) return;
  _modal=document.createElement('div');
  _modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:10000;padding:24px';
  _modal.innerHTML='<div style="background:#fff;border-radius:12px;padding:20px 22px;max-width:1200px;width:96%;max-height:92vh;overflow:auto;position:relative"><button id="ind_modal_close" title="Cerrar" style="position:absolute;top:8px;right:12px;border:none;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#333">×</button><div id="ind_modal_body" style="margin-top:14px"></div></div>';
  document.body.appendChild(_modal);
  _modal.addEventListener('click',e=>{ if(e.target===_modal) _modal.style.display='none'; });
  _modal.querySelector('#ind_modal_close').addEventListener('click',()=>{ _modal.style.display='none'; });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && _modal) _modal.style.display='none'; });
}
function openModal(html){ ensureModal(); _modal.querySelector('#ind_modal_body').innerHTML=html; _modal.style.display='flex'; }
function sweepHeat(){ document.querySelectorAll('.ind-heat').forEach(attachExpand); sweepCards(); }
// Expansor a nivel de CUADRO completo (tiles + gráficos), no solo el gráfico
function sweepCards(){ document.querySelectorAll('section[data-card]').forEach(attachCardExpand); }
function attachCardExpand(sec){
  if(!sec || sec.querySelector(':scope > button.ind-cardexp')) return;
  sec.style.position='relative';
  var btn=document.createElement('button');
  btn.className='ind-cardexp'; btn.textContent='⤢'; btn.title='Ampliar cuadro completo';
  btn.style.cssText='position:absolute;top:8px;right:8px;border:1px solid rgba(11,11,11,.14);background:rgba(255,255,255,.92);border-radius:6px;height:26px;padding:0 8px;font-size:13px;line-height:1;cursor:pointer;color:#333;z-index:4;display:inline-flex;align-items:center;gap:5px';
  btn.innerHTML='⤢ <span style="font-size:11px">Ampliar</span>';
  btn.addEventListener('click',function(ev){ ev.stopPropagation();
    var tmp=sec.cloneNode(true);
    tmp.querySelectorAll('button.ind-exp,button.ind-cardexp').forEach(function(b){b.remove();});
    tmp.style.margin='0'; tmp.style.border='none';
    openModal(tmp.outerHTML);
  });
  sec.appendChild(btn);
}
function attachExpand(el){
  if(!el || el.querySelector(':scope > button.ind-exp')) return;
  el.style.position='relative';
  var btn=document.createElement('button');
  btn.className='ind-exp'; btn.textContent='⤢'; btn.title='Ampliar';
  btn.style.cssText='position:absolute;top:0;right:0;border:1px solid rgba(11,11,11,.12);background:rgba(255,255,255,.9);border-radius:6px;width:24px;height:24px;font-size:14px;line-height:1;cursor:pointer;color:#333;z-index:3';
  btn.addEventListener('click',function(ev){ ev.stopPropagation();
    var tmp=el.cloneNode(true); var b=tmp.querySelector('button.ind-exp'); if(b) b.remove();
    openModal(tmp.innerHTML);
  });
  el.appendChild(btn);
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

// ============================================================================
//  HOME (pantalla principal) — 3 tarjetas resumen
// ============================================================================
export async function renderIndicadoresHome(container){
  container.innerHTML = loadingHTML();
  try {
    const y='2026-01';
    const [ns,tar,mar] = await Promise.all([
      supabase.from('v_ind_ns_general_mes').select('*').gte('mes_label',y).order('mes_label'),
      supabase.from('v_ind_tarifa_general_mes').select('*').gte('mes_label',y).order('mes_label'),
      supabase.from('v_ind_margen_general_mes').select('*').gte('mes_label',y).order('mes_label')
    ]);
    const e=ns.error||tar.error||mar.error; if(e) throw e;
    const D={ns:ns.data||[],tar:tar.data||[],mar:mar.data||[]};
    const nsLast=D.ns[D.ns.length-1]||{}, tarLast=D.tar.length>1?D.tar[D.tar.length-2]:(D.tar[D.tar.length-1]||{}), marAcc=sum(D.mar.map(r=>r.margen))/1e6;
    container.innerHTML=`<div class="max-w-[1120px] mx-auto">
      <div class="text-headline-sm font-bold mb-1">Indicadores de Transporte</div>
      <div class="text-secondary text-body-md mb-md">Resumen mensual 2026 · el <b>mes en curso</b> se muestra en tono más suave. El detalle de cada indicador está en el menú <b>Indicadores</b>.</div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-md">
        ${homeCard('Nivel de Servicio','OTIF '+pct(nsLast.otif_pct),'Fill Rate '+pct(nsLast.fillrate_pct)+' · '+mesCorto(nsLast.mes_label||''),'h_ns',false)}
        ${homeCard('Tarifa $/Kg',money(tarLast.tarifa_kg)+'/kg',mesCorto(tarLast.mes_label||'')+' (último cerrado)','h_tar',false)}
        ${homeCard('Margen de Flete',mm(marAcc),'acumulado 2026 · excl. EbemaClick','h_mar',marAcc<0)}
      </div></div>`;
    ensureTip();
    lineChart('h_ns',[{n:'OTIF',v:D.ns.map(r=>r.otif_pct),c:C.navy},{n:'Fill',v:D.ns.map(r=>r.fillrate_pct),c:C.blue}],D.ns.map(r=>mesCorto(r.mes_label)),60,100,'%');
    barChart('h_tar',D.tar.map(r=>r.tarifa_kg),D.tar.map(r=>mesCorto(r.mes_label)),0,niceMax(D.tar.map(r=>r.tarifa_kg)),C.orange,' $/kg',D.tar.length-1,v=>'$'+Math.round(v));
    barChart('h_mar',D.mar.map(r=>r.margen/1e6),D.mar.map(r=>mesCorto(r.mes_label)),Math.min(-2,niceMin(D.mar.map(r=>r.margen/1e6))),2,C.red,' MM',D.mar.length-1,v=>'$'+Math.round(v));
  } catch(e){ container.innerHTML=errorHTML(e); }
}
function homeCard(titulo,valor,sub,chartId,neg){
  return `<section class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md">
    <div class="text-label-caps text-secondary uppercase mb-1">${titulo}</div>
    <div class="text-2xl font-bold leading-tight ${neg?'text-[#EE1B22]':''}">${valor}</div>
    <div class="text-[11px] text-secondary mb-sm">${sub}</div>
    <div id="${chartId}"></div></section>`;
}

// ============================================================================
//  NIVEL DE SERVICIO — detalle (6 análisis)
// ============================================================================
let _cacheNivel=null, _grupoN=null;
async function renderNivel(container){
  container.innerHTML = loadingHTML();
  try {
    if(!_cacheNivel){
      const [tp,co,com,sp,ft] = await Promise.all([
        supabase.from('v_ind_ns_tipo_grupo').select('*'),
        supabase.from('v_ind_ns_comuna').select('*'),
        supabase.from('v_ind_ns_comuna_mes').select('*'),
        supabase.from('v_ind_ns_spot_grupo_mes').select('*'),
        supabase.from('v_ind_ftercero_mes').select('*').gte('mes_label','2026-01').order('mes_label')
      ]);
      const e=tp.error||co.error||com.error||sp.error||ft.error; if(e) throw e;
      _cacheNivel={tp:tp.data||[],co:co.data||[],com:com.data||[],sp:sp.data||[],ft:ft.data||[]};
    }
    const grupos=[...new Set(_cacheNivel.co.map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
    if(!_grupoN||grupos.indexOf(_grupoN)<0) _grupoN=(grupos.indexOf('CONCEPCION')>=0?'CONCEPCION':grupos[0]);
    container.innerHTML=nivelHTML(_cacheNivel,grupos,_grupoN);
    ensureTip(); drawNivel(_cacheNivel,_grupoN); bindSelN(container,grupos); sweepHeat();
  } catch(e){ container.innerHTML=errorHTML(e); }
}
function bindSelN(container,grupos){
  const el=document.getElementById('ind_seln'); if(!el) return;
  el.onchange=ev=>{ _grupoN=ev.target.value; container.innerHTML=nivelHTML(_cacheNivel,grupos,_grupoN); ensureTip(); drawNivel(_cacheNivel,_grupoN); bindSelN(container,grupos); sweepHeat(); };
}
function nivelHTML(d,grupos,grupo){
  const tp=d.tp.filter(r=>r.grupo===grupo);
  const stock=tp.find(r=>r.tipo==='STOCK')||{}, calz=tp.find(r=>r.tipo==='CALZADA')||{};
  const hayClase=tp.some(r=>r.tipo==='STOCK'||r.tipo==='CALZADA');
  const opciones=grupos.map(g=>`<option value="${g}" ${g===grupo?'selected':''}>${nice(g)}</option>`).join('');
  return `<div class="max-w-[1120px] mx-auto">
    <div class="flex items-center gap-md mb-md flex-wrap">
      <div class="text-headline-sm font-bold">Nivel de Servicio — detalle</div>
      <label class="text-secondary text-body-md ml-auto">Centro:</label>
      <select id="ind_seln" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface">${opciones}</select>
    </div>

    ${card('1 · Tipo de venta — Stock vs Calzada','OTIF y días a entrega por tipo (acumulado)',
      tile('OTIF Stock',pct(stock.otif_pct),(stock.lineas||0)+' líneas')+
      tile('OTIF Calzada',pct(calz.otif_pct),(calz.lineas||0)+' líneas',(calz.otif_pct!=null&&calz.otif_pct<60)?'text-[#EE1B22]':'')+
      tile('Días Stock',(stock.dias_prom!=null?nf1.format(stock.dias_prom)+' d':'–'),'venta→entrega')+
      tile('Días Calzada',(calz.dias_prom!=null?nf1.format(calz.dias_prom)+' d':'–'),'venta→entrega'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'OTIF % por tipo',c:C.navy}])+`<div id="n_tipo_otif"></div></div>`+
      `<div>`+legend([{n:'Días a entrega por tipo',c:C.blue}])+`<div id="n_tipo_dias"></div></div></div>`+
      (hayClase?'':`<div class="text-[11px] text-secondary mt-sm">Stock=ZV01/03/04 · Calzada=ZV08/09. Vacío = falta correr la carga con el Code.gs actualizado (nueva columna Clase Documento).</div>`))}

    ${card('2 · Top comunas por centro — peores y mejores','OTIF por comuna destino en rutas regionales (rutas de una misma comuna se suman)','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'5 peores OTIF %',c:C.red}])+`<div id="n_reg_peor"></div></div>`+
      `<div>`+legend([{n:'5 mejores OTIF %',c:C.green}])+`<div id="n_reg_mejor"></div></div></div>`)}

    ${card('3 · Spot vs Planificado — evolutivo','OTIF mensual por tipo de servicio','',
      legend([{n:'Planificado',c:C.navy},{n:'Spot',c:C.orange}])+`<div id="n_spot"></div>`)}

    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Comuna = comuna destino (routes.comuna); todas las rutas que llegan a una misma comuna se agrupan juntas. Solo rutas de clasificación Regional. Días venta→entrega = fecha guía − fecha creación.</div>
  </div>`;
}
function heatComunaHTML(rows){
  if(!rows.length) return `<div class="text-secondary text-[12px] py-sm">Sin datos.</div>`;
  const months=[...new Set(rows.map(r=>r.mes_label))].sort();
  const tot={}; rows.forEach(r=>{tot[r.comuna]=(tot[r.comuna]||0)+(r.lineas||0);});
  const comunas=Object.keys(tot).sort((a,b)=>tot[b]-tot[a]).slice(0,12);
  const map={}; rows.forEach(r=>{(map[r.comuna]=map[r.comuna]||{})[r.mes_label]=r.otif_pct;});
  const head=`<th class="text-left font-medium text-secondary pr-sm">Comuna</th>`+months.map(m=>`<th class="font-medium text-secondary px-[6px] text-center">${mesCorto(m)}</th>`).join('');
  const bodyr=comunas.map(c=>{
    const cells=months.map(m=>{const v=(map[c]||{})[m];return `<td class="text-center px-[6px] py-[3px] tabular-nums" style="background:${v==null?'transparent':heatOtif(v)};color:#333">${v==null?'':nf1.format(v)}</td>`;}).join('');
    return `<tr><td class="pr-sm py-[3px] text-[12px] whitespace-nowrap">${c}</td>${cells}</tr>`;
  }).join('');
  return `<div class="ind-heat overflow-x-auto"><table class="text-[11px] border-separate" style="border-spacing:2px"><thead><tr>${head}</tr></thead><tbody>${bodyr}</tbody></table></div>`;
}
function drawNivel(d,grupo){
  const tp=d.tp.filter(r=>r.grupo===grupo), order=['STOCK','CALZADA'];
  barChart('n_tipo_otif',order.map(t=>{const r=tp.find(x=>x.tipo===t)||{};return r.otif_pct||0;}),order.map(nice),0,100,C.navy,'%',null,v=>Math.round(v));
  const dv=order.map(t=>{const r=tp.find(x=>x.tipo===t)||{};return r.dias_prom||0;});
  barChart('n_tipo_dias',dv,order.map(nice),0,niceMax(dv),C.blue,' d',null,v=>Math.round(v));
  const reg=d.co.filter(r=>r.grupo===grupo && r.clasif_ruta==='Regional' && r.otif_pct!=null && (r.lineas||0)>=5);
  hbarChart('n_reg_peor',reg.slice().sort((a,b)=>a.otif_pct-b.otif_pct).slice(0,5).map(r=>({label:r.comuna,value:r.otif_pct})),C.red,'%','');
  hbarChart('n_reg_mejor',reg.slice().sort((a,b)=>b.otif_pct-a.otif_pct).slice(0,5).map(r=>({label:r.comuna,value:r.otif_pct})),C.green,'%','');
  const sp=d.sp.filter(r=>r.grupo===grupo), sm=[...new Set(sp.map(r=>r.mes_label))].sort();
  lineChart('n_spot',[
    {n:'Planificado',v:sm.map(m=>{const r=sp.find(x=>x.mes_label===m&&x.tipo==='Planificado');return r?r.otif_pct:0;}),c:C.navy},
    {n:'Spot',v:sm.map(m=>{const r=sp.find(x=>x.mes_label===m&&x.tipo==='Spot');return r?r.otif_pct:0;}),c:C.orange}
  ],sm.map(mesCorto),0,100,'%');
}

// ============================================================================
//  TARIFA (Pesos por Kilo) — detalle
// ============================================================================
let _cacheTar=null, _grupoT=null, _segT='ULTIMA_MILLA';
const SEG_OPTS=[['ULTIMA_MILLA','Última milla'],['TRONCAL','Troncal'],['MIXTO','Mixto'],['TODOS','Todos']];
const segLabel=s=>((SEG_OPTS.find(x=>x[0]===s)||[])[1]||s);
function segSelectHTML(id,val){ return `<label class="text-secondary text-body-md">Segmento:</label>
  <select id="${id}" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface">`+
  SEG_OPTS.map(o=>`<option value="${o[0]}" ${o[0]===val?'selected':''}>${o[1]}</option>`).join('')+`</select>`; }
async function renderTarifa(container){
  container.innerHTML=loadingHTML();
  try{
    if(!_cacheTar){
      const [tm,cap,com,tro,ebc]=await Promise.all([
        supabase.from('v_ind_tarifa_grupo_mes').select('*'),
        supabase.from('v_ind_consol_cap_grupo_mes').select('*'),
        supabase.from('v_ind_tarifa_comuna_grupo').select('*'),
        supabase.from('v_ind_troncal_grupo_mes').select('*'),
        supabase.from('v_ind_ebemaclick_grupo_mes').select('*')
      ]);
      const e=tm.error||cap.error||com.error||tro.error||ebc.error; if(e) throw e;
      _cacheTar={tm:tm.data||[],cap:cap.data||[],com:com.data||[],tro:tro.data||[],ebc:ebc.data||[]};
    }
    const grupos=[...new Set(_cacheTar.tm.map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
    if(!_grupoT||grupos.indexOf(_grupoT)<0) _grupoT=(grupos.indexOf('CONCEPCION')>=0?'CONCEPCION':grupos[0]);
    paintTarifa(container,grupos);
  }catch(e){container.innerHTML=errorHTML(e);}
}
function paintTarifa(container,grupos){
  container.innerHTML=tarifaHTML(_cacheTar,grupos,_grupoT);
  ensureTip(); drawTarifa(_cacheTar,_grupoT); sweepHeat();
  const sel=document.getElementById('ind_selt'); if(sel) sel.onchange=ev=>{_grupoT=ev.target.value; paintTarifa(container,grupos);};
}
function tarifaHTML(d,grupos,grupo){
  const opciones=grupos.map(g=>`<option value="${g}" ${g===grupo?'selected':''}>${nice(g)}</option>`).join('');
  const ebcG=d.ebc.filter(r=>r.grupo===grupo), showEbc=ebcG.length>0;
  const ebcTot={docs:sum(ebcG.map(r=>r.docs)),ton:sum(ebcG.map(r=>r.toneladas)),pag:sum(ebcG.map(r=>r.pagado))/1e6,cob:sum(ebcG.map(r=>r.cobrado))/1e6};
  return `<div class="max-w-[1120px] mx-auto">
    <div class="flex items-center gap-md mb-md flex-wrap">
      <div class="text-headline-sm font-bold">Pesos por Kilo — detalle</div>
      <label class="text-secondary text-body-md ml-auto">Centro:</label>
      <select id="ind_selt" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface">${opciones}</select>
    </div>
    <div class="text-[11px] text-secondary -mt-sm mb-md">Solo <b>última milla</b> (entregas a cliente). Excluye traslados troncales de reposición.</div>
    ${card('1 · Tarifa $/kg y toneladas — evolutivo','Mensual por centro (mes en curso en tono suave)','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Tarifa $/kg',c:C.orange}])+`<div id="t_tar"></div></div>`+
      `<div>`+legend([{n:'Toneladas',c:C.blue}])+`<div id="t_ton"></div></div></div>`)}
    ${card('2 · Consolidación promedio por tipo de camión','Promedio del período · 5 / 10 / 15 / 28 ton','',
      legend([{n:'Consolidación % promedio',c:C.green}])+`<div id="t_cap_avg"></div>`)}
    ${card('3 · Comunas más caras y más baratas','Tarifa $/kg por comuna destino (≥10 t · rutas de una misma comuna se suman)','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'10 más caras',c:C.red}])+`<div id="t_caro"></div></div>`+
      `<div>`+legend([{n:'10 más baratas',c:C.green}])+`<div id="t_barato"></div></div></div>`)}
    ${showEbc?card('4 · Impacto EbemaClick — período (ene → a la fecha)','Financiamiento de la operación EbemaClick en todo el período (docs con V Garrido + material 400141)',
      tile('Documentos',nf0.format(ebcTot.docs),'ene → hoy')+
      tile('Toneladas',nf1.format(ebcTot.ton)+' t','movidas')+
      tile('Flete pagado',mm(ebcTot.pag),'costo operación','text-[#EE1B22]')+
      tile('Financiamiento neto',mm(ebcTot.pag-ebcTot.cob),'pagado − cobrado','text-[#EE1B22]'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Flete pagado $MM',c:C.red},{n:'Cobrado $MM',c:C.navy}])+`<div id="t_ebc"></div></div>`+
      `<div>`+legend([{n:'Financiamiento neto $MM',c:C.orange}])+`<div id="t_ebc_neto"></div></div></div>`):''}
    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Solo última milla (entregas a cliente ZE01/ZE06/ZE20/ZE05/ZE04); se excluyen los traslados troncales de reposición (NL/EL). Comuna = comuna destino (routes.comuna); rutas de una misma comuna se agrupan. EbemaClick = documentos con V Garrido T y material 400141; el cuadro solo aparece en centros con operación EbemaClick.</div>
  </div>`;
}
function drawTarifa(d,grupo){
  const tm=d.tm.filter(r=>r.grupo===grupo && r.segmento===_segT).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  const tmL=tm.map(r=>mesCorto(r.mes_label)), pIdx=tm.length-1;
  barChart('t_tar',tm.map(r=>r.tarifa_kg),tmL,0,niceMax(tm.map(r=>r.tarifa_kg)),C.orange,' $/kg',pIdx,v=>'$'+Math.round(v));
  barChart('t_ton',tm.map(r=>r.toneladas),tmL,0,niceMax(tm.map(r=>r.toneladas)),C.blue,' t',pIdx,v=>Math.round(v));
  const cap=d.cap.filter(r=>r.grupo===grupo && r.segmento===_segT), cm=[...new Set(cap.map(r=>r.mes_label))].sort();
  const caps=[['5',C.navy],['10',C.blue],['15',C.orange],['28',C.red]];
  barChart('t_cap_avg',caps.map(x=>avg(cap.filter(y=>y.cap===x[0]&&y.consol_pct!=null).map(y=>y.consol_pct))||0),caps.map(x=>x[0]+'t'),0,100,C.green,'%',null,v=>Math.round(v));
  const cc=d.com.filter(r=>r.grupo===grupo && r.segmento===_segT && (r.toneladas||0)>=10 && r.tarifa_kg!=null && r.comuna!=='(s/comuna)');
  hbarChart('t_caro',cc.slice().sort((a,b)=>b.tarifa_kg-a.tarifa_kg).slice(0,10).map(r=>({label:r.comuna,value:r.tarifa_kg})),C.red,' $/kg','');
  hbarChart('t_barato',cc.slice().sort((a,b)=>a.tarifa_kg-b.tarifa_kg).slice(0,10).map(r=>({label:r.comuna,value:r.tarifa_kg})),C.green,' $/kg','');
  const ebcG=d.ebc.filter(r=>r.grupo===grupo);
  if(ebcG.length){
    const ebcM=mesesPeriodo();   // ene → mes en curso (todo el período)
    const sumM=(m,f)=>sum(ebcG.filter(x=>x.mes_label===m).map(r=>r[f]||0));
    lineChart('t_ebc',[{n:'Pagado',v:ebcM.map(m=>sumM(m,'pagado')/1e6),c:C.red},{n:'Cobrado',v:ebcM.map(m=>sumM(m,'cobrado')/1e6),c:C.navy}],ebcM.map(mesCorto),0,niceMax(ebcG.map(r=>r.pagado/1e6)),' MM');
    barChart('t_ebc_neto',ebcM.map(m=>(sumM(m,'pagado')-sumM(m,'cobrado'))/1e6),ebcM.map(mesCorto),0,niceMax(ebcG.map(r=>(r.pagado-r.cobrado)/1e6)),C.orange,' MM',null,v=>'$'+nf1.format(v));
  }
}

// ============================================================================
//  MARGEN — detalle
// ============================================================================
let _cacheMar2=null, _grupoM=null, _segM='ULTIMA_MILLA';
async function renderMargen(container){
  container.innerHTML=loadingHTML();
  try{
    if(!_cacheMar2){
      const [mg,sc,vn]=await Promise.all([
        supabase.from('v_ind_margen_grupo_mes').select('*'),
        supabase.from('v_ind_sin_cobro_grupo_mes').select('*'),
        supabase.from('v_ind_vendedor_grupo').select('*')
      ]);
      const e=mg.error||sc.error||vn.error; if(e) throw e;
      _cacheMar2={mg:mg.data||[],sc:sc.data||[],vn:vn.data||[]};
    }
    const grupos=[...new Set(_cacheMar2.mg.map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
    if(!_grupoM||grupos.indexOf(_grupoM)<0) _grupoM=(grupos.indexOf('CONCEPCION')>=0?'CONCEPCION':grupos[0]);
    paintMargen(container,grupos);
  }catch(e){container.innerHTML=errorHTML(e);}
}
function paintMargen(container,grupos){
  container.innerHTML=margenHTML(_cacheMar2,grupos,_grupoM);
  ensureTip(); drawMargen(_cacheMar2,_grupoM); sweepHeat();
  const sel=document.getElementById('ind_selm'); if(sel) sel.onchange=ev=>{_grupoM=ev.target.value; paintMargen(container,grupos);};
}
function margenHTML(d,grupos,grupo){
  const opciones=grupos.map(g=>`<option value="${g}" ${g===grupo?'selected':''}>${nice(g)}</option>`).join('');
  const sc=d.sc.filter(r=>r.grupo===grupo && r.segmento===_segM);
  const scMonto=sum(sc.map(r=>r.monto_sugerido))/1e6, scEnt=sum(sc.map(r=>r.entregas));
  return `<div class="max-w-[1120px] mx-auto">
    <div class="flex items-center gap-md mb-md flex-wrap">
      <div class="text-headline-sm font-bold">Margen de Flete — detalle</div>
      <label class="text-secondary text-body-md ml-auto">Centro:</label>
      <select id="ind_selm" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface">${opciones}</select>
    </div>
    <div class="text-[11px] text-secondary -mt-sm mb-md">Solo <b>última milla</b> (entregas a cliente). Excluye traslados troncales de reposición.</div>
    ${card('1 · Pagado vs Cobrado — evolutivo','Mensual por centro ($MM)','',
      legend([{n:'Cobrado',c:C.navy},{n:'Pagado',c:C.orange}])+`<div id="m_pc"></div>`)}
    ${card('2 · Margen y cobertura — evolutivo','Margen $MM y cobertura % mensual (mes en curso suave)','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Margen $MM',c:C.red}])+`<div id="m_margen"></div></div>`+
      `<div>`+legend([{n:'Cobertura %',c:C.navy}])+`<div id="m_cob"></div></div></div>`)}
    ${card('3 · Flete no cobrado — mensual','Entregas con flete cobrado en 0 (monto sugerido no cobrado)',
      tile('No cobrado (sugerido)',mm(scMonto),'acumulado','text-[#EE1B22]')+
      tile('Entregas sin cobro',nf0.format(scEnt),'acumulado')+
      tile('Líneas',nf0.format(sum(sc.map(r=>r.lineas))),'acumulado')+
      tile('Costo asumido',mm(sum(sc.map(r=>r.monto))/1e6),'flete pagado','text-[#EE1B22]'),
      legend([{n:'No cobrado $MM (sugerido)',c:C.red}])+`<div id="m_scm"></div>`)}
    ${card('4 · Vendedores que cobran menos','Ranking por brecha (cobrado vs sugerido) · costo pagado asociado','',
      vendMargenTablaHTML(d.vn,grupo))}
    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Flete no cobrado = entregas con flete cobrado = 0; monto = flete sugerido (lo que no se cobró). Ranking excluye EbemaClick.</div>
  </div>`;
}
function vendMargenTablaHTML(rows,grupo){
  const v=(rows||[]).filter(r=>r.grupo===grupo && r.segmento===_segM).slice().sort((a,b)=>(a.brecha||0)-(b.brecha||0)).slice(0,10);
  if(!v.length) return `<div class="text-secondary text-[12px] py-md">Sin datos.</div>`;
  const filas=v.map(r=>`<tr class="border-t border-surface-variant">
    <td class="py-[4px] pr-sm">${r.vendedor||'—'}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.sugerido||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.cobrado||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.pagado||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums ${(r.brecha||0)<0?'text-[#EE1B22]':''}">${mm((r.brecha||0)/1e6)}</td>
    <td class="py-[4px] text-right tabular-nums">${pct(r.cumplimiento_pct)}</td></tr>`).join('');
  return `<table class="w-full text-[12px]"><thead><tr class="text-secondary text-left">
    <th class="font-medium pb-[4px]">Vendedor</th><th class="font-medium text-right pb-[4px]">Sugerido</th><th class="font-medium text-right pb-[4px]">Cobrado</th><th class="font-medium text-right pb-[4px]">Pagado</th><th class="font-medium text-right pb-[4px]">Brecha</th><th class="font-medium text-right pb-[4px]">Cumpl.</th></tr></thead><tbody>${filas}</tbody></table>`;
}
function drawMargen(d,grupo){
  const mg=d.mg.filter(r=>r.grupo===grupo && r.segmento===_segM).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  const L=mg.map(r=>mesCorto(r.mes_label)), pIdx=mg.length-1;
  lineChart('m_pc',[{n:'Cobrado',v:mg.map(r=>r.cobrado/1e6),c:C.navy},{n:'Pagado',v:mg.map(r=>r.pagado/1e6),c:C.orange}],L,0,niceMax(mg.map(r=>Math.max(r.cobrado,r.pagado)/1e6)),' MM');
  barChart('m_margen',mg.map(r=>r.margen/1e6),L,Math.min(-1,niceMin(mg.map(r=>r.margen/1e6))),Math.max(1,niceMax(mg.map(r=>r.margen/1e6))),C.red,' MM',pIdx,v=>'$'+nf1.format(v));
  lineChart('m_cob',[{n:'Cobertura',v:mg.map(r=>r.cobertura_pct),c:C.navy}],L,0,120,'%');
  const sc=d.sc.filter(r=>r.grupo===grupo && r.segmento===_segM).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  barChart('m_scm',sc.map(r=>(r.monto_sugerido||0)/1e6),sc.map(r=>mesCorto(r.mes_label)),0,niceMax(sc.map(r=>(r.monto_sugerido||0)/1e6)),C.red,' MM',sc.length-1,v=>'$'+nf1.format(v));
}
