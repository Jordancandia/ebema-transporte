// ============================================================================
//  INDICADORES · Consolidado General + Drill por Centro
//  Nivel de Servicio · Pesos por Kilo · Margen Cobrado vs Pagado · Operación
//  (Flete Tercero se retiró del Consolidado el 28-sep-2026: vive en su propio menú)
//  Lee en vivo las vistas v_ind_* de Supabase (RLS: usuario @ebema.cl con rol).
//  Paleta alineada a las presentaciones (PPT) del Comité de Transporte.
// ============================================================================
import { supabase } from './supabase-client.js?v=202609281730';
import { centrosAlcance } from './permisos.js?v=202609281730';

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
function heatConsolRG(v){ return tintRG(1-Math.min(100,v||0)/100); }  // más intenso = menor consolidación (peor)
function heatTarRG(v){ return tintRG(Math.min(1,(v||0)/60)); }

// --- Estado -----------------------------------------------------------------
let _container = null;
let _mode = 'general';        // 'general' | 'centro'
let _grupo = null;            // grupo seleccionado en modo centro
let _cacheGen = null;         // datos generales
let _cacheCen = null;         // datos por grupo
let _cacheGrp = null;         // Consolidado: datos mensuales por grupo (filtro de centro)
let _cenGen = 'TODOS';        // Consolidado: centro seleccionado ('TODOS' = red completa)

let _view = 'consolidado';    // consolidado | nivel | tarifa | margen
export function setIndicadoresSubTab(sub){
  if (['consolidado','nivel','tarifa','margen'].indexOf(sub) >= 0) _view = sub;
  else if (sub === 'centro' || sub === 'general') _mode = sub;
}

// --- Formato ----------------------------------------------------------------
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = v => (v==null?'–':nf1.format(v)+'%');
const sgn = v => (v<0?'-':'');
const money = v => (v==null?'–':sgn(v)+'$'+nf1.format(Math.abs(v)));
const money0 = v => sgn(v)+'$'+nf0.format(Math.abs(Math.round(v)));
const money1 = v => sgn(v)+'$'+nf1.format(Math.abs(v));
const mm = v => (v==null?'–':sgn(v)+'$'+nf1.format(Math.abs(v))+' MM');
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
      <div class="text-headline-sm font-bold" id="ind_gen_tit">Consolidado General</div>
      <div class="flex items-center gap-sm flex-wrap ml-auto">
        <label class="text-secondary text-body-md" for="ind_selg">Centro:</label>
        <select id="ind_selg" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface" disabled><option>Cargando…</option></select>
        <span class="text-[11px] text-secondary border border-surface-variant rounded-full px-md py-[3px]">Actualización diaria 08:00 · Supabase</span>
      </div>
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
      const [ns,tar,mar,sc,con,tie,scm,tarm,shes,ebm] = await Promise.all([
        supabase.from('v_ind_ns_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_tarifa_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_margen_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_sin_cobro_centro').select('*'),
        supabase.from('v_ind_consol_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_tiempo_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_sin_cobro_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_troncal_quilicura_mes').select('*').gte('mes_label',y),
        supabase.from('v_ind_troncal_quilicura_sinhes').select('*'),
        supabase.from('v_ind_ebemaclick_mes').select('*').gte('mes_label',y).order('mes_label')
      ]);
      const e = ns.error||tar.error||mar.error||sc.error||con.error||tie.error||scm.error||tarm.error||shes.error||ebm.error; if(e) throw e;
      _cacheGen = { ns:ns.data||[], tar:tar.data||[], mar:mar.data||[], sc:sc.data||[], con:con.data||[], tie:tie.data||[], scm:scm.data||[], tq:tarm.data||[], shes:(shes.data&&shes.data[0])||{}, ebm:ebm.data||[] };
    }
    if (!_cacheGrp){
      const y='2026-01';
      const [ns,tar,mar,con,tie,scm,ebm] = await Promise.all([
        supabase.from('v_ind_ns_grupo_mes').select('*').gte('mes_label',y),
        supabase.from('v_ind_tarifa_grupo_mes').select('*').eq('segmento','ULTIMA_MILLA').gte('mes_label',y),
        supabase.from('v_ind_margen_grupo_mes').select('*').eq('segmento','ULTIMA_MILLA').gte('mes_label',y),
        supabase.from('v_ind_consol_grupo_mes').select('*').gte('mes_label',y),
        supabase.from('v_ind_tiempo_grupo_mes').select('*').gte('mes_label',y),
        supabase.from('v_ind_sin_cobro_grupo_mes').select('*').eq('segmento','ULTIMA_MILLA').gte('mes_label',y),
        supabase.from('v_ind_ebemaclick_grupo_mes').select('*').gte('mes_label',y)
      ]);
      const e = ns.error||tar.error||mar.error||con.error||tie.error||scm.error||ebm.error; if(e) throw e;
      _cacheGrp = { ns:ns.data||[], tar:tar.data||[], mar:mar.data||[], con:con.data||[], tie:tie.data||[], scm:scm.data||[], ebm:ebm.data||[] };
    }
    paintGeneral();
  } catch(e){ body().innerHTML = errorHTML(e); }
}
// --- Filtro de centro del Consolidado (28-sep-2026) ---------------------------
// 'TODOS' usa las vistas generales (red completa, cifras exactas del Comité).
// Un centro usa las vistas por grupo (última milla), agregadas por mes con los
// mismos ponderadores (líneas / toneladas / viajes / entregas).
// Perfiles con centros asignados: 'TODOS' = suma de sus centros visibles (RLS).
const normG = g => String(g||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim().replace(/^SAN BERNADO$/,'SAN BERNARDO');
function gruposGen(){
  const set=new Set();
  ['ns','tar','mar'].forEach(k=>(_cacheGrp[k]||[]).forEach(r=>{ if(r.grupo&&r.grupo!=='OTROS') set.add(r.grupo); }));
  return [...set].sort();
}
function datosGenFiltro(grupos){
  const G=new Set(grupos.map(normG)), f=rows=>(rows||[]).filter(r=>G.has(normG(r.grupo)));
  const porMes=(rows,fn)=>{ const m={}; rows.forEach(r=>{ (m[r.mes_label]=m[r.mes_label]||[]).push(r); }); return Object.keys(m).sort().map(k=>fn(k,m[k])); };
  const g=_cacheGrp;
  const scm=porMes(f(g.scm),(k,rs)=>({ mes_label:k, monto:sum(rs.map(r=>r.monto)), monto_sugerido:sum(rs.map(r=>r.monto_sugerido)), entregas:sum(rs.map(r=>r.entregas)), lineas:sum(rs.map(r=>r.lineas)) }));
  return {
    _filtro:true,
    ns:  porMes(f(g.ns),(k,rs)=>({ mes_label:k, otif_pct:wavg(rs.map(r=>[r.otif_pct,r.lineas])), fillrate_pct:wavg(rs.map(r=>[r.fillrate_pct,r.lineas])), lineas_evaluadas:sum(rs.map(r=>r.lineas)) })),
    tar: porMes(f(g.tar),(k,rs)=>({ mes_label:k, toneladas:sum(rs.map(r=>r.toneladas)), tarifa_kg:wavg(rs.map(r=>[r.tarifa_kg,r.toneladas])) })),
    mar: porMes(f(g.mar),(k,rs)=>{ const c=sum(rs.map(r=>r.cobrado)), p=sum(rs.map(r=>r.pagado)); return { mes_label:k, cobrado:c, pagado:p, margen:sum(rs.map(r=>r.margen)), cobertura_pct:(p?100*c/p:null) }; }),
    con: porMes(f(g.con),(k,rs)=>({ mes_label:k, consol_pct:wavg(rs.map(r=>[r.consol_pct,r.viajes])), viajes:sum(rs.map(r=>r.viajes)) })),
    tie: porMes(f(g.tie),(k,rs)=>({ mes_label:k, dias_prom:wavg(rs.map(r=>[r.dias_prom,r.entregas])), entregas:sum(rs.map(r=>r.entregas)) })),
    scm,
    sc:  [{ monto_no_cobrado:sum(scm.map(r=>r.monto)), entregas_sin_cobro:sum(scm.map(r=>r.entregas)) }],
    tq:  f(_cacheGen.tq),
    shes:{},
    ebm: porMes(f(g.ebm),(k,rs)=>({ mes_label:k, entregas:null, docs:sum(rs.map(r=>r.docs)), toneladas:sum(rs.map(r=>r.toneladas)), pagado:sum(rs.map(r=>r.pagado)) }))
  };
}
function paintGeneral(){
  const grupos=gruposGen(), restringido=(centrosAlcance()!==null);
  if(_cenGen!=='TODOS' && grupos.indexOf(_cenGen)<0) _cenGen='TODOS';
  const sel=document.getElementById('ind_selg');
  if(sel){
    sel.innerHTML=`<option value="TODOS">${restringido?'Todos mis centros':'Todos los centros'}</option>`+
      grupos.map(g=>`<option value="${g}" ${g===_cenGen?'selected':''}>${nice(g)}</option>`).join('');
    sel.value=_cenGen; sel.disabled=false;
    sel.onchange=ev=>{ _cenGen=ev.target.value; paintGeneral(); };
  }
  const tit=document.getElementById('ind_gen_tit');
  if(tit) tit.textContent = _cenGen==='TODOS' ? 'Consolidado General' : 'Consolidado — '+nice(_cenGen);
  const d = _cenGen!=='TODOS' ? datosGenFiltro([_cenGen]) : (restringido ? datosGenFiltro(grupos) : _cacheGen);
  body().innerHTML = generalHTML(d);
  ensureTip(); drawGeneral(d); sweepHeat();
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
  const tarCur=d.tar.find(r=>r.mes_label===_curM)||{};
  const tarClosed=d.tar.filter(r=>r.mes_label<_curM);
  const tarWavgC=wavg(tarClosed.map(r=>[r.tarifa_kg,r.toneladas])), tonAvgC=avg(tarClosed.map(r=>r.toneladas));
  const tarClosedRange=tarClosed.length?(mesCorto(tarClosed[0].mes_label)+'–'+mesCorto(tarClosed[tarClosed.length-1].mes_label)):'';
  const marAcc=sum(d.mar.map(r=>r.margen))/1e6, cobAvg=avg(d.mar.map(r=>r.cobertura_pct));
  const scMonto=sum(d.sc.map(r=>r.monto_no_cobrado))/1e6, scEnt=sum(d.sc.map(r=>r.entregas_sin_cobro));
  const worst=d.mar.reduce((a,b)=>(b.margen<(a?a.margen:1e15)?b:a),null)||{};
  // --- Resumen ejecutivo: último mes cerrado vs mes anterior (27-sep-2026) ---
  const _l=(a,k)=>a[a.length-1-k]||{}, _dif=(a,b)=>(a!=null&&b!=null)?a-b:null;
  const n1=_l(nsClosed,0), n0=_l(nsClosed,1), t1=_l(tarClosed,0), t0=_l(tarClosed,1);
  const marC=d.mar.filter(r=>r.mes_label<_curM), m1=_l(marC,0), m0=_l(marC,1);
  const conC=d.con.filter(r=>r.mes_label<_curM), k1=_l(conC,0), k0=_l(conC,1);
  const pp=v=>nf1.format(v)+' pp';
  const resumen=`<div class="flex items-baseline gap-sm flex-wrap mb-sm"><div class="text-body-lg font-bold">Resumen ejecutivo</div>
      <div class="text-[12px] text-secondary">último mes cerrado de cada indicador vs el mes anterior · clic para ir al detalle</div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:12px;margin-bottom:20px">
      ${kpiExec({k:'OTIF',v:pct(n1.otif_pct),st:semaforo(n1.otif_pct,META.otif,5),meta:META.otif+'%',delta:_dif(n1.otif_pct,n0.otif_pct),dfmt:pp,prevLbl:mesCorto(n0.mes_label||''),per:mesCorto(n1.mes_label||''),ancla:'sec-ns'})}
      ${kpiExec({k:'Fill Rate',v:pct(n1.fillrate_pct),st:semaforo(n1.fillrate_pct,META.fill,5),meta:META.fill+'%',delta:_dif(n1.fillrate_pct,n0.fillrate_pct),dfmt:pp,prevLbl:mesCorto(n0.mes_label||''),per:mesCorto(n1.mes_label||''),ancla:'sec-ns'})}
      ${kpiExec({k:'Tarifa $/kg',v:money(t1.tarifa_kg),sub:'menor es mejor',delta:_dif(t1.tarifa_kg,t0.tarifa_kg),dfmt:money1,better:'down',prevLbl:mesCorto(t0.mes_label||''),per:mesCorto(t1.mes_label||'')+' · '+(t1.toneladas!=null?nf0.format(t1.toneladas)+' t':''),ancla:'sec-tar'})}
      ${kpiExec({k:'Margen de flete',v:mm((m1.margen||0)/1e6),st:(m1.margen==null?null:(m1.margen>=0?{c:'#1E8449',t:'Positivo'}:{c:'#C0000C',t:'Negativo'})),delta:_dif((m1.margen||0)/1e6,(m0.margen||0)/1e6),dfmt:money1,prevLbl:mesCorto(m0.mes_label||''),per:mesCorto(m1.mes_label||''),ancla:'sec-mar'})}
      ${kpiExec({k:'Cobertura',v:pct(m1.cobertura_pct),st:semaforo(m1.cobertura_pct,META.cobertura,10),meta:META.cobertura+'%',delta:_dif(m1.cobertura_pct,m0.cobertura_pct),dfmt:pp,prevLbl:mesCorto(m0.mes_label||''),per:'cobrado / pagado · '+mesCorto(m1.mes_label||''),ancla:'sec-mar'})}
      ${kpiExec({k:'Consolidación',v:pct(k1.consol_pct),st:semaforo(k1.consol_pct,META.consol,10),meta:META.consol+'%',delta:_dif(k1.consol_pct,k0.consol_pct),dfmt:pp,prevLbl:mesCorto(k0.mes_label||''),per:'% capacidad camión · '+mesCorto(k1.mes_label||''),ancla:'sec-op'})}
    </div>`;
  return resumen+`
    ${card('1 · Nivel de Servicio — última milla','OTIF y Fill Rate',
      tileS('OTIF — promedio cerrado',pct(avgOc),(closedRange||'meses cerrados'),semaforo(avgOc,META.otif,5))+
      tile('OTIF — '+mesCorto(_curM)+' (en curso)',pct(nsCur.otif_pct),(nsCur.otif_pct==null?'s/ dato en fuente':'parcial'),'opacity-60')+
      tileS('Fill — promedio cerrado',pct(avgFc),(closedRange||'meses cerrados'),semaforo(avgFc,META.fill,5))+
      tile('Fill — '+mesCorto(_curM)+' (en curso)',pct(nsCur.fillrate_pct),(nsCur.fillrate_pct==null?'s/ dato en fuente':'parcial'),'opacity-60'),
      legend([{n:'OTIF %',c:R.red},{n:'Fill Rate %',c:R.grey},{n:'Mes en curso',c:R.greyL},{n:'Meta OTIF '+META.otif+'%',c:'#1E8449'}])+`<div id="g_ns"></div>`,'sec-ns')}
    ${card('2 · Pesos por Kilo — última milla','Tarifas $/kg y Toneladas Despachadas',
      tile('Tarifa $/kg — '+mesCorto(_curM)+' (en curso)',money(tarCur.tarifa_kg),'parcial','opacity-60')+
      tile('Tarifa $/kg ponderada — cerrados',money(tarWavgC),(tarClosedRange||'meses cerrados'))+
      tile('Toneladas — '+mesCorto(_curM)+' (en curso)',(tarCur.toneladas!=null?nf0.format(tarCur.toneladas)+' t':'–'),'parcial','opacity-60')+
      tile('Toneladas promedio — cerrados',(tonAvgC!=null?nf0.format(tonAvgC)+' t':'–'),(tarClosedRange||'meses cerrados')),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Tarifa $/kg',c:R.red2}])+`<div id="g_tar"></div></div>`+
      `<div>`+legend([{n:'Toneladas (t)',c:R.grey}])+`<div id="g_ton"></div></div></div>`,'sec-tar')}
    ${card('3 · Margen de Flete — última milla','Margen ($MM) y Cobertura',
      tile('Margen acumulado',mm(marAcc),'excl. EbemaClick',marAcc<0?'text-[#C0000C]':'')+
      tileS('Cobertura promedio',pct(cobAvg),'cobrado / pagado',semaforo(cobAvg,META.cobertura,10))+
      tile('Sin cobrar',mm(scMonto),nf0.format(scEnt)+' entregas','text-[#C0000C]')+
      tile('Peor mes',mm(worst.margen/1e6),mesCorto(worst.mes_label||''),'text-[#C0000C]'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Margen $MM',c:R.red}])+`<div id="g_mar"></div></div>`+
      `<div>`+legend([{n:'Cobertura %',c:R.grey}])+`<div id="g_cob"></div></div></div>`,'sec-mar')}
    ${card('3.1 · Flete no cobrado — última milla','Flete pagado - No cobrado',
      tile('No cobrado acumulado',mm(sum(d.scm.map(r=>r.monto))/1e6),'2026','text-[#C0000C]')+
      tile('Entregas sin cobro',nf0.format(sum(d.scm.map(r=>r.entregas))),'acumulado')+
      tile('Líneas',nf0.format(sum(d.scm.map(r=>r.lineas))),'acumulado')+
      (function(){var w=d.scm.reduce((a,b)=>(b.monto>(a?a.monto:-1)?b:a),null)||{};return tile('Peor mes',mm((w.monto||0)/1e6),mesCorto(w.mes_label||''),'text-[#C0000C]');})(),
      legend([{n:'No cobrado $MM',c:R.red2}])+`<div id="g_scm"></div>`)}

    ${card('3.2 · Troncal Quilicura','Consolidación y Tarifa $/kg Troncal',
      (d._filtro?'':tile('Documentos sin HES',nf0.format(d.shes.docs_sin_hes||0),'sin costo final')+
      tile('Toneladas sin reconocer costo',(d.shes.ton_sin_hes!=null?nf1.format(d.shes.ton_sin_hes)+' t':'–'),'sin HES')),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div><div class="text-[12px] text-secondary mb-1 font-medium">Nivel de consolidación % — más rojo = menor consolidación</div>`+
      heatmapHTML(d.tq,'consol_pct',heatConsolRG,v=>nf1.format(v))+`</div>`+
      `<div><div class="text-[12px] text-secondary mb-1 font-medium">Pesos por kilo $/kg — más rojo = más caro</div>`+
      heatmapHTML(d.tq,'tarifa_kg',heatTarRG,money1)+`</div></div>`)}

    ${card('3.3 · Impacto EbemaClick','Costo, despachos y toneladas',
      (d._filtro?'':tile('Despachos',nf0.format(sum(d.ebm.map(r=>r.entregas))),'entregas · período'))+
      tile('Toneladas despachadas',(function(){var t=sum(d.ebm.map(r=>r.toneladas));return t?nf1.format(t)+' t':'–';})(),'período')+
      tile('Documentos',nf0.format(sum(d.ebm.map(r=>r.docs))),'transporte · período')+
      tile('Costo pagado',mm(sum(d.ebm.map(r=>r.pagado))/1e6),'flete pagado','text-[#C0000C]'),
      legend([{n:'Costo EbemaClick $MM',c:R.red2}])+`<div id="g_ebc_mes"></div>`)}

    ${card('4 · Operación — última milla','Consolidación y Tiempo de Facturación',
      tile('Consolidación — '+mesCorto((d.con[d.con.length-2]||d.con[d.con.length-1]||{}).mes_label||''),pct((d.con[d.con.length-2]||d.con[d.con.length-1]||{}).consol_pct),'% capacidad usada')+
      tileS('Consolidación promedio',pct(avg(d.con.map(r=>r.consol_pct))),'año',semaforo(avg(d.con.map(r=>r.consol_pct)),META.consol,10))+
      tile('Días entrega→transporte',(function(){var r=d.tie[d.tie.length-2]||d.tie[d.tie.length-1]||{};return r.dias_prom!=null?nf1.format(r.dias_prom)+' d':'–';})(),'último mes')+
      tile('Días promedio',(function(){var v=avg(d.tie.map(r=>r.dias_prom));return v!=null?nf1.format(v)+' d':'–';})(),'año'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Consolidación %',c:R.red2}])+`<div id="g_consol"></div></div>`+
      `<div>`+legend([{n:'Días entrega→transporte',c:R.grey}])+`<div id="g_tiempo"></div></div></div>`,'sec-op')}

    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Todos los indicadores son de <b>última milla</b> (entregas a cliente); se excluye reposición troncal. El <b>3.2</b> es específicamente troncal Quilicura (solo documentos con HES). Con un <b>centro</b> seleccionado, todo se calcula con las vistas por centro de origen (última milla) y el 3.2 muestra sólo la fila de ese centro. Flete Tercero (REVEX) se revisa en su propio menú. OTIF/Fill incluyen el mes en curso cuando el archivo de notas de venta lo trae (hoy la fuente llega a julio). Tarifa, margen y operación incluyen el mes en curso parcial.</div>`;
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
// ---- Núcleo de gráficos v2 (27-sep-2026) ------------------------------------
// Dibuja al ANCHO REAL del contenedor (texto siempre ~11 px, antes escalaba con
// el viewBox fijo 560 → 5-16 px), escala de ejes "redonda", etiquetas que no se
// pisan, línea de meta opcional y redibujo al cambiar el tamaño de la ventana.
let W=560, PR=18; const H=220,PL=46,PT=18,PB=28;   // PR crece a 66 cuando hay etiqueta de meta
const FS=11, META_C='#1E8449';
const META={ otif:90, fill:95, consol:85, cobertura:100 };   // metas (editar aquí)
const _charts=new Map(); let _rsT=null;
window.addEventListener('resize',function(){ clearTimeout(_rsT); _rsT=setTimeout(function(){
  _charts.forEach(function(fn,id){ var el=document.getElementById(id); if(el&&el.isConnected&&el.clientWidth) fn(); else _charts.delete(id); });
},200); });
function _prep(elId,fn){ var el=document.getElementById(elId); if(!el) return null; _charts.set(elId,fn); W=Math.max(300,Math.round(el.clientWidth||560)); return el; }
function niceScale(mn,mx,n){ n=n||4; if(!(mx>mn)) mx=mn+1; var raw=(mx-mn)/n, p=Math.pow(10,Math.floor(Math.log10(raw))), f=raw/p;
  var st=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p; return {mn:Math.floor(mn/st+1e-9)*st, mx:Math.ceil(mx/st-1e-9)*st, st:st}; }
function bx(i,n){var w=(W-PL-PR)/n;return PL+w*i+w/2;}
function px(i,n){return bx(i,n);}
function py(v,mn,mx){return PT+(H-PT-PB)*(1-(v-mn)/(mx-mn));}
function gridY(out,sc,fmt){ for(var v=sc.mn; v<=sc.mx+sc.st*1e-6; v+=sc.st){ var y=py(v,sc.mn,sc.mx);
  out.push('<line x1="'+PL+'" y1="'+y.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+y.toFixed(1)+'" stroke="'+C.grid+'" stroke-width="1"/>');
  out.push('<text x="'+(PL-7)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" fill="'+C.muted+'" font-size="'+FS+'">'+fmt(Math.abs(v)<1e-9?0:v)+'</text>'); } }
function xLabels(out,labels){ var n=labels.length, k=Math.max(1,Math.ceil(n*40/(W-PL-PR)));
  for(var i=0;i<n;i++){ if(i%k && i!==n-1) continue; out.push('<text x="'+bx(i,n).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle" fill="'+C.muted+'" font-size="'+FS+'">'+labels[i]+'</text>'); } }
function metaLine(out,meta,sc){ if(!meta||meta.v==null||meta.v<sc.mn||meta.v>sc.mx) return; var y=py(meta.v,sc.mn,sc.mx);
  out.push('<line x1="'+PL+'" y1="'+y.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+y.toFixed(1)+'" stroke="'+META_C+'" stroke-width="1.5" stroke-dasharray="5 4"/>');
  out.push('<text x="'+(W-PR+4)+'" y="'+(y+4).toFixed(1)+'" fill="'+META_C+'" font-size="'+FS+'" font-weight="700">'+(meta.short||('Meta '+meta.v+'%'))+'</text>');
  out.push('<line x1="'+PL+'" y1="'+y.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+y.toFixed(1)+'" stroke="transparent" stroke-width="10" data-t="'+(meta.lbl||('Meta '+meta.v))+'"/>'); }
function svgOpen(){return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:auto;overflow:visible;display:block" role="img">';}
function valLbl(v){ return Math.abs(v)>=1000? nf0.format(v) : nf1.format(v); }
function tickDefault(sc){ return sc.st<1? function(v){return nf1.format(v);} : function(v){return nf0.format(v);}; }

function lineChart(elId,series,labels,mn,mx,unit,softFrom,meta){
  var el=_prep(elId,function(){lineChart(elId,series,labels,mn,mx,unit,softFrom,meta);}); if(!el) return; PR=meta?66:18;
  if(softFrom==null) softFrom=labels.length;
  var sc=niceScale(mn,mx), lo=sc.mn, hi=sc.mx, n=labels.length;
  var out=[svgOpen()]; gridY(out,sc,tickDefault(sc)); metaLine(out,meta,sc);
  var dense=(W-PL-PR)/Math.max(n,1) < 38;
  for(var s=0;s<series.length;s++){var ser=series[s];
    for(var i=1;i<ser.v.length;i++){
      if(ser.v[i]==null||ser.v[i-1]==null) continue;
      var X0=bx(i-1,n),Y0=py(ser.v[i-1],lo,hi),X1=bx(i,n),Y1=py(ser.v[i],lo,hi), soft=(i>=softFrom);
      out.push('<path d="M'+X0.toFixed(1)+' '+Y0.toFixed(1)+' L'+X1.toFixed(1)+' '+Y1.toFixed(1)+'" fill="none" stroke="'+ser.c+'" stroke-width="2" stroke-linecap="round"'+(soft?' stroke-dasharray="4 3" opacity="0.5"':'')+'/>');
    }
    var vv=ser.v.filter(function(x){return x!=null;}), vmax=Math.max.apply(null,vv), vmin=Math.min.apply(null,vv);
    for(var j=0;j<ser.v.length;j++){ var v=ser.v[j]; if(v==null) continue;
      var CX=bx(j,n),CY=py(v,lo,hi),op=(j>=softFrom?'0.5':'1');
      out.push('<circle cx="'+CX.toFixed(1)+'" cy="'+CY.toFixed(1)+'" r="4" fill="'+ser.c+'" stroke="#fff" stroke-width="2" opacity="'+op+'"/>');
      // etiqueta: arriba si es el valor más alto del punto, abajo si no (no se pisan)
      var others=series.filter(function(o,k){return k!==s && o.v[j]!=null;}).map(function(o){return o.v[j];});
      var arriba=!others.length || v>=Math.max.apply(null,others);
      var show=!dense || j===0 || j===ser.v.length-1 || v===vmax || v===vmin;
      if(show) out.push('<text x="'+CX.toFixed(1)+'" y="'+(arriba?CY-9:CY+17).toFixed(1)+'" text-anchor="middle" fill="'+ser.c+'" font-size="'+FS+'" font-weight="600" opacity="'+op+'">'+nf1.format(v)+'</text>');
      // zona de hover amplia (más grande que el punto)
      out.push('<circle cx="'+CX.toFixed(1)+'" cy="'+CY.toFixed(1)+'" r="12" fill="transparent" data-t="'+ser.n+' '+labels[j]+': '+nf1.format(v)+unit+(j>=softFrom?' (en curso)':'')+'"/>');
    }
  }
  out.push('<line x1="'+PL+'" y1="'+(H-PB)+'" x2="'+(W-PR)+'" y2="'+(H-PB)+'" stroke="'+C.grid+'" stroke-width="1"/>');
  xLabels(out,labels); out.push('</svg>'); el.innerHTML=out.join(''); bind(el);
}
// Devuelve etiqueta 'YYYY-MM' del mes en curso
function mesEnCurso(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
// Lista de meses 'YYYY-MM' desde enero del año en curso hasta el mes actual
function mesesPeriodo(){ var d=new Date(), y=d.getFullYear(), n=d.getMonth()+1, a=[]; for(var m=1;m<=n;m++) a.push(y+'-'+String(m).padStart(2,'0')); return a; }
// --- Evolutivo semanal (últimas 4 semanas cerradas) -------------------------
function semKey(s){ var m=/(\d{4})-S(\d{1,2})/.exec(s||''); return m?(+m[1])*100+(+m[2]):0; }
function isoWeekKey(dt){ var d=new Date(Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate())); var day=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-day+3); var f=new Date(Date.UTC(d.getUTCFullYear(),0,4)); var w=1+Math.round(((d-f)/864e5-3+((f.getUTCDay()+6)%7))/7); return d.getUTCFullYear()*100+w; }
function last4(rows,grupo){ var cur=isoWeekKey(new Date()); return (rows||[]).filter(function(r){return r.grupo===grupo && semKey(r.semana)<cur;}).sort(function(a,b){return semKey(a.semana)-semKey(b.semana);}).slice(-4); }
function last4Sem(rows){ var cur=isoWeekKey(new Date()); var s=[...new Set((rows||[]).filter(function(r){return semKey(r.semana)<cur;}).map(function(r){return r.semana;}))].sort(function(a,b){return semKey(a)-semKey(b);}); return s.slice(-4); }
function semLbl(s){ return (s||'').replace(/^\d{4}-/,''); }
function semTable(rows,cols){
  if(!rows.length) return `<div class="text-secondary text-[12px] py-md">Sin semanas cerradas.</div>`;
  var head='<tr class="text-secondary text-left"><th class="font-medium pb-[4px] pr-sm">Semana</th>'+cols.map(function(c){return `<th class="font-medium text-right pb-[4px] pr-sm">${c.label}</th><th class="font-medium text-right pb-[4px] pr-sm">Δ</th>`;}).join('')+'</tr>';
  var body=rows.map(function(r,i){
    var tds=cols.map(function(c){
      var v=c.get(r), prev=i>0?c.get(rows[i-1]):null, d=(v!=null&&prev!=null)?(v-prev):null;
      // Δ redondeado a 0 se muestra "=" (antes salía "$-0,0"); color según si subir es bueno o malo
      if(d!=null && /^[^1-9]*$/.test(c.dfmt(Math.abs(d)))) d=0;
      var dtxt=(d==null)?'–':(d===0?'=':((d>0?'+':'')+c.dfmt(d)));
      var bueno=(d==null||d===0)?null:((c.better==='down')? d<0 : d>0);
      var dsty=bueno==null?'color:#808285':(bueno?'color:#1E8449':'color:#C0000C');
      var arrow=bueno==null?'':(d>0?'▲ ':'▼ ');
      return `<td class="text-right pr-sm tabular-nums">${v==null?'–':c.fmt(v)}</td><td class="text-right pr-sm tabular-nums" style="${dsty}">${arrow}${dtxt}</td>`;
    }).join('');
    return `<tr class="border-t border-surface-variant"><td class="py-[3px] pr-sm whitespace-nowrap">${semLbl(r.semana)}</td>${tds}</tr>`;
  }).join('');
  return `<table class="w-full text-[12px]"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
// Agrega el mes en curso (si falta) a las filas ns; marca _curso=true en el slot añadido
function nsConCurso(ns){
  var rows=ns.slice(); var cur=mesEnCurso();
  var have=rows.some(r=>r.mes_label===cur);
  if(!have && rows.length && rows[rows.length-1].mes_label < cur){
    rows.push({mes_label:cur, otif_pct:null, fillrate_pct:null, lineas_evaluadas:null, _curso:true});
  } else if(have){ rows[rows.length-1]._curso=true; }
  return rows;
}
function barChart(elId,vals,labels,mn,mx,color,unit,part,tickFmt,meta){
  var el=_prep(elId,function(){barChart(elId,vals,labels,mn,mx,color,unit,part,tickFmt,meta);}); if(!el) return; PR=meta?66:18;
  var sc=niceScale(Math.min(mn,0),mx), lo=sc.mn, hi=sc.mx, n=vals.length;
  var out=[svgOpen()]; gridY(out,sc,tickFmt||tickDefault(sc));
  var zeroY=py(0,lo,hi);
  out.push('<line x1="'+PL+'" y1="'+zeroY.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+zeroY.toFixed(1)+'" stroke="'+C.muted+'" stroke-width="1"/>');
  var band=(W-PL-PR)/Math.max(n,1), bw=Math.min(56,band*0.62), lbl=band>=26;
  for(var i=0;i<n;i++){var v=vals[i]; if(v==null) continue; var y=py(v,lo,hi),top=Math.min(y,zeroY),h=Math.max(Math.abs(y-zeroY),1);
    var op=(part!=null&&i>=part)?'0.5':'1',extra=(part!=null&&i>=part)?' (parcial)':'';
    out.push('<rect x="'+(bx(i,n)-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="4" fill="'+color+'" opacity="'+op+'"/>');
    if(lbl){ var lblY=(v>=0? top-5 : top+h+14);
      out.push('<text x="'+bx(i,n).toFixed(1)+'" y="'+lblY.toFixed(1)+'" text-anchor="middle" fill="'+C.ink+'" font-size="'+FS+'" font-weight="600" opacity="'+op+'">'+valLbl(v)+'</text>'); }
    out.push('<rect x="'+(bx(i,n)-band/2).toFixed(1)+'" y="'+PT+'" width="'+band.toFixed(1)+'" height="'+(H-PT-PB)+'" fill="transparent" data-t="'+labels[i]+': '+nf1.format(v)+unit+extra+'"/>');
  }
  metaLine(out,meta,sc);
  xLabels(out,labels); out.push('</svg>'); el.innerHTML=out.join(''); bind(el);
}
// Ranking horizontal
function hbarChart(elId,items,color,unit,hlLabel){
  var el=_prep(elId,function(){hbarChart(elId,items,color,unit,hlLabel);}); if(!el) return;
  var n=items.length, rowH=26, lblW=Math.min(150,Math.max(90,W*0.22)), valW=56;
  var vals=items.map(function(it){return it.value;}), mx=Math.max.apply(null,vals.concat([0])), mn=Math.min.apply(null,vals.concat([0]));
  var span=(mx-mn)||1, x0=lblW, xw=W-lblW-valW;
  var zero=x0+(0-mn)/span*xw, HH=rowH*n+6;
  var out=['<svg viewBox="0 0 '+W+' '+HH+'" width="100%" style="height:auto;overflow:visible;display:block" role="img">'];
  for(var i=0;i<n;i++){var it=items[i],y=i*rowH+3,bxx=x0+(it.value-mn)/span*xw;
    var left=Math.min(zero,bxx),w=Math.max(Math.abs(bxx-zero),2), hl=(it.label===hlLabel);
    out.push('<text x="'+(lblW-8)+'" y="'+(y+rowH*0.6).toFixed(1)+'" text-anchor="end" fill="'+(hl?C.ink:C.muted)+'" font-size="'+FS+'" font-weight="'+(hl?'700':'400')+'">'+it.label+'</text>');
    out.push('<rect x="'+left.toFixed(1)+'" y="'+(y+4).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+(rowH-10)+'" rx="4" fill="'+color+'" opacity="'+(hlLabel&&!hl?'0.45':'1')+'"/>');
    out.push('<text x="'+(bxx+(it.value>=0?6:-6)).toFixed(1)+'" y="'+(y+rowH*0.6).toFixed(1)+'" text-anchor="'+(it.value>=0?'start':'end')+'" fill="'+C.ink+'" font-size="'+FS+'">'+nf1.format(it.value)+'</text>');
    out.push('<rect x="0" y="'+y+'" width="'+W+'" height="'+rowH+'" fill="transparent" data-t="'+it.label+': '+nf1.format(it.value)+unit+'"/>');
  }
  out.push('</svg>'); el.innerHTML=out.join(''); bind(el);
}

function drawGeneral(d){
  const nsC=nsConCurso(d.ns), nsL=nsC.map(r=>mesCorto(r.mes_label)), softNs=nsC.findIndex(r=>r._curso);
  lineChart('g_ns',[{n:'OTIF',v:nsC.map(r=>r.otif_pct),c:R.red},{n:'Fill',v:nsC.map(r=>r.fillrate_pct),c:R.grey}],nsL,60,100,'%',softNs<0?undefined:softNs,{v:META.otif,lbl:'Meta OTIF '+META.otif+'%'});
  const tarL=d.tar.map(r=>mesCorto(r.mes_label)), pIdx=d.tar.length-1;
  barChart('g_tar',d.tar.map(r=>r.tarifa_kg),tarL,0,niceMax(d.tar.map(r=>r.tarifa_kg)),R.red2,' $/kg',pIdx,money0);
  barChart('g_ton',d.tar.map(r=>r.toneladas),tarL,0,niceMax(d.tar.map(r=>r.toneladas)),R.grey,' t',pIdx,v=>Math.round(v/1000)+'k');
  const marL=d.mar.map(r=>mesCorto(r.mes_label)), marV=d.mar.map(r=>r.margen/1e6);
  barChart('g_mar',marV,marL,Math.min(-2,niceMin(marV)),2,R.red,' MM',d.mar.length-1,money0);
  lineChart('g_cob',[{n:'Cobertura',v:d.mar.map(r=>r.cobertura_pct),c:R.grey}],marL,60,100,'%',undefined,{v:META.cobertura,lbl:'Meta cobertura '+META.cobertura+'%'});
  const conL=d.con.map(r=>mesCorto(r.mes_label));
  barChart('g_consol',d.con.map(r=>r.consol_pct),conL,0,100,R.red2,'%',d.con.length-1,v=>Math.round(v),{v:META.consol,lbl:'Meta '+META.consol+'%'});
  const tieL=d.tie.map(r=>mesCorto(r.mes_label));
  barChart('g_tiempo',d.tie.map(r=>r.dias_prom),tieL,0,niceMax(d.tie.map(r=>r.dias_prom)),R.grey,' d',d.tie.length-1,v=>Math.round(v));
  const scmL=d.scm.map(r=>mesCorto(r.mes_label));
  barChart('g_scm',d.scm.map(r=>r.monto/1e6),scmL,0,niceMax(d.scm.map(r=>r.monto/1e6)),R.red2,' MM',d.scm.length-1,money0);
  var ebmMap={}; (d.ebm||[]).forEach(function(r){ebmMap[r.mes_label]=r;});
  var ebmL=mesesPeriodo();
  barChart('g_ebc_mes',ebmL.map(function(m){return ((ebmMap[m]&&ebmMap[m].pagado)||0)/1e6;}),ebmL.map(mesCorto),0,niceMax((d.ebm||[]).map(function(r){return r.pagado/1e6;})),R.red2,' MM',null,money1);
}

function drawCentro(d, grupo){
  const ns=weeks(d.ns.filter(r=>r.grupo===grupo));
  const tar=weeks(d.tar.filter(r=>r.grupo===grupo));
  const mar=weeks(d.mar.filter(r=>r.grupo===grupo));
  lineChart('c_ns',[{n:'OTIF',v:ns.map(r=>r.otif_pct),c:C.navy},{n:'Fill',v:ns.map(r=>r.fillrate_pct),c:C.blue}],ns.map(r=>r.semana.replace('2026-','')),0,100,'%',undefined,{v:META.otif,lbl:'Meta OTIF '+META.otif+'%'});
  barChart('c_tar',tar.map(r=>r.tarifa_kg),tar.map(r=>r.semana.replace('2026-','')),0,niceMax(tar.map(r=>r.tarifa_kg)),C.orange,' $/kg',null,money0);
  barChart('c_ton',tar.map(r=>r.toneladas),tar.map(r=>r.semana.replace('2026-','')),0,niceMax(tar.map(r=>r.toneladas)),C.blue,' t',null,v=>Math.round(v)+'');
  const marV=mar.map(r=>r.margen/1e6);
  barChart('c_mar',marV,mar.map(r=>r.semana.replace('2026-','')),Math.min(-0.5,niceMin(marV)),Math.max(0.5,niceMax(marV)),C.red,' MM',null,v=>nf1.format(v));
  lineChart('c_cob',[{n:'Cobertura',v:mar.map(r=>r.cobertura_pct),c:C.navy}],mar.map(r=>r.semana.replace('2026-','')),0,100,'%',undefined,{v:META.cobertura,lbl:'Meta cobertura '+META.cobertura+'%'});
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
  barChart('c_consol',cw.map(r=>r.consol_pct),cw.map(r=>r.semana.replace('2026-','')),0,100,C.green,'%',null,v=>Math.round(v),{v:META.consol,lbl:'Meta '+META.consol+'%'});
  const tm=(d.tie||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  barChart('c_tiempo',tm.map(r=>r.dias_prom),tm.map(r=>mesCorto(r.mes_label)),0,niceMax(tm.map(r=>r.dias_prom)),C.blue,' d',null,v=>Math.round(v));
  const sm=(d.scm||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  barChart('c_scm',sm.map(r=>r.monto/1e6),sm.map(r=>mesCorto(r.mes_label)),0,niceMax(sm.map(r=>r.monto/1e6)),C.red,' MM',null,money0);
}

// ============================================================================
//  UI helpers
// ============================================================================
function card(title,lead,tiles,chartsHTML,ancla){
  return `<section data-card ${ancla?'id="'+ancla+'" style="scroll-margin-top:80px"':''} class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md md:p-lg mb-lg">
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
// --- Semáforo vs meta (27-sep-2026) -------------------------------------------
// better='up' (más es mejor) | 'down' (menos es mejor). tol = margen "cerca de meta".
function semaforo(v,meta,tol,better){
  if(v==null||meta==null) return null;
  var ok = better==='down' ? v<=meta : v>=meta;
  var cerca = better==='down' ? v<=meta+tol : v>=meta-tol;
  return ok ? {c:'#1E8449',t:'Sobre meta'} : cerca ? {c:'#B5730B',t:'Cerca de meta'} : {c:'#C0000C',t:'Bajo meta'};
}
function stChip(st){ return st?`<div class="text-[11px] font-semibold mt-[2px]" style="color:${st.c}">● ${st.t}</div>`:''; }
function tileS(k,v,d,st,cls=''){
  return `<div class="bg-surface-container-low border border-surface-variant rounded-lg px-md py-sm" style="${st?'border-left:4px solid '+st.c:''}">
    <div class="text-[11px] text-secondary">${k}</div>
    <div class="text-2xl font-bold leading-tight ${cls}">${v}</div>${stChip(st)}
    <div class="text-[11px] text-secondary mt-[2px]">${d||''}</div></div>`;
}
// Tarjeta del resumen ejecutivo: valor + variación vs período anterior + semáforo
function kpiExec(o){
  var d=o.delta, dTxt='', dSty='color:#808285';
  if(d!=null){ var z=Math.abs(d)<1e-9 || /^[^1-9]*$/.test(o.dfmt(Math.abs(d)));
    var bueno=z?null:((o.better==='down')?d<0:d>0);
    dTxt=z?'= vs '+o.prevLbl:((d>0?'▲ +':'▼ ')+o.dfmt(d)+' vs '+o.prevLbl);
    dSty=bueno==null?'color:#808285':(bueno?'color:#1E8449':'color:#C0000C'); }
  return `<a href="#${o.ancla}" style="display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #e3e0dc;border-radius:12px;padding:12px 14px;${o.st?'border-top:4px solid '+o.st.c:'border-top:4px solid #A9ACAE'}">
    <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6B6E70">${o.k}</div>
    <div style="font-size:28px;font-weight:800;line-height:1.15;color:#1c1b1a;font-variant-numeric:tabular-nums">${o.v}</div>
    ${o.st?`<div style="font-size:12px;font-weight:700;color:${o.st.c}">● ${o.st.t}${o.meta!=null?' · meta '+o.meta:''}</div>`:`<div style="font-size:12px;color:#808285">${o.sub||'&nbsp;'}</div>`}
    <div style="font-size:12px;margin-top:2px;${dSty}">${dTxt||'&nbsp;'}</div>
    <div style="font-size:11px;color:#808285;margin-top:2px">${o.per||''}</div></a>`;
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
// Acumulado histórico por modalidad (mismo criterio evaluable/OTIF/Fill que el menú Flete Tercero) —
// se reconstruye desde los conteos crudos (evaluables/otif_n/fill_sum) para que el % calce exacto,
// en vez de promediar porcentajes ya redondeados mes a mes.
function overallFT(ft, modalidad){
  const rows = ft.filter(r=>r.modalidad===modalidad);
  const evaluables = sum(rows.map(r=>r.evaluables||0));
  const otifN = sum(rows.map(r=>r.otif_n||0));
  const fillSum = sum(rows.map(r=>r.fill_sum||0));
  const pedidos = sum(rows.map(r=>r.pedidos||0));
  return {
    otif: evaluables ? Math.round((100*otifN/evaluables)*10)/10 : null,
    fill: evaluables ? Math.round((100*fillSum/evaluables)*10)/10 : null,
    pedidos, evaluables
  };
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
    let D;
    if (centrosAlcance() !== null) {
      // Perfil con centros asignados: la BD devuelve sólo sus grupos (RLS en v_ind_*_grupo_mes);
      // se agregan por mes para armar el resumen de su(s) centro(s).
      D = await homeDatosAlcance(y);
    } else {
      const [ns,tar,mar] = await Promise.all([
        supabase.from('v_ind_ns_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_tarifa_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_margen_general_mes').select('*').gte('mes_label',y).order('mes_label')
      ]);
      const e=ns.error||tar.error||mar.error; if(e) throw e;
      D={ns:ns.data||[],tar:tar.data||[],mar:mar.data||[]};
    }
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
    lineChart('h_ns',[{n:'OTIF',v:D.ns.map(r=>r.otif_pct),c:C.navy},{n:'Fill',v:D.ns.map(r=>r.fillrate_pct),c:C.blue}],D.ns.map(r=>mesCorto(r.mes_label)),60,100,'%',undefined,{v:META.otif,lbl:'Meta OTIF '+META.otif+'%'});
    barChart('h_tar',D.tar.map(r=>r.tarifa_kg),D.tar.map(r=>mesCorto(r.mes_label)),0,niceMax(D.tar.map(r=>r.tarifa_kg)),C.orange,' $/kg',D.tar.length-1,money0);
    barChart('h_mar',D.mar.map(r=>r.margen/1e6),D.mar.map(r=>mesCorto(r.mes_label)),Math.min(-2,niceMin(D.mar.map(r=>r.margen/1e6))),2,C.red,' MM',D.mar.length-1,money0);
  } catch(e){ container.innerHTML=errorHTML(e); }
}
// Resumen mensual agregado de los grupos visibles para el usuario (perfiles por centro)
async function homeDatosAlcance(y){
  const [ns,tar,mar] = await Promise.all([
    supabase.from('v_ind_ns_grupo_mes').select('*').gte('mes_label',y),
    supabase.from('v_ind_tarifa_grupo_mes').select('*').eq('segmento','TODOS').gte('mes_label',y),
    supabase.from('v_ind_margen_grupo_mes').select('*').eq('segmento','TODOS').gte('mes_label',y)
  ]);
  const e=ns.error||tar.error||mar.error; if(e) throw e;
  const porMes=(rows,fn)=>{ const m={}; (rows||[]).forEach(r=>{ (m[r.mes_label]=m[r.mes_label]||[]).push(r); }); return Object.keys(m).sort().map(k=>fn(k,m[k])); };
  return {
    ns: porMes(ns.data,(k,rs)=>({ mes_label:k, otif_pct:wavg(rs.map(r=>[r.otif_pct,r.lineas])), fillrate_pct:wavg(rs.map(r=>[r.fillrate_pct,r.lineas])), lineas_evaluadas:sum(rs.map(r=>r.lineas)) })),
    tar: porMes(tar.data,(k,rs)=>({ mes_label:k, toneladas:sum(rs.map(r=>r.toneladas)), tarifa_kg:wavg(rs.map(r=>[r.tarifa_kg,r.toneladas])) })),
    mar: porMes(mar.data,(k,rs)=>({ mes_label:k, cobrado:sum(rs.map(r=>r.cobrado)), pagado:sum(rs.map(r=>r.pagado)), margen:sum(rs.map(r=>r.margen)) }))
  };
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
      const [tp,co,com,sp,ft,sem,co4,spw] = await Promise.all([
        supabase.from('v_ind_ns_tipo_grupo_4sem').select('*'),
        supabase.from('v_ind_ns_comuna').select('*'),
        supabase.from('v_ind_ns_comuna_mes').select('*'),
        supabase.from('v_ind_ns_spot_grupo_mes').select('*'),
        supabase.from('v_ind_ftercero_mes').select('*').gte('mes_label','2026-01').order('mes_label'),
        supabase.from('v_ind_ns_grupo_semana').select('*'),
        supabase.from('v_ind_ns_comuna_4sem').select('*'),
        supabase.from('v_ind_ns_spot_grupo_sem').select('*')
      ]);
      const e=tp.error||co.error||com.error||sp.error||ft.error||sem.error||co4.error||spw.error; if(e) throw e;
      _cacheNivel={tp:tp.data||[],co:co.data||[],com:com.data||[],sp:sp.data||[],ft:ft.data||[],sem:sem.data||[],co4:co4.data||[],spw:spw.data||[]};
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

    ${card('Semana Móvil Nivel de Servicio — '+nice(grupo),'OTIF y Fill Rate Semanal',
      '',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md items-center">`+
      `<div>`+legend([{n:'OTIF %',c:R.red},{n:'Fill Rate %',c:R.grey}])+`<div id="n_sem"></div></div>`+
      `<div id="n_semtab"></div></div>`)}

    ${card('Nivel de Servicio por Tipo de Venta Stock y Calzada','OTIF y Tiempo de Entrega',
      tileS('OTIF Stock',pct(stock.otif_pct),(stock.lineas||0)+' líneas · 4 sem',semaforo(stock.otif_pct,META.otif,5))+
      tileS('OTIF Calzada',pct(calz.otif_pct),(calz.lineas||0)+' líneas · 4 sem',semaforo(calz.otif_pct,META.otif,5))+
      tile('Días Stock',(stock.dias_prom!=null?nf1.format(stock.dias_prom)+' d':'–'),'venta→entrega')+
      tile('Días Calzada',(calz.dias_prom!=null?nf1.format(calz.dias_prom)+' d':'–'),'venta→entrega'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'OTIF % por tipo',c:R.red}])+`<div id="n_tipo_otif"></div></div>`+
      `<div>`+legend([{n:'Días a entrega por tipo',c:R.grey}])+`<div id="n_tipo_dias"></div></div></div>`+
      (hayClase?'':`<div class="text-[11px] text-secondary mt-sm">Stock=ZV01/03/04 · Calzada=ZV08/09. Vacío = falta correr la carga con el Code.gs actualizado (nueva columna Clase Documento).</div>`))}

    ${card('Nivel de Servicio por Comuna','Mejores y Peores Comunas','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'5 peores OTIF %',c:R.red2}])+`<div id="n_reg_peor"></div></div>`+
      `<div>`+legend([{n:'5 mejores OTIF %',c:R.grey}])+`<div id="n_reg_mejor"></div></div></div>`)}

    ${card('Nivel de Servicio Spot y Planificado','Evolutivo Spot vs Planificado','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'OTIF % Planificado',c:R.red},{n:'OTIF % Spot',c:R.grey}])+`<div id="n_spot"></div></div>`+
      `<div>`+legend([{n:'Entregas Planificado',c:R.red},{n:'Entregas Spot',c:R.grey}])+`<div id="n_spot_ent"></div></div></div>`)}

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
  const s4=last4(d.sem,grupo);
  lineChart('n_sem',[{n:'OTIF',v:s4.map(r=>r.otif_pct),c:R.red},{n:'Fill',v:s4.map(r=>r.fillrate_pct),c:R.grey}],s4.map(r=>semLbl(r.semana)),0,100,'%',undefined,{v:META.otif,lbl:'Meta OTIF '+META.otif+'%'});
  const nt=document.getElementById('n_semtab'); if(nt) nt.innerHTML=semTable(s4,[
    {label:'OTIF',get:r=>r.otif_pct,fmt:pct,dfmt:v=>nf1.format(v)+' pp'},
    {label:'Fill',get:r=>r.fillrate_pct,fmt:pct,dfmt:v=>nf1.format(v)+' pp'}]);
  const tp=d.tp.filter(r=>r.grupo===grupo), order=['STOCK','CALZADA'];
  barChart('n_tipo_otif',order.map(t=>{const r=tp.find(x=>x.tipo===t)||{};return r.otif_pct||0;}),order.map(nice),0,100,R.red,'%',null,v=>Math.round(v));
  const dv=order.map(t=>{const r=tp.find(x=>x.tipo===t)||{};return r.dias_prom||0;});
  barChart('n_tipo_dias',dv,order.map(nice),0,niceMax(dv),R.grey,' d',null,v=>Math.round(v));
  const reg=d.co.filter(r=>r.grupo===grupo && r.clasif_ruta==='Regional' && r.otif_pct!=null && (r.lineas||0)>=5);
  hbarChart('n_reg_peor',reg.slice().sort((a,b)=>a.otif_pct-b.otif_pct).slice(0,5).map(r=>({label:r.comuna,value:r.otif_pct})),R.red2,'%','');
  hbarChart('n_reg_mejor',reg.slice().sort((a,b)=>b.otif_pct-a.otif_pct).slice(0,5).map(r=>({label:r.comuna,value:r.otif_pct})),R.grey,'%','');
  const spg=(d.spw||[]).filter(r=>r.grupo===grupo), sems=last4Sem(spg);
  const spv=(sem,tipo,f)=>{var r=spg.find(x=>x.semana===sem&&x.tipo===tipo);return r?(r[f]||0):0;};
  lineChart('n_spot',[
    {n:'Planificado',v:sems.map(s=>spv(s,'Planificado','otif_pct')),c:R.red},
    {n:'Spot',v:sems.map(s=>spv(s,'Spot','otif_pct')),c:R.grey}
  ],sems.map(semLbl),0,100,'%');
  const _ent=sems.map(s=>spv(s,'Planificado','lineas')).concat(sems.map(s=>spv(s,'Spot','lineas')));
  lineChart('n_spot_ent',[
    {n:'Planificado',v:sems.map(s=>spv(s,'Planificado','lineas')),c:R.red},
    {n:'Spot',v:sems.map(s=>spv(s,'Spot','lineas')),c:R.grey}
  ],sems.map(semLbl),0,niceMax(_ent),'');
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
      const [tm,consm,com,capw,ebc,sem]=await Promise.all([
        supabase.from('v_ind_tarifa_grupo_mes').select('*'),
        supabase.from('v_ind_consol_grupo_mes').select('*'),
        supabase.from('v_ind_tarifa_comuna_grupo').select('*'),
        supabase.from('v_ind_consol_cap_grupo_sem').select('*'),
        supabase.from('v_ind_ebemaclick_grupo_mes').select('*'),
        supabase.from('v_ind_tarifa_grupo_semana').select('*')
      ]);
      const e=tm.error||consm.error||com.error||capw.error||ebc.error||sem.error; if(e) throw e;
      _cacheTar={tm:tm.data||[],consm:consm.data||[],com:com.data||[],capw:capw.data||[],ebc:ebc.data||[],sem:sem.data||[]};
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
    ${card('Semana Móvil Pesos por Kilo — '+nice(grupo),'Tarifa $/kg y Toneladas Semanal',
      '',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md items-center">`+
      `<div>`+legend([{n:'Tarifa $/kg',c:R.red2}])+`<div id="t_sem"></div></div>`+
      `<div id="t_semtab"></div></div>`)}
    <div class="text-[11px] text-secondary -mt-sm mb-md">Solo <b>última milla</b> (entregas a cliente). Excluye traslados troncales de reposición.</div>
    ${card('Evolutivo Mensual Tarifa $/kg y Toneladas','Mensual por centro (mes en curso en tono suave)','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Tarifa $/kg',c:R.red2}])+`<div id="t_tar"></div></div>`+
      `<div>`+legend([{n:'Toneladas',c:R.grey}])+`<div id="t_ton"></div></div></div>`)}
    ${card('Consolidación por Camión','Evolutivo Consolidación','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'% Consolidación mensual',c:R.red2}])+`<div id="t_consol_mes"></div></div>`+
      `<div>`+legend([{n:'% Consolidación · promedio 4 sem',c:R.grey}])+`<div id="t_cap_sem"></div></div></div>`)}
    ${card('Tarifas por Comunas','Más Caras y Baratas de Atender','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'5 más caras',c:R.red2}])+`<div id="t_caro"></div></div>`+
      `<div>`+legend([{n:'5 más baratas',c:R.grey}])+`<div id="t_barato"></div></div></div>`)}
    ${showEbc?card('4 · Impacto EbemaClick — período (ene → a la fecha)','Financiamiento de la operación EbemaClick en todo el período (docs con V Garrido + material 400141)',
      tile('Documentos',nf0.format(ebcTot.docs),'ene → hoy')+
      tile('Toneladas',nf1.format(ebcTot.ton)+' t','movidas')+
      tile('Flete pagado',mm(ebcTot.pag),'costo operación','text-[#EE1B22]')+
      tile('Financiamiento neto',mm(ebcTot.pag-ebcTot.cob),'pagado − cobrado','text-[#EE1B22]'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Flete pagado $MM',c:R.red2},{n:'Cobrado $MM',c:R.red}])+`<div id="t_ebc"></div></div>`+
      `<div>`+legend([{n:'Financiamiento neto $MM',c:R.grey}])+`<div id="t_ebc_neto"></div></div></div>`):''}
    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Solo última milla (entregas a cliente ZE01/ZE06/ZE20/ZE05/ZE04); se excluyen los traslados troncales de reposición (NL/EL). Comuna = comuna destino (routes.comuna); rutas de una misma comuna se agrupan. EbemaClick = documentos con V Garrido T y material 400141; el cuadro solo aparece en centros con operación EbemaClick.</div>
  </div>`;
}
function drawTarifa(d,grupo){
  const s4=last4(d.sem,grupo);
  barChart('t_sem',s4.map(r=>r.tarifa_kg),s4.map(r=>semLbl(r.semana)),0,niceMax(s4.map(r=>r.tarifa_kg)),R.red2,' $/kg',null,money0);
  const tt=document.getElementById('t_semtab'); if(tt) tt.innerHTML=semTable(s4,[
    {label:'$/kg',get:r=>r.tarifa_kg,fmt:money,dfmt:money1,better:'down'},
    {label:'Ton',get:r=>r.toneladas,fmt:v=>nf0.format(v),dfmt:v=>nf0.format(v)}]);
  const tm=d.tm.filter(r=>r.grupo===grupo && r.segmento===_segT).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  const tmL=tm.map(r=>mesCorto(r.mes_label)), pIdx=tm.length-1;
  barChart('t_tar',tm.map(r=>r.tarifa_kg),tmL,0,niceMax(tm.map(r=>r.tarifa_kg)),R.red2,' $/kg',pIdx,money0);
  barChart('t_ton',tm.map(r=>r.toneladas),tmL,0,niceMax(tm.map(r=>r.toneladas)),R.grey,' t',pIdx,v=>Math.round(v));
  const cm4=(d.consm||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  barChart('t_consol_mes',cm4.map(r=>r.consol_pct),cm4.map(r=>mesCorto(r.mes_label)),0,100,R.red2,'%',null,v=>Math.round(v),{v:META.consol,lbl:'Meta '+META.consol+'%'});
  const cw=(d.capw||[]).filter(r=>r.grupo===grupo), csems=last4Sem(cw);
  const caps2=['5','10','15','28'];
  barChart('t_cap_sem',caps2.map(cap=>{var vs=cw.filter(r=>r.cap===cap && csems.indexOf(r.semana)>=0 && r.consol_pct!=null).map(r=>r.consol_pct);return avg(vs)||0;}),caps2.map(c=>c+'t'),0,100,R.grey,'%',null,v=>Math.round(v),{v:META.consol,lbl:'Meta '+META.consol+'%'});
  const cc=d.com.filter(r=>r.grupo===grupo && r.segmento===_segT && (r.toneladas||0)>=10 && r.tarifa_kg!=null && r.comuna!=='(s/comuna)');
  hbarChart('t_caro',cc.slice().sort((a,b)=>b.tarifa_kg-a.tarifa_kg).slice(0,5).map(r=>({label:r.comuna,value:r.tarifa_kg})),R.red2,' $/kg','');
  hbarChart('t_barato',cc.slice().sort((a,b)=>a.tarifa_kg-b.tarifa_kg).slice(0,5).map(r=>({label:r.comuna,value:r.tarifa_kg})),R.grey,' $/kg','');
  const ebcG=d.ebc.filter(r=>r.grupo===grupo);
  if(ebcG.length){
    const ebcM=mesesPeriodo();   // ene → mes en curso (todo el período)
    const sumM=(m,f)=>sum(ebcG.filter(x=>x.mes_label===m).map(r=>r[f]||0));
    lineChart('t_ebc',[{n:'Pagado',v:ebcM.map(m=>sumM(m,'pagado')/1e6),c:R.red2},{n:'Cobrado',v:ebcM.map(m=>sumM(m,'cobrado')/1e6),c:R.red}],ebcM.map(mesCorto),0,niceMax(ebcG.map(r=>r.pagado/1e6)),' MM');
    barChart('t_ebc_neto',ebcM.map(m=>(sumM(m,'pagado')-sumM(m,'cobrado'))/1e6),ebcM.map(mesCorto),0,niceMax(ebcG.map(r=>(r.pagado-r.cobrado)/1e6)),R.grey,' MM',null,money1);
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
      const [mg,sc,vn,sem]=await Promise.all([
        supabase.from('v_ind_margen_grupo_mes').select('*'),
        supabase.from('v_ind_sin_cobro_grupo_mes').select('*'),
        supabase.from('v_ind_vendedor_grupo').select('*'),
        supabase.from('v_ind_margen_grupo_semana').select('*')
      ]);
      const e=mg.error||sc.error||vn.error||sem.error; if(e) throw e;
      _cacheMar2={mg:mg.data||[],sc:sc.data||[],vn:vn.data||[],sem:sem.data||[]};
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
    ${card('Semana Móvil Margen de Flete — '+nice(grupo),'Margen $MM y Cobertura Semanal',
      (function(){ var s4=last4(d.sem,grupo), w=s4[s4.length-1]||{};
        return tileS('Margen — '+semLbl(w.semana||''),mm((w.margen||0)/1e6),'última semana cerrada',w.margen==null?null:(w.margen>=0?{c:'#1E8449',t:'Positivo'}:{c:'#C0000C',t:'Negativo'}))+
          tileS('Cobertura — '+semLbl(w.semana||''),pct(w.cobertura_pct),'cobrado / pagado',semaforo(w.cobertura_pct,META.cobertura,10))+
          tile('Margen 4 semanas',mm(sum(s4.map(r=>r.margen))/1e6),'acumulado')+
          tile('Pagado 4 semanas',mm(sum(s4.map(r=>r.pagado))/1e6),'flete pagado'); })(),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md items-center">`+
      `<div>`+legend([{n:'Margen $MM',c:R.red2}])+`<div id="m_sem"></div></div>`+
      `<div id="m_semtab"></div></div>`)}
    ${card('1 · Pagado vs Cobrado y Cobertura — semanal','Últimas 4 semanas cerradas ($MM y %)','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Cobrado',c:R.red},{n:'Pagado',c:R.grey}])+`<div id="m_pc"></div></div>`+
      `<div>`+legend([{n:'Cobertura %',c:R.red},{n:'Meta '+META.cobertura+'%',c:'#1E8449'}])+`<div id="m_cob"></div></div></div>`)}
    ${card('2 · Flete no cobrado — mensual','Entregas con flete cobrado en 0 (monto sugerido no cobrado)',
      tile('No cobrado (sugerido)',mm(scMonto),'acumulado','text-[#EE1B22]')+
      tile('Entregas sin cobro',nf0.format(scEnt),'acumulado')+
      tile('Líneas',nf0.format(sum(sc.map(r=>r.lineas))),'acumulado')+
      tile('Costo asumido',mm(sum(sc.map(r=>r.monto))/1e6),'flete pagado','text-[#EE1B22]'),
      legend([{n:'No cobrado $MM (sugerido)',c:R.red2}])+`<div id="m_scm"></div>`)}
    ${card('3 · Ranking Vendedor — Flete Cobrado','Brecha = pagado − cobrado (mayor brecha = más subcobra)','',
      vendMargenTablaHTML(d.vn,grupo))}
    <div class="text-[11px] text-secondary mt-lg leading-relaxed">Flete no cobrado = entregas con flete cobrado = 0; monto = flete sugerido (lo que no se cobró). Ranking excluye EbemaClick.</div>
  </div>`;
}
function vendMargenTablaHTML(rows,grupo){
  const v=(rows||[]).filter(r=>r.grupo===grupo && r.segmento===_segM)
    .map(r=>({...r,brechaPC:(r.pagado||0)-(r.cobrado||0)}))
    .sort((a,b)=>b.brechaPC-a.brechaPC).slice(0,10);
  if(!v.length) return `<div class="text-secondary text-[12px] py-md">Sin datos.</div>`;
  const filas=v.map(r=>`<tr class="border-t border-surface-variant">
    <td class="py-[4px] pr-sm">${r.vendedor||'—'}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.sugerido||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.cobrado||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.pagado||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums ${r.brechaPC>0?'text-[#C0000C]':''}">${mm(r.brechaPC/1e6)}</td>
    <td class="py-[4px] text-right tabular-nums">${pct(r.cumplimiento_pct)}</td></tr>`).join('');
  return `<table class="w-full text-[12px]"><thead><tr class="text-secondary text-left">
    <th class="font-medium pb-[4px]">Vendedor</th><th class="font-medium text-right pb-[4px]">Sugerido</th><th class="font-medium text-right pb-[4px]">Cobrado</th><th class="font-medium text-right pb-[4px]">Pagado</th><th class="font-medium text-right pb-[4px]">Brecha</th><th class="font-medium text-right pb-[4px]">Cumpl.</th></tr></thead><tbody>${filas}</tbody></table>`;
}
function drawMargen(d,grupo){
  const s4=last4(d.sem,grupo);
  barChart('m_sem',s4.map(r=>r.margen/1e6),s4.map(r=>semLbl(r.semana)),Math.min(-0.5,niceMin(s4.map(r=>r.margen/1e6))),Math.max(0.5,niceMax(s4.map(r=>r.margen/1e6))),R.red2,' MM',null,money1);
  const mt=document.getElementById('m_semtab'); if(mt) mt.innerHTML=semTable(s4,[
    {label:'Margen',get:r=>r.margen/1e6,fmt:v=>mm(v),dfmt:money1},
    {label:'Cobertura',get:r=>r.cobertura_pct,fmt:pct,dfmt:v=>nf1.format(v)+' pp'}]);
  const wL=s4.map(r=>semLbl(r.semana));
  lineChart('m_pc',[{n:'Cobrado',v:s4.map(r=>r.cobrado/1e6),c:R.red},{n:'Pagado',v:s4.map(r=>r.pagado/1e6),c:R.grey}],wL,0,niceMax(s4.map(r=>Math.max(r.cobrado,r.pagado)/1e6)),' MM');
  lineChart('m_cob',[{n:'Cobertura',v:s4.map(r=>r.cobertura_pct),c:R.red}],wL,0,120,'%',undefined,{v:META.cobertura,lbl:'Meta cobertura '+META.cobertura+'%'});
  const sc=d.sc.filter(r=>r.grupo===grupo && r.segmento===_segM).slice().sort((a,b)=>a.mes_label<b.mes_label?-1:1);
  barChart('m_scm',sc.map(r=>(r.monto_sugerido||0)/1e6),sc.map(r=>mesCorto(r.mes_label)),0,niceMax(sc.map(r=>(r.monto_sugerido||0)/1e6)),R.red2,' MM',sc.length-1,money1);
}
