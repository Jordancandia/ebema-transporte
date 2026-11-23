// ============================================================================
//  INDICADORES · Consolidado General + Drill por Centro
//  Nivel de Servicio · Pesos por Kilo · Margen Cobrado vs Pagado · Operación
//  (Flete Tercero se retiró del Consolidado el 28-sep-2026: vive en su propio menú)
//  Lee en vivo las vistas v_ind_* de Supabase (RLS: usuario @ebema.cl con rol).
//  Paleta alineada a las presentaciones (PPT) del Comité de Transporte.
// ============================================================================
import { supabase } from './supabase-client.js?v=202611231829';
import { centrosAlcance } from './permisos.js?v=202611231829';

// --- Paleta PPT -------------------------------------------------------------
const C = {
  navy:'#0B2B4A', blue:'#2E75B6', orange:'#E97132', red:'#EE1B22',
  green:'#1E8449', ink:'#333333', muted:'#808285', grid:'#D9D5CF'
};
// Paleta Consolidado: solo tonos rojos y grises
const R = {
  red:'#B5000B', red2:'#E30613', redL:'#E88A8F',
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
  if (['consolidado','nivel','tarifa','margen','despachos','transportistas'].indexOf(sub) >= 0) _view = sub;
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
const nice = s => String(s||'').toLowerCase().split(' ').map(w=>w==='y'?w:w.charAt(0).toUpperCase()+w.slice(1)).join(' ');

// ============================================================================
//  ENTRYPOINT
// ============================================================================
export async function renderIndicadoresView(container){
  _container = container;
  uxInit(container);
  if (_view === 'nivel')  return renderNivel(container);
  if (_view === 'tarifa') return renderTarifa(container);
  if (_view === 'margen') return renderMargen(container);
  if (_view === 'despachos') return renderDespachos(container);
  if (_view === 'transportistas') return renderTransportistas(container);
  paintShell();
  await loadGeneral();
}

function renderStub(container, titulo){
  container.innerHTML = `<div class="w-full mx-auto" style="max-width:1760px">
    <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg text-center text-secondary">
      <div class="text-headline-sm font-bold text-on-surface mb-1">${titulo} — vista de detalle</div>
      <div class="text-body-md">En desarrollo. El detalle de Nivel de Servicio ya está disponible; Tarifa y Margen se construyen en la próxima iteración.</div>
      <div class="text-[14px] mt-sm">Mientras tanto, revisa el <b>Consolidado</b> y el <b>HOME</b>.</div>
    </div></div>`;
}

function paintShell(){
  _container.innerHTML = `
  <div class="w-full mx-auto" style="max-width:1760px">
    <div class="flex items-center justify-between gap-md flex-wrap mb-md">
      <div class="text-headline-sm font-bold" id="ind_gen_tit">Consolidado General</div>
      <div class="flex items-center gap-sm flex-wrap ml-auto">
        <label class="text-secondary text-body-md" for="ind_selg">Centro:</label>
        <select id="ind_selg" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface" disabled><option>Cargando…</option></select>
        <span class="text-[13px] text-secondary border border-surface-variant rounded-full px-md py-[3px]">Actualización diaria 08:00 · Supabase</span>
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
    ebm: porMes(f(g.ebm),(k,rs)=>({ mes_label:k, entregas:sum(rs.map(r=>r.entregas)), docs:sum(rs.map(r=>r.docs)), toneladas:sum(rs.map(r=>r.toneladas)), pagado:sum(rs.map(r=>r.pagado)), cobrado:sum(rs.map(r=>r.cobrado)), entregas_sobrecosto:sum(rs.map(r=>r.entregas_sobrecosto)), pagado_sobrecosto:sum(rs.map(r=>r.pagado_sobrecosto)) }))
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
    const grupos = [...new Set([].concat(_cacheCen.ns||[],_cacheCen.tar||[],_cacheCen.mar||[]).map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
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
      <div class="text-[14px] text-secondary">último mes cerrado de cada indicador vs el mes anterior · clic para ir al detalle</div></div>
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
      `<div><div class="text-[14px] text-secondary mb-1 font-medium">Nivel de consolidación % — más rojo = menor consolidación</div>`+
      heatmapHTML(d.tq,'consol_pct',heatConsolRG,v=>nf1.format(v))+`</div>`+
      `<div><div class="text-[14px] text-secondary mb-1 font-medium">Pesos por kilo $/kg — más rojo = más caro</div>`+
      heatmapHTML(d.tq,'tarifa_kg',heatTarRG,money1)+`</div></div>`)}

    ${card('3.3 · Impacto EbemaClick','Costo, despachos y toneladas',
      tile('Despachos',nf0.format(sum(d.ebm.map(r=>r.entregas))),'entregas E-Click · '+nf0.format(sum(d.ebm.map(r=>r.entregas_sobrecosto)))+' sobrecosto 400141')+
      tile('Toneladas despachadas',(function(){var t=sum(d.ebm.map(r=>r.toneladas));return t?nf1.format(t)+' t':'–';})(),'período')+
      tile('Documentos',nf0.format(sum(d.ebm.map(r=>r.docs))),'transporte · período')+
      tile('Costo pagado',mm(sum(d.ebm.map(r=>r.pagado))/1e6),'flete pagado · incl. 400141 '+mm(sum(d.ebm.map(r=>r.pagado_sobrecosto))/1e6),'text-[#C0000C]'),
      legend([{n:'Costo EbemaClick $MM',c:R.red2}])+`<div id="g_ebc_mes"></div>`)}

    ${card('4 · Operación — última milla','Consolidación y Tiempo de Facturación',
      tile('Consolidación — '+mesCorto((d.con[d.con.length-2]||d.con[d.con.length-1]||{}).mes_label||''),pct((d.con[d.con.length-2]||d.con[d.con.length-1]||{}).consol_pct),'% capacidad usada')+
      tileS('Consolidación promedio',pct(avg(d.con.map(r=>r.consol_pct))),'año',semaforo(avg(d.con.map(r=>r.consol_pct)),META.consol,10))+
      tile('Días entrega→transporte',(function(){var r=d.tie[d.tie.length-2]||d.tie[d.tie.length-1]||{};return r.dias_prom!=null?nf1.format(r.dias_prom)+' d':'–';})(),'último mes')+
      tile('Días promedio',(function(){var v=avg(d.tie.map(r=>r.dias_prom));return v!=null?nf1.format(v)+' d':'–';})(),'año'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Consolidación %',c:R.red2}])+`<div id="g_consol"></div></div>`+
      `<div>`+legend([{n:'Días entrega→transporte',c:R.grey}])+`<div id="g_tiempo"></div></div></div>`,'sec-op')}

    <div class="text-[13px] text-secondary mt-lg leading-relaxed">Todos los indicadores son de <b>última milla</b> (entregas a cliente); se excluye reposición troncal. El <b>3.2</b> es específicamente troncal Quilicura (solo documentos con HES). Con un <b>centro</b> seleccionado, todo se calcula con las vistas por centro de origen (última milla) y el 3.2 muestra sólo la fila de ese centro. Flete Tercero (REVEX) se revisa en su propio menú. OTIF/Fill incluyen el mes en curso cuando el archivo de notas de venta lo trae (hoy la fuente llega a julio). Tarifa, margen y operación incluyen el mes en curso parcial.</div>`;
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
      <span class="text-[14px] text-secondary">Ventana: últimas semanas cerradas (semana móvil)</span>
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

    <div class="text-[13px] text-secondary mt-lg leading-relaxed">Centro = grupo de origen (Centro Origen). OTIF por semana ISO llega al último mes cerrado; tarifa, margen y operación a la fecha más reciente. Comuna = 2º tramo de la ruta. Consolidación = Σpeso ÷ (capacidad×1000) por viaje. Planta Corte y Doblado (1001) se informa como centro independiente; Electrosoldado se agrupa en Santiago.</div>`;
}

function vendTablaHTML(rows, grupo){
  const v = (rows||[]).filter(r=>r.grupo===grupo).slice().sort((a,b)=> (a.brecha||0)-(b.brecha||0)).slice(0,6);
  if (!v.length) return legend([{n:'Cumplimiento de cobro por vendedor',c:C.navy}])+`<div class="text-secondary text-[14px] py-md">Sin datos en la ventana.</div>`;
  const filas = v.map(r=>`<tr class="border-t border-surface-variant">
    <td class="py-[4px] pr-sm">${r.vendedor||'—'}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums ${(r.brecha||0)<0?'text-[#EE1B22]':''}">${mm((r.brecha||0)/1e6)}</td>
    <td class="py-[4px] text-right tabular-nums">${pct(r.cumplimiento_pct)}</td></tr>`).join('');
  return legend([{n:'Cumplimiento de cobro por vendedor (los que más subcobran)',c:C.navy}])+
    `<table class="w-full text-[14px]"><thead><tr class="text-secondary text-left">
      <th class="font-medium pb-[4px]">Vendedor</th><th class="font-medium text-right pb-[4px]">Brecha</th><th class="font-medium text-right pb-[4px]">Cumpl.</th></tr></thead>
      <tbody>${filas}</tbody></table>`;
}

// ============================================================================
//  HEATMAP (matriz centro × mes)
// ============================================================================
function heatOtif(v){ return v>=90?'#C6E0B4':v>=85?'#E2EFDA':v>=80?'#FFF2CC':v>=75?'#FCE4D6':v>=70?'#F8CBAD':'#F4B7B4'; }
function heatTarifa(v){ return v<18?'#C6E0B4':v<24?'#E2EFDA':v<30?'#FFF2CC':v<40?'#FCE4D6':v<55?'#F8CBAD':'#F4B7B4'; }
function heatmapHTML(rows, key, colorFn, fmt){
  if(!rows||!rows.length) return `<div class="text-secondary text-[14px] py-sm">Sin datos.</div>`;
  const months=[...new Set(rows.map(r=>r.mes_label))].sort();
  const grupos=[...new Set(rows.map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
  const map={}; rows.forEach(r=>{ (map[r.grupo]=map[r.grupo]||{})[r.mes_label]=r[key]; });
  const head=`<th class="text-left font-medium text-secondary pr-sm">Centro</th>`+months.map(m=>`<th class="font-medium text-secondary px-[6px] text-center">${mesCorto(m)}</th>`).join('');
  const bodyr=grupos.map(g=>{
    const cells=months.map(m=>{ const v=(map[g]||{})[m];
      return `<td class="text-center px-[6px] py-[3px] tabular-nums" style="background:${v==null?'transparent':colorFn(v)};color:#333">${v==null?'':fmt(v)}</td>`; }).join('');
    return `<tr><td class="pr-sm py-[3px] text-[14px] whitespace-nowrap">${nice(g)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="ind-heat overflow-x-auto"><table class="text-[13px] border-separate" style="border-spacing:2px"><thead><tr>${head}</tr></thead><tbody>${bodyr}</tbody></table></div>`;
}

// ============================================================================
//  DIBUJO
// ============================================================================
// ---- Núcleo de gráficos v2 (27-sep-2026) ------------------------------------
// Dibuja al ANCHO REAL del contenedor (texto siempre ~11 px, antes escalaba con
// el viewBox fijo 560 → 5-16 px), escala de ejes "redonda", etiquetas que no se
// pisan, línea de meta opcional y redibujo al cambiar el tamaño de la ventana.
let W=560, PR=18; const H=260,PL=52,PT=20,PB=30;   // PR crece a 66 cuando hay etiqueta de meta
const FS=13, META_C='#1E8449';
const META={ otif:90, fill:95, consol:85, cobertura:100 };   // metas (editar aquí)
const _charts=new Map(); let _rsT=null;
window.addEventListener('resize',function(){ clearTimeout(_rsT); _rsT=setTimeout(function(){
  _charts.forEach(function(fn,id){ var el=document.getElementById(id); if(el&&el.isConnected&&el.clientWidth) fn(); else _charts.delete(id); });
},200); });
// Si el layout termina de asentarse después del primer dibujo (grid/CSS tardío), se redibuja al ancho real
const _cw=new Map(); let _chkT=null;
function _chkWidths(){ _charts.forEach(function(fn,id){ var el=document.getElementById(id); if(el&&el.isConnected&&el.clientWidth&&Math.abs(el.clientWidth-(_cw.get(id)||0))>20) fn(); }); }
function _prep(elId,fn){ var el=document.getElementById(elId); if(!el) return null; _charts.set(elId,fn); W=Math.max(300,Math.round(el.clientWidth||560)); _cw.set(elId,el.clientWidth||0);
  clearTimeout(_chkT); _chkT=setTimeout(_chkWidths,350); return el; }
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
  var el=_prep(elId,function(){lineChart(elId,series,labels,mn,mx,unit,softFrom,meta);}); if(!el) return; PR=meta?76:18;
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
  if(!rows.length) return `<div class="text-secondary text-[14px] py-md">Sin semanas cerradas.</div>`;
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
  return `<table class="w-full text-[14px]"><thead>${head}</thead><tbody>${body}</tbody></table>`;
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
  var el=_prep(elId,function(){barChart(elId,vals,labels,mn,mx,color,unit,part,tickFmt,meta);}); if(!el) return; PR=meta?76:18;
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
  return `<section data-card ${ancla?'id="'+ancla+'"':''} style="scroll-margin-top:80px" class="ux-card">
    <div class="ux-card-h"><div class="ux-card-k">${title}</div><div class="ux-card-t">${lead}</div></div>
    ${tiles?`<div class="ux-tiles">${tiles}</div>`:''}
    ${chartsHTML}</section>`;
}
function tile(k,v,d,cls=''){
  return `<div class="ux-tile"><div class="ux-tile-k">${k}</div><div class="ux-tile-v ${cls}">${v}</div><div class="ux-tile-d">${d||''}</div></div>`;
}
// --- Semáforo vs meta (27-sep-2026) -------------------------------------------
// better='up' (más es mejor) | 'down' (menos es mejor). tol = margen "cerca de meta".
function semaforo(v,meta,tol,better){
  if(v==null||meta==null) return null;
  var ok = better==='down' ? v<=meta : v>=meta;
  var cerca = better==='down' ? v<=meta+tol : v>=meta-tol;
  return ok ? {c:'#1E8449',t:'Sobre meta'} : cerca ? {c:'#B5730B',t:'Cerca de meta'} : {c:'#B5000B',t:'Bajo meta'};
}
function stKind(st){ if(!st) return null; return (st.t==='Sobre meta'||st.t==='Positivo')?'ok':(st.t==='Cerca de meta'?'warn':'bad'); }
function stChip(st){ const k=stKind(st); if(!k) return ''; return `<span class="ux-chip ux-${k}">${{ok:'✓',warn:'!',bad:'✕'}[k]} ${st.t}</span>`; }
function tileS(k,v,d,st,cls=''){
  return `<div class="ux-tile"><div class="ux-tile-k">${k}</div><div class="ux-tile-v ${cls}">${v}</div>${stChip(st)}<div class="ux-tile-d">${d||''}</div></div>`;
}
// Tarjeta KPI (rediseño 23-nov-2026): valor + estado vs meta + variación vs período anterior
function kpiExec(o){
  var d=o.delta, dTxt='', dSty='color:#5C5F61';
  if(d!=null){ var z=Math.abs(d)<1e-9 || /^[^1-9]*$/.test(o.dfmt(Math.abs(d)));
    var bueno=z?null:((o.better==='down')?d<0:d>0);
    dTxt=z?'= vs '+o.prevLbl:((d>0?'▲ +':'▼ ')+o.dfmt(d)+' vs '+o.prevLbl);
    dSty=bueno==null?'color:#5C5F61':(bueno?'color:#1E7A46':'color:#B5000B'); }
  return `<a href="#${o.ancla}" class="ux-kpi" data-uxgo="#${o.ancla}">
    <div class="ux-kpi-top"><span class="ux-kpi-k">${o.k}</span>${stChip(o.st)}</div>
    <div class="ux-kpi-v">${o.v}</div>
    <div class="ux-kpi-s">${o.st&&o.meta!=null?'Meta '+o.meta:(o.sub||'&nbsp;')}${o.per?' · '+o.per:''}</div>
    <div class="ux-kpi-d" style="${dSty}">${dTxt||'&nbsp;'}</div></a>`;
}
function legend(items){
  return `<div class="flex flex-wrap gap-md text-[14px] text-secondary mb-sm">`+
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
  btn.style.cssText='position:absolute;top:8px;right:8px;border:1px solid rgba(11,11,11,.14);background:rgba(255,255,255,.92);border-radius:6px;height:26px;padding:0 8px;font-size:15px;line-height:1;cursor:pointer;color:#333;z-index:4;display:inline-flex;align-items:center;gap:5px';
  btn.innerHTML='⤢ <span style="font-size:13px">Ampliar</span>';
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
    <div class="text-[14px] mt-sm">Verifica tu sesión (rol reconocido) o la carga 08:00 (tabla <code>ind_log</code>).</div></div>`;
}

// ============================================================================
//  HOME (pantalla principal) — rediseño 28-sep-2026
//  Fila 1: 6 KPI con semáforo vs meta, Δ vs mes anterior y sparkline (mismo período).
//  Fila 2: "Requiere atención" (centros bajo meta / mayores caídas) + "Operación de hoy"
//          (Plan de Carga, Flete Tercero, estado de las cargas automáticas).
//  Fila 3: "Ver por centro" despliega la matriz centro × KPI (ordenable).
//  Perfiles con centros asignados: la BD (RLS) sólo devuelve sus grupos.
// ============================================================================
const HM = { good:'#1E8449', warn:'#B5730B', bad:'#C0000C', goodBg:'#E6F2EA', warnBg:'#FBF0DD', badBg:'#FBE3E4',
             line:'#6B6E70', faint:'#A9ACAE', border:'#e3e0dc', ink:'#1c1b1a', muted:'#6B6E70', soft:'#FAF9F8' };
const MES_LARGO = {'01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio','07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre'};
let _homeMx = { open:false, sort:'otif', dir:1, rows:[] };
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const hoyISO = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const isoLocal = ts => { const d=new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const hhmm = ts => new Date(ts).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',hour12:false});
const ddmm = ts => new Date(ts).toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'});
const tc = s => String(s||'').toLowerCase().replace(/(^|[\s-])\S/g, m => m.toUpperCase()).replace(/ Y /g,' y ');
function stKey(v,meta,tol){ if(v==null||meta==null) return null; return v>=meta?'good':(v>=meta-tol?'warn':'bad'); }
const ST_TXT = { good:'Sobre meta', warn:'Cerca de meta', bad:'Bajo meta' };
function homeGo(tab,sub){
  const sel = sub ? `.sidebar-item[data-tab="${tab}"][data-sub="${sub}"]` : `.sidebar-item[data-tab="${tab}"]:not([data-sub])`;
  const el = document.querySelector(sel); if (el) el.click();
}

export async function renderIndicadoresHome(container){
  container.innerHTML = loadingHTML();
  try {
    const y='2026-01';
    const alc = centrosAlcance();
    // --- Series mensuales (red o alcance del perfil) -------------------------
    let D;
    if (alc !== null) {
      D = await homeDatosAlcance(y);
    } else {
      const [ns,tar,mar,con] = await Promise.all([
        supabase.from('v_ind_ns_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_tarifa_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_margen_general_mes').select('*').gte('mes_label',y).order('mes_label'),
        supabase.from('v_ind_consol_general_mes').select('*').gte('mes_label',y).order('mes_label')
      ]);
      const e=ns.error||tar.error||mar.error||con.error; if(e) throw e;
      D={ns:ns.data||[],tar:tar.data||[],mar:mar.data||[],con:con.data||[]};
    }
    const mesAct = (D.ns[D.ns.length-1]||{}).mes_label;
    const mesAnt = (D.ns[D.ns.length-2]||{}).mes_label;
    // --- Bloques secundarios: si alguno falla, el HOME igual se muestra ------
    const opt = await Promise.allSettled([
      homeDatosGrupo((D.ns[D.ns.length-3]||D.ns[D.ns.length-2]||{}).mes_label, mesAct === hoyISO().slice(0,7)),
      homeOperacion(alc),
      homeFrescura()
    ]);
    const G  = opt[0].status==='fulfilled' ? opt[0].value : null;
    const OP = opt[1].status==='fulfilled' ? opt[1].value : null;
    const FR = opt[2].status==='fulfilled' ? opt[2].value : null;

    const enCurso = mesAct && mesAct === hoyISO().slice(0,7);
    const tituloPer = mesAct ? (MES_LARGO[mesAct.slice(5,7)]+' '+mesAct.slice(0,4)) : '';
    const subPer = (enCurso ? 'mes en curso, parcial al '+ddmm(Date.now()) : 'último mes con datos') + (mesAnt ? ' · comparado con '+(MES_LARGO[mesAnt.slice(5,7)]||'').toLowerCase() : '');
    _homeMx.rows = G ? G.rows : [];

    const ctx={D,G,OP,FR,enCurso,tituloPer,subPer,alc};
    homePaint(container, ctx);
  } catch(e){ container.innerHTML=errorHTML(e); }
}

// --- Vista del HOME: 'gerencial' (scorecard) | 'operativa' (KPI + foco + hoy) ------------
let _homeVista = (()=>{ try { return localStorage.getItem('sit_home_vista') || 'gerencial'; } catch(e){ return 'gerencial'; } })();
function homePaint(container, x){
  const {D,G,OP,FR,enCurso,tituloPer,subPer,alc}=x;
  const tog=(k,l)=>`<button type="button" data-vista="${k}" style="border:none;cursor:pointer;padding:8px 18px;font-size:14px;font-weight:700;border-radius:999px;background:${_homeVista===k?HM.ink:'transparent'};color:${_homeVista===k?'#fff':HM.muted}">${l}</button>`;
  const cuerpo = _homeVista==='gerencial'
    ? homeGerencial(D,G,enCurso,tituloPer)
    : `<div class="grid grid-cols-2 lg:grid-cols-4 gap-md" id="home_kpis">${homeKpis(D, enCurso)}</div>
      <section class="bg-surface-container-lowest border border-surface-variant rounded-xl" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));min-width:0">
        <div style="padding:20px 24px;min-width:0">${homeFoco(G, D)}</div>
        <div style="padding:20px 24px;min-width:0;border-left:1px solid ${HM.border}">${homeHoy(OP, FR)}</div>
      </section>`;
  container.innerHTML = `<div class="w-full mx-auto" id="home_root" style="max-width:1760px;display:flex;flex-direction:column;gap:20px">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:28px;font-weight:800;line-height:1.2">Indicadores de Transporte</div>
          <div class="text-secondary" style="font-size:16px"><b>${tituloPer}</b> · ${subPer}${alc!==null?' · <b>tus centros</b>':''}</div>
        </div>
        <div role="group" aria-label="Vista" style="display:inline-flex;gap:2px;background:#fff;border:1px solid ${HM.border};border-radius:999px;padding:3px">${tog('gerencial','Gerencial')}${tog('operativa','Operativa')}</div>
      </div>
      ${cuerpo}
      ${G && G.rows.length ? `<section class="bg-surface-container-lowest border border-surface-variant rounded-xl" style="min-width:0">
        <button id="home_mx_btn" type="button" style="width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 16px;background:transparent;border:none;cursor:pointer;text-align:left">
          <span><span class="font-bold">Ver por centro</span> <span class="text-secondary text-[14px]">· ${G.rows.length} centro${G.rows.length>1?'s':''} · ${esc(tituloPer.toLowerCase())} con Δ vs mes anterior</span></span>
          <span class="material-symbols-outlined" id="home_mx_ic" style="transition:transform .15s">expand_more</span>
        </button>
        <div id="home_mx" style="display:none;padding:0 16px 16px"></div>
      </section>` : ''}
    </div>`;
  ensureTip();
  const root = document.getElementById('home_root');
  homeTips(root);
  root.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); const [t,s]=a.getAttribute('data-go').split('|'); homeGo(t,s||null); }));
  root.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => {
    _homeVista=b.getAttribute('data-vista'); try { localStorage.setItem('sit_home_vista',_homeVista); } catch(e){}
    homePaint(container, x); }));
  const btn = document.getElementById('home_mx_btn');
  if (btn) { btn.addEventListener('click', () => { _homeMx.open=!_homeMx.open; homePaintMx(); }); homePaintMx(); }
}

// Vista gerencial: veredicto + scorecard (mes / Δ / acumulado 2026 / meta / estado / tendencia) + mensajes clave
function homeGerencial(D,G,enCurso,tituloPer){
  const last=a=>a[a.length-1]||{}, prev=a=>a[a.length-2]||{};
  const mesL=(tituloPer.split(' ')[0]||'Mes'), antL=mesCorto(prev(D.ns).mes_label||'');
  const cerr=a=>enCurso&&a.length>1?a.slice(0,-1):a;
  const parc=(a,get)=>enCurso&&a.length>1?{v:get(a[a.length-1]),l:mesCorto(a[a.length-1].mes_label||'')}:null;
  const tarC=cerr(D.tar), marC=cerr(D.mar);
  const acc={
    otif: wavg(D.ns.map(r=>[r.otif_pct,r.lineas_evaluadas])),
    tk:   wavg(D.tar.map(r=>[r.tarifa_kg,r.toneladas])),
    mar:  sum(D.mar.map(r=>r.margen))/1e6,
    cob:  (()=>{ const p=sum(D.mar.map(r=>r.pagado)); return p? sum(D.mar.map(r=>r.cobrado))/p*100 : null; })(),
    con:  wavg((D.con||[]).map(r=>[r.consol_pct,r.viajes]))
  };
  const pp=d=>nf1.format(Math.abs(d))+' pp';
  const R=[
    {k:'Nivel de servicio',s:'OTIF',rows:D.ns,get:r=>r.otif_pct,fmt:pct,dfmt:pp,acc:acc.otif,meta:META.otif,metaTxt:META.otif+'%',st:v=>stKey(v,META.otif,5),go:'indicadores|nivel'},
    {k:'Costo de transporte',s:'Tarifa $/kg',rows:tarC,partial:parc(D.tar,r=>r.tarifa_kg),get:r=>r.tarifa_kg,fmt:money,dfmt:d=>money1(Math.abs(d)),better:'down',acc:acc.tk,metaTxt:'≤ prom. año',
      st:v=>v==null||acc.tk==null?null:(v<=acc.tk?'good':(v<=acc.tk*1.05?'warn':'bad')),stTxt:v=>v<=acc.tk?'Bajo promedio':'Sobre promedio',go:'indicadores|tarifa'},
    {k:'Resultado de flete',monto:true,s:'Margen cobrado − pagado',rows:marC,partial:parc(D.mar,r=>r.margen==null?null:r.margen/1e6),get:r=>r.margen==null?null:r.margen/1e6,fmt:mm,dfmt:d=>money1(Math.abs(d))+' MM',acc:acc.mar,metaTxt:'≥ $0',
      st:v=>v==null?null:(v>=0?'good':'bad'),stTxt:v=>v>=0?'Positivo':'Negativo',go:'indicadores|margen'},
    {k:'Cobro del flete',s:'Cobertura cobrado / pagado',rows:marC,partial:parc(D.mar,r=>r.cobertura_pct),get:r=>r.cobertura_pct,fmt:pct,dfmt:pp,acc:acc.cob,meta:META.cobertura,metaTxt:META.cobertura+'%',st:v=>stKey(v,META.cobertura,10),go:'indicadores|margen'},
    {k:'Eficiencia de carga',s:'Consolidación camión',rows:D.con||[],get:r=>r.consol_pct,fmt:pct,dfmt:pp,acc:acc.con,meta:META.consol,metaTxt:META.consol+'%',st:v=>stKey(v,META.consol,10),go:'indicadores|consolidado'}
  ].map(o=>{ const vals=o.rows.map(o.get); const v=vals[vals.length-1], p=vals.length>1?vals[vals.length-2]:null; return Object.assign(o,{vals,v,p,stv:o.st(v),sta:o.better==='down'?null:o.st(o.acc)}); });

  // Veredicto
  const cnt={good:0,warn:0,bad:0}; R.forEach(o=>{ if(o.stv) cnt[o.stv]++; });
  const pill=(st,t)=>`<span style="display:inline-flex;align-items:center;gap:6px;background:${HM[st+'Bg']};color:${HM[st]};border-radius:999px;padding:3px 10px;font-size:14px;font-weight:700;white-space:nowrap">● ${t}</span>`;
  const verd = `<section style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:#fff;border:1px solid ${HM.border};border-radius:12px;padding:20px 24px">
    <div style="min-width:0">
      <div style="font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${HM.muted}">Situación ${esc(mesL.toLowerCase())}${enCurso?' (parcial)':''}</div>
      <div style="font-size:30px;font-weight:800;line-height:1.25;margin-top:2px">${cnt.good} de ${R.length} indicadores en meta</div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${cnt.good?pill('good',cnt.good+' en meta'):''}${cnt.warn?pill('warn',cnt.warn+' cerca'):''}${cnt.bad?pill('bad',cnt.bad+' bajo meta'):''}</div>
    <div style="text-align:right">
      <div style="font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${HM.muted}">Resultado de flete 2026</div>
      <div style="font-size:30px;font-weight:800;color:${acc.mar<0?HM.bad:HM.good};font-variant-numeric:tabular-nums">${sgn(acc.mar)}$${nf0.format(Math.abs(acc.mar))} MM</div>
    </div></section>`;

  // Scorecard
  const th=t=>`<th style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:${HM.muted};font-weight:700;padding:12px 16px;text-align:right;white-space:nowrap;border-bottom:1px solid ${HM.border}">${t}</th>`;
  const stCell=(o,st)=>st?`<span style="display:inline-block;background:${HM[st+'Bg']};color:${HM[st]};border-radius:999px;padding:2px 10px;font-size:14px;font-weight:700;white-space:nowrap">${o.stTxt?o.stTxt(o.v):ST_TXT[st]}</span>`:'–';
  let t=`<section style="background:#fff;border:1px solid ${HM.border};border-radius:12px;overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;min-width:760px;border-collapse:collapse;font-variant-numeric:tabular-nums">
    <thead><tr>${th('Indicador').replace('text-align:right','text-align:left')}${th('Mes')}${th('vs mes ant.')}${th('Acum. 2026')}${th('Meta')}${th('Estado').replace('text-align:right','text-align:center')}${th('Tendencia 2026').replace('text-align:right','text-align:left')}</tr></thead><tbody>`;
  R.forEach((o,i)=>{
    let dTxt='–', dCol=HM.muted;
    if(o.v!=null&&o.p!=null){ const d=o.v-o.p, z=Math.abs(d)<0.05, bueno=z?null:(o.better==='down'?d<0:d>0);
      dTxt=z?'=':(d>0?'▲ +':'▼ ')+o.dfmt(d); dCol=bueno==null?HM.muted:(bueno?HM.good:HM.bad); }
    const bd=i<R.length-1?`border-bottom:1px solid ${HM.border};`:'';
    const col=o.stv?HM[o.stv]:HM.faint;
    t+=`<tr data-go="${o.go}" style="cursor:pointer" title="Ver detalle">
      <td style="${bd}padding:16px;text-align:left;border-left:4px solid ${col}"><div style="font-weight:700;font-size:16px">${o.k}</div><div style="font-size:13px;color:${HM.muted}">${o.s}</div></td>
      <td style="${bd}padding:16px;text-align:right;white-space:nowrap"><div style="font-size:26px;font-weight:800">${o.v==null?'–':o.fmt(o.v)}</div><div style="font-size:13px;color:${HM.muted}">${esc(mesCorto(o.rows.length?o.rows[o.rows.length-1].mes_label:''))}${o.partial?' cerrado · '+esc(o.partial.l)+' parcial '+o.fmt(o.partial.v):(enCurso?' (parcial)':'')}</div></td>
      <td style="${bd}padding:16px;text-align:right;font-size:15px;color:${dCol};white-space:nowrap">${dTxt}</td>
      <td style="${bd}padding:16px;text-align:right;font-size:16px;font-weight:600;white-space:nowrap;color:${o.sta?HM[o.sta]:HM.ink}">${o.acc==null?'–':o.fmt(o.acc)}</td>
      <td style="${bd}padding:16px;text-align:right;font-size:15px;color:${HM.muted};white-space:nowrap">${o.metaTxt}</td>
      <td style="${bd}padding:16px;text-align:center">${stCell(o,o.stv)}</td>
      <td style="${bd}padding:10px 16px;width:260px">${homeSpark(o.vals,o.rows.map(r=>mesCorto(r.mes_label||'')),o.fmt,o.meta!=null?o.meta:null,col,o.monto?null:o.partial)}</td></tr>`;
  });
  t+=`</tbody></table></div></section>`;

  // Mensajes clave + centros vs meta
  const o0=R[0], o1=R[1], o2=R[2], o3=R[3];
  const msg=(k,txt)=>`<li style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;font-size:16px;line-height:1.45"><span style="font-weight:700;color:${HM.muted};font-size:14px;text-transform:uppercase;letter-spacing:.04em;padding-top:2px">${k}</span><span>${txt}</span></li>`;
  const dif=(a,b)=>a!=null&&b!=null?a-b:null;
  const m1= o0.v!=null ? `OTIF <b>${pct(o0.v)}</b>${o0.p!=null?` (${o0.v-o0.p>=0?'+':'−'}${pp(o0.v-o0.p)} vs ${esc(antL)})`:''}; acumulado ${pct(acc.otif)}, <b>${nf1.format(Math.abs(META.otif-acc.otif))} pp ${acc.otif<META.otif?'bajo':'sobre'}</b> la meta.` : '–';
  const dtk=dif(o1.v,acc.tk);
  const mc=o1.rows.length?mesCorto(o1.rows[o1.rows.length-1].mes_label):'';
  const m2= o1.v!=null ? `Tarifa ${esc(mc)} <b>${money(o1.v)}/kg</b>, ${dtk<=0?'bajo':'sobre'} el promedio del año (${money(acc.tk)}/kg) en ${money1(Math.abs(dtk))}.` : '–';
  const m3= `Margen ${esc(mc)} <b>${mm(o2.v)}</b>${o2.partial?` (${esc(o2.partial.l)} a la fecha ${mm(o2.partial.v)}, aún sin facturar completo)`:''}; acumulado <b>${sgn(acc.mar)}$${nf0.format(Math.abs(acc.mar))} MM</b>. Se cobra el ${pct(acc.cob)} de lo que se paga en flete.`;
  let cen='';
  if(G&&G.rows.length){
    const c={good:[],warn:[],bad:[]}; G.rows.forEach(r=>{ const k=stKey(r.otif,META.otif,5); if(k) c[k].push(r); });
    const n=G.rows.filter(r=>r.otif!=null).length, seg=(k)=>c[k].length?`<div data-t="${ST_TXT[k]}: ${c[k].map(r=>tc(r.grupo)).join(', ')}" style="flex:${c[k].length};background:${HM[k]};height:16px"></div>`:'';
    const peor=G.rows.filter(r=>r.otif!=null).sort((a,b)=>a.otif-b.otif).slice(0,3);
    cen=`<div style="min-width:0">
      <div style="font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${HM.muted};margin-bottom:8px">Centros vs meta OTIF</div>
      <div style="display:flex;gap:2px;border-radius:6px;overflow:hidden">${seg('good')}${seg('warn')}${seg('bad')}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:14px;margin-top:8px">
        <span><b style="color:${HM.good}">${c.good.length}</b> en meta</span><span><b style="color:${HM.warn}">${c.warn.length}</b> cerca</span><span><b style="color:${HM.bad}">${c.bad.length}</b> bajo meta</span><span style="color:${HM.muted}">de ${n}</span></div>
      <div style="font-size:14px;color:${HM.muted};margin-top:10px">Más bajos: ${peor.map(r=>`<b style="color:${HM.ink}">${esc(tc(r.grupo))}</b> ${pct(r.otif)}`).join(' · ')}</div>
    </div>`;
  }
  const bottom=`<section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;background:#fff;border:1px solid ${HM.border};border-radius:12px;padding:20px 24px">
    <div style="min-width:0"><div style="font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${HM.muted};margin-bottom:8px">Mensajes clave</div>
      <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">${msg('Servicio',m1)}${msg('Costo',m2)}${msg('Resultado',m3)}</ul></div>
    ${cen}</section>`;
  return verd+t+bottom;
}

// Resumen mensual agregado de los grupos visibles para el usuario (perfiles por centro)
async function homeDatosAlcance(y){
  const [ns,tar,mar,con] = await Promise.all([
    supabase.from('v_ind_ns_grupo_mes').select('*').gte('mes_label',y),
    supabase.from('v_ind_tarifa_grupo_mes').select('*').eq('segmento','TODOS').gte('mes_label',y),
    supabase.from('v_ind_margen_grupo_mes').select('*').eq('segmento','TODOS').gte('mes_label',y),
    supabase.from('v_ind_consol_grupo_mes').select('*').gte('mes_label',y)
  ]);
  const e=ns.error||tar.error||mar.error||con.error; if(e) throw e;
  const porMes=(rows,fn)=>{ const m={}; (rows||[]).forEach(r=>{ (m[r.mes_label]=m[r.mes_label]||[]).push(r); }); return Object.keys(m).sort().map(k=>fn(k,m[k])); };
  return {
    ns: porMes(ns.data,(k,rs)=>({ mes_label:k, otif_pct:wavg(rs.map(r=>[r.otif_pct,r.lineas])), fillrate_pct:wavg(rs.map(r=>[r.fillrate_pct,r.lineas])), lineas_evaluadas:sum(rs.map(r=>r.lineas)) })),
    tar: porMes(tar.data,(k,rs)=>({ mes_label:k, toneladas:sum(rs.map(r=>r.toneladas)), tarifa_kg:wavg(rs.map(r=>[r.tarifa_kg,r.toneladas])) })),
    mar: porMes(mar.data,(k,rs)=>{ const c=sum(rs.map(r=>r.cobrado)), p=sum(rs.map(r=>r.pagado)); return { mes_label:k, cobrado:c, pagado:p, margen:sum(rs.map(r=>r.margen)), cobertura_pct:p?c/p*100:null }; }),
    con: porMes(con.data,(k,rs)=>({ mes_label:k, consol_pct:wavg(rs.map(r=>[r.consol_pct,r.viajes])), viajes:sum(rs.map(r=>r.viajes)) }))
  };
}

// Datos por grupo (mes actual + anterior) para "Requiere atención" y la matriz
async function homeDatosGrupo(desde, enCurso){
  if(!desde) return null;
  const [ns,tar,mar,con] = await Promise.all([
    supabase.from('v_ind_ns_grupo_mes').select('*').gte('mes_label',desde),
    supabase.from('v_ind_tarifa_grupo_mes').select('*').eq('segmento','TODOS').gte('mes_label',desde),
    supabase.from('v_ind_margen_grupo_mes').select('*').eq('segmento','TODOS').gte('mes_label',desde),
    supabase.from('v_ind_consol_grupo_mes').select('*').gte('mes_label',desde)
  ]);
  const e=ns.error||tar.error||mar.error||con.error; if(e) throw e;
  const meses=[...new Set((ns.data||[]).map(r=>r.mes_label))].sort();
  const act=meses[meses.length-1], ant=meses.length>1?meses[meses.length-2]:null, ant2=meses.length>2?meses[meses.length-3]:null;
  const fc = enCurso && ant ? ant : act, fc0 = enCurso && ant ? ant2 : ant;   // mes cerrado para datos de flete
  const idx=(rows)=>{ const m={}; (rows||[]).forEach(r=>{ m[r.grupo+'|'+r.mes_label]=r; }); return m; };
  const iN=idx(ns.data), iT=idx(tar.data), iM=idx(mar.data), iC=idx(con.data);
  const grupos=[...new Set([].concat(ns.data||[],tar.data||[],mar.data||[]).map(r=>r.grupo))].filter(g=>g&&g!=='OTROS');
  const v=(i,g,m,k)=>{ const r=i[g+'|'+m]; return r&&r[k]!=null?Number(r[k]):null; };
  const rows=grupos.map(g=>({
    grupo:g,
    otif:v(iN,g,act,'otif_pct'), otif0:v(iN,g,ant,'otif_pct'),
    fill:v(iN,g,act,'fillrate_pct'), fill0:v(iN,g,ant,'fillrate_pct'),
    lineas:v(iN,g,act,'lineas'),
    consol:v(iC,g,act,'consol_pct'), consol0:v(iC,g,ant,'consol_pct'),
    tk:v(iT,g,fc,'tarifa_kg'), tk0:v(iT,g,fc0,'tarifa_kg'), ton:v(iT,g,fc,'toneladas'),
    margen:v(iM,g,fc,'margen'), cob:v(iM,g,fc,'cobertura_pct')
  })).filter(r=>r.otif!=null||r.tk!=null||r.margen!=null);
  return { act, ant, fc, rows };
}

// Operación del día: Plan de Carga (último snapshot) + Flete Tercero (vencidos / en curso)
async function homeOperacion(alc){
  const enAlc = c => alc===null || alc.includes(String(c||'').trim());
  const [ult, lc, ftg, ftv, ftc] = await Promise.all([
    supabase.from('abast_plan_carga_snapshot').select('fecha').order('fecha',{ascending:false}).limit(1),
    supabase.from('logistics_centres').select('id,nombre,origen_grupo'),
    supabase.from('v_ft_ns_general').select('*'),
    supabase.from('v_ft_vencidos').select('centro_responsable,dias_atraso_habiles'),
    supabase.from('v_ft_en_curso').select('centro_responsable,dias_habiles_para_vencer')
  ]);
  const nom={}; (lc.data||[]).forEach(r=>{ nom[String(r.id)]=r.origen_grupo?tc(r.origen_grupo):(r.nombre||r.id); });
  let plan=null;
  const fecha = ult.data && ult.data[0] ? ult.data[0].fecha : null;
  if (fecha) {
    const sn = await supabase.from('abast_plan_carga_snapshot').select('cd_origen,ce,ton,tomado_en,medido').eq('fecha',fecha);
    // (30-sep-2026) Sólo camiones programados (camión CD en PROGRAMAR, 2º camión aceptado, directos)
    const rows=(sn.data||[]).filter(r=>r.medido!==false).filter(r=>enAlc(r.ce)||enAlc(r.cd_origen));
    const porCd={}; let tomado=null;
    rows.forEach(r=>{ const k=String(r.cd_origen||''); porCd[k]=porCd[k]||{ton:0,ces:new Set()}; porCd[k].ton+=Number(r.ton)||0; porCd[k].ces.add(String(r.ce||'')); if(!tomado||r.tomado_en>tomado) tomado=r.tomado_en; });
    plan={ fecha, tomado, total:sum(Object.values(porCd).map(x=>x.ton)), cds:Object.keys(porCd).sort().map(k=>({cd:k, ton:porCd[k].ton, ces:porCd[k].ces.size})) };
  }
  const venc=(ftv.data||[]).filter(r=>enAlc(r.centro_responsable));
  const curso=(ftc.data||[]).filter(r=>enAlc(r.centro_responsable));
  const porCen={}; venc.forEach(r=>{ const k=String(r.centro_responsable||''); porCen[k]=(porCen[k]||0)+1; });
  const topVenc=Object.entries(porCen).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,n])=>({c, nombre:nom[c]||c, n}));
  const g=(ftg.data||[])[0]||null;
  return { plan, nom, ft:{ otif: alc===null && g ? Number(g.otif_pct) : null, fill: alc===null && g ? Number(g.fill_pct) : null,
    vencidos:venc.length, masAtraso:venc.reduce((m,r)=>Math.max(m,Number(r.dias_atraso_habiles)||0),0),
    enCurso:curso.length, venceHoy:curso.filter(r=>Number(r.dias_habiles_para_vencer)<=0).length, topVenc } };
}

// Estado de las cargas automáticas (Apps Script): indicadores 08:00 y lecturas SAP de troncales
async function homeFrescura(){
  const [il, tl] = await Promise.all([
    supabase.from('ind_log').select('corrida,fuente,estado,mensaje,loaded_at').order('loaded_at',{ascending:false}).limit(15),
    supabase.from('trc_log').select('fuente,estado,mensaje,cargado_en').order('cargado_en',{ascending:false}).limit(80)
  ]);
  const ind=il.data||[], trc=tl.data||[];
  const ultCorr = ind[0] ? ind[0].corrida : null;
  const corr = ind.filter(r=>r.corrida===ultCorr);
  const indErr = corr.filter(r=>String(r.estado||'').toLowerCase()!=='ok');
  const indTs = ind[0] ? ind[0].loaded_at : null;
  const trcOk = trc.find(r=>String(r.estado||'').toLowerCase()==='ok');
  const trcErr = trc.filter(r=>{ const s=String(r.estado||'').toLowerCase(); return s!=='ok' && s!=='sin_correo' && (Date.now()-new Date(r.cargado_en).getTime())<6*3600e3; });
  return { indTs, indHoy: indTs ? isoLocal(indTs)===hoyISO() : false, indErr, trcTs: trcOk?trcOk.cargado_en:null, trcHoy: trcOk?isoLocal(trcOk.cargado_en)===hoyISO():false, trcErr };
}

// --- Piezas de UI -------------------------------------------------------------
function homeSpark(vals,labels,fmt,meta,endColor,partial){
  const pts=vals.map((v,i)=>({v:v==null?null:Number(v),l:labels[i]})).filter(p=>p.v!=null);
  if(pts.length<2) return '<div style="height:36px"></div>';
  const par = partial && partial.v!=null ? {v:Number(partial.v), l:partial.l} : null;
  const nx = pts.length + (par?1:0);
  const Wd=200,Ht=36,p=4, arr=pts.map(p=>p.v).concat(meta!=null?[meta]:[]).concat(par?[par.v]:[]);
  const mn=Math.min.apply(null,arr), mx=Math.max.apply(null,arr), r=(mx-mn)||1;
  const x=i=>p+i*(Wd-2*p)/(nx-1), y=v=>Ht-p-(v-mn)/r*(Ht-2*p);
  const d=pts.map((q,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(q.v).toFixed(1)).join(' ');
  const li=pts.length-1;
  let s=`<svg viewBox="0 0 ${Wd} ${Ht}" style="width:100%;height:auto;display:block;margin-top:6px" aria-hidden="true">`;
  s+=`<path d="${d} L${x(li).toFixed(1)} ${Ht} L${x(0)} ${Ht} Z" fill="${HM.line}" opacity=".08"/>`;
  if(meta!=null) s+=`<line x1="0" x2="${Wd}" y1="${y(meta).toFixed(1)}" y2="${y(meta).toFixed(1)}" stroke="${HM.good}" stroke-dasharray="3 3" stroke-width="1"/>`;
  s+=`<path d="${d}" fill="none" stroke="${HM.line}" stroke-width="1.8" stroke-linejoin="round"/>`;
  if(par) s+=`<line x1="${x(li).toFixed(1)}" y1="${y(pts[li].v).toFixed(1)}" x2="${x(li+1).toFixed(1)}" y2="${y(par.v).toFixed(1)}" stroke="${HM.faint}" stroke-width="1.5" stroke-dasharray="3 3"/>`+
    `<circle cx="${x(li+1).toFixed(1)}" cy="${y(par.v).toFixed(1)}" r="3" fill="#fff" stroke="${HM.faint}" stroke-width="1.5"/>`+
    `<rect x="${(x(li+1)-9).toFixed(1)}" y="0" width="18" height="${Ht}" fill="transparent" data-t="${esc(par.l)} (parcial, aún sin facturar completo): ${esc(fmt(par.v))}"/>`;
  pts.forEach((q,i)=>{ s+=`<rect x="${(x(i)-9).toFixed(1)}" y="0" width="18" height="${Ht}" fill="transparent" data-t="${esc(q.l)}: ${esc(fmt(q.v))}"/>`; });
  s+=`<circle cx="${x(li).toFixed(1)}" cy="${y(pts[li].v).toFixed(1)}" r="3.5" fill="${endColor}" stroke="#fff" stroke-width="1.5"/></svg>`;
  return s;
}

function homeKpi(o){
  const vals=o.rows.map(o.get), labs=o.rows.map(r=>mesCorto(r.mes_label||''));
  const v=vals[vals.length-1], p=vals.length>1?vals[vals.length-2]:null;
  const st = o.st ? o.st(v) : null;
  const col = st ? HM[st] : HM.faint;
  let dTxt='&nbsp;', dCol=HM.muted;
  if(v!=null && p!=null){ const d=v-p; const z=Math.abs(d)<0.05;
    const bueno = z?null:(o.better==='down'?d<0:d>0);
    dTxt = z ? '= vs '+labs[labs.length-2] : (d>0?'▲ +':'▼ ')+o.dfmt(d)+' vs '+labs[labs.length-2];
    dCol = bueno==null?HM.muted:(bueno?HM.good:HM.bad); }
  const stTxt = st ? (o.stTxt ? o.stTxt(v) : ST_TXT[st]) : (o.nota||'&nbsp;');
  return `<a href="#" data-go="${o.go}" title="Ver detalle" style="display:flex;flex-direction:column;text-decoration:none;color:inherit;background:#fff;border:1px solid ${HM.border};border-top:4px solid ${col};border-radius:12px;padding:18px 20px 16px;min-width:0">
    <div style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${HM.muted}">${o.k}${o.partial?` <span style="font-weight:600;letter-spacing:0;text-transform:none">· ${esc(labs[labs.length-1])} cerrado</span>`:''}</div>
    <div style="font-size:clamp(28px,2.4vw,42px);font-weight:800;line-height:1.1;color:${HM.ink};font-variant-numeric:tabular-nums;white-space:nowrap">${v==null?'–':o.fmt(v)}</div>
    <div style="font-size:14px;font-weight:700;color:${st?col:HM.muted}">${st?'● ':''}${stTxt}${st&&o.meta!=null?`<span style="font-weight:500;color:${HM.muted}"> · meta ${o.meta}</span>`:''}</div>
    <div style="font-size:14px;color:${dCol};font-variant-numeric:tabular-nums">${dTxt}</div>
    ${o.partial?`<div style="font-size:13px;color:${HM.muted};font-variant-numeric:tabular-nums">${esc(o.partial.l)} a la fecha: ${o.fmt(o.partial.v)} (parcial)</div>`:''}
    <div style="margin-top:auto"></div>${homeSpark(vals,labs,o.fmt,o.meta!=null?o.metaV:null,col,o.monto?null:o.partial)}
    <div style="font-size:14px;margin-top:8px;padding-top:8px;border-top:1px solid ${HM.border}">${o.sec||'&nbsp;'}</div>
</a>`;
}

function homeKpis(D,enCurso){
  const pp=d=>nf1.format(Math.abs(d))+' pp';
  const last=a=>a[a.length-1]||{};
  const n=last(D.ns);
  // Tarifa, Margen y Cobertura dependen del flete pagado/cobrado, que se factura con desfase:
  // con el mes en curso se muestra el último mes CERRADO y el parcial va aparte (punto hueco).
  const cerr=a=>enCurso&&a.length>1?a.slice(0,-1):a;
  const parc=(a,get)=>enCurso&&a.length>1?{v:get(a[a.length-1]),l:mesCorto(a[a.length-1].mes_label||'')}:null;
  const tarC=cerr(D.tar), marC=cerr(D.mar), m=last(marC);
  const sec=(k,v,st)=>`<span style="color:${HM.muted}">${k}</span> <b style="color:${st?HM[st]:HM.ink}">${v}</b>`;
  return [
    homeKpi({k:'OTIF',rows:D.ns,get:r=>r.otif_pct,fmt:pct,dfmt:pp,meta:META.otif+'%',metaV:META.otif,st:v=>stKey(v,META.otif,5),go:'indicadores|nivel',
      sec:sec('Fill Rate',pct(n.fillrate_pct),stKey(n.fillrate_pct,META.fill,5))}),
    homeKpi({k:'Tarifa $/kg',rows:tarC,partial:parc(D.tar,r=>r.tarifa_kg),get:r=>r.tarifa_kg,fmt:money,nota:'menor es mejor',dfmt:d=>money1(Math.abs(d)),better:'down',go:'indicadores|tarifa',
      sec:sec('Toneladas',nf0.format(last(tarC).toneladas||0))}),
    homeKpi({k:'Margen de flete',monto:true,rows:marC,partial:parc(D.mar,r=>r.margen==null?null:r.margen/1e6),get:r=>r.margen==null?null:r.margen/1e6,fmt:mm,dfmt:d=>money1(Math.abs(d))+' MM',st:v=>v==null?null:(v>=0?'good':'bad'),stTxt:v=>v>=0?'Positivo':'Negativo',go:'indicadores|margen',
      sec:sec('Cobertura',pct(m.cobertura_pct),stKey(m.cobertura_pct,META.cobertura,10))+` <span style="color:${HM.muted}">· acum.</span> <b>${(()=>{const t=sum(D.mar.map(r=>r.margen))/1e6;return sgn(t)+'$'+nf0.format(Math.abs(t))+' MM';})()}</b>`}),
    homeKpi({k:'Consolidación',rows:D.con||[],get:r=>r.consol_pct,fmt:pct,dfmt:pp,meta:META.consol+'%',metaV:META.consol,st:v=>stKey(v,META.consol,10),go:'indicadores|consolidado',
      sec:sec('Viajes',nf0.format(last(D.con||[]).viajes||0)+(enCurso?' (parcial)':''))})
  ].join('');
}

// Foco del mes: una frase + hasta 3 centros críticos
function homeFoco(G,D){
  const n=D.ns[D.ns.length-1]||{}, n0=D.ns[D.ns.length-2]||{};
  const d=(n.otif_pct!=null&&n0.otif_pct!=null)?n.otif_pct-n0.otif_pct:null;
  let h=`<div class="text-label-caps text-secondary uppercase" style="margin-bottom:8px">Foco del mes</div>`;
  if(!G||!G.rows.length) return h+`<div class="text-body-md">OTIF ${pct(n.otif_pct)} vs meta ${META.otif}%.</div>`;
  const bajo=G.rows.filter(r=>r.otif!=null&&r.otif<META.otif);
  const caida=G.rows.filter(r=>r.otif!=null&&r.otif0!=null).map(r=>({g:r.grupo,d:r.otif-r.otif0})).sort((a,b)=>a.d-b.d)[0];
  let frase=`OTIF <b>${pct(n.otif_pct)}</b>`+(d!=null?` (${d>=0?'+':'−'}${nf1.format(Math.abs(d))} pp)`:'')+`: `+
    (bajo.length?`<b>${bajo.length} de ${G.rows.filter(r=>r.otif!=null).length}</b> centros bajo meta`:'todos los centros sobre meta')+
    (caida&&caida.d<0?`. Mayor caída: <b>${esc(tc(caida.g))}</b> (${nf1.format(caida.d)} pp).`:'.');
  h+=`<div style="font-size:18px;line-height:1.45;margin-bottom:10px">${frase}</div>`;
  const crit=G.rows.filter(r=>r.otif!=null).sort((a,b)=>a.otif-b.otif).slice(0,3);
  h+=`<div style="display:flex;gap:8px;flex-wrap:wrap">`+crit.map(r=>{ const s=stKey(r.otif,META.otif,5);
    return `<a href="#" data-go="indicadores|nivel" data-t="${esc(tc(r.grupo))}: OTIF ${pct(r.otif)} · Fill ${pct(r.fill)}" style="text-decoration:none;display:inline-flex;gap:8px;align-items:center;background:${HM[s+'Bg']};border-radius:999px;padding:5px 12px;font-size:15px;color:${HM.ink}">
      ${esc(tc(r.grupo))} <b style="color:${HM[s]};font-variant-numeric:tabular-nums">${pct(r.otif)}</b></a>`; }).join('')+`</div>`;
  return h;
}

// Hoy: 3 cifras (Plan de Carga, Flete Tercero vencidos, estado de datos)
function homeHoy(OP,FR){
  const stat=(k,v,sub,c,go)=>`<a href="#" ${go?`data-go="${go}"`:''} style="text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:2px;min-width:0;${go?'':'cursor:default'}">
    <span style="font-size:13px;color:${HM.muted};font-weight:600">${k}</span>
    <span style="font-size:30px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;${c?'color:'+c:''}">${v}</span>
    <span style="font-size:13px;color:${HM.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub||'&nbsp;'}</span></a>`;
  let cells=[];
  if(OP&&OP.plan){ const p=OP.plan, esHoy=p.fecha===hoyISO();
    cells.push(stat('Plan de Carga',nf0.format(p.total)+' t',(esHoy?'hoy':p.fecha.slice(8,10)+'-'+p.fecha.slice(5,7))+' · '+p.cds.map(c=>c.cd).join(' / '),null,'abastecimiento|plan_carga')); }
  else cells.push(stat('Plan de Carga','–','sin foto',null,'abastecimiento|plan_carga'));
  if(OP&&OP.ft){ const f=OP.ft;
    cells.push(stat('Flete Tercero vencidos',nf0.format(f.vencidos),f.enCurso+' en curso'+(f.venceHoy?' · '+f.venceHoy+' vence hoy':''),f.vencidos?HM.bad:HM.good,f.vencidos?'flete-tercero|vencidos':'flete-tercero|dashboard')); }
  if(FR){
    const err=FR.indErr.length||FR.trcErr.length;
    const c=err?HM.bad:(FR.indHoy?HM.good:HM.warn);
    const t=err?'Error':(FR.indHoy?'Al día':'Pendiente');
    const sub=FR.indTs?'indicadores '+(FR.indHoy?'':ddmm(FR.indTs)+' ')+hhmm(FR.indTs)+(FR.trcTs?' · SAP '+hhmm(FR.trcTs):''):'sin registro';
    cells.push(stat('Datos','● '+t,sub,c));
  }
  return `<div class="text-label-caps text-secondary uppercase" style="margin-bottom:8px">Hoy</div>
    <div style="display:grid;grid-template-columns:repeat(${cells.length},minmax(0,1fr));gap:14px">${cells.join('')}</div>`;
}

// --- Matriz por centro (desplegable, ordenable) -------------------------------
function homePaintMx(){
  const box=document.getElementById('home_mx'), ic=document.getElementById('home_mx_ic');
  if(!box) return;
  box.style.display=_homeMx.open?'block':'none';
  if(ic) ic.style.transform=_homeMx.open?'rotate(180deg)':'none';
  if(!_homeMx.open) return;
  const cols=[
    {k:'grupo',t:'Centro',left:true},
    {k:'otif',t:'OTIF'},{k:'fill',t:'Fill Rate'},{k:'consol',t:'Consolidación'},
    {k:'tk',t:'Tarifa $/kg'},{k:'margen',t:'Margen'},{k:'cob',t:'Cobertura'},{k:'ton',t:'Toneladas'},{k:'lineas',t:'Líneas'}
  ];
  const rows=_homeMx.rows.slice().sort((a,b)=>{ const k=_homeMx.sort; const x=a[k], y=b[k];
    if(k==='grupo') return String(x).localeCompare(String(y))*_homeMx.dir;
    return ((x==null?-1e18:x)-(y==null?-1e18:y))*_homeMx.dir; });
  const cell=(v,st,delta)=>{ const bg=st?HM[st+'Bg']:'transparent';
    return `<td style="padding:10px 10px;text-align:right;border-radius:5px;white-space:nowrap;background:${bg}">${v}${delta||''}</td>`; };
  const dl=(a,b,up,f)=>{ if(a==null||b==null) return ''; const d=a-b; if(Math.abs(d)<0.05) return `<span style="font-size:13px;margin-left:4px;color:${HM.muted}">=</span>`;
    const g=up?d>0:d<0; return `<span style="font-size:13px;margin-left:4px;color:${g?HM.good:HM.bad}">${d>0?'+':'−'}${f(Math.abs(d))}</span>`; };
  const maxT=Math.max.apply(null,rows.map(r=>r.tk||0).concat([1]));
  let h=`<div style="overflow-x:auto"><table style="border-collapse:separate;border-spacing:2px;width:100%;min-width:760px;font-size:15px;font-variant-numeric:tabular-nums"><thead><tr>`+
    cols.map(c=>`<th data-sort="${c.k}" style="cursor:pointer;user-select:none;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:${HM.muted};font-weight:700;padding:6px 8px;white-space:nowrap;text-align:${c.left?'left':'right'}">${c.t}${_homeMx.sort===c.k?(_homeMx.dir>0?' ▲':' ▼'):''}</th>`).join('')+`</tr></thead><tbody>`;
  rows.forEach(r=>{
    h+=`<tr><td style="padding:10px 10px;font-weight:700;white-space:nowrap">${esc(tc(r.grupo))}</td>`+
      cell(pct(r.otif),stKey(r.otif,META.otif,5),dl(r.otif,r.otif0,true,nf1.format))+
      cell(pct(r.fill),stKey(r.fill,META.fill,5),dl(r.fill,r.fill0,true,nf1.format))+
      cell(pct(r.consol),stKey(r.consol,META.consol,10),dl(r.consol,r.consol0,true,nf1.format))+
      cell((r.tk!=null?`<span style="display:inline-block;height:6px;border-radius:3px;background:${HM.line};vertical-align:middle;margin-right:6px;width:${(r.tk/maxT*44).toFixed(0)}px"></span>`:'')+money(r.tk),null,dl(r.tk,r.tk0,false,v=>money1(v)))+
      `<td style="padding:10px 10px;text-align:right;white-space:nowrap;font-weight:600;color:${r.margen==null?HM.muted:(r.margen<0?HM.bad:HM.good)}">${r.margen==null?'–':mm(r.margen/1e6)}</td>`+
      cell(pct(r.cob),stKey(r.cob,META.cobertura,10))+
      `<td style="padding:10px 10px;text-align:right">${r.ton==null?'–':nf0.format(r.ton)}</td><td style="padding:10px 10px;text-align:right;color:${HM.muted}">${r.lineas==null?'–':nf0.format(r.lineas)}</td></tr>`;
  });
  h+=`</tbody></table></div><div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:${HM.muted};margin-top:8px">
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${HM.goodBg};border:1px solid ${HM.good};vertical-align:middle"></span> Sobre meta</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${HM.warnBg};border:1px solid ${HM.warn};vertical-align:middle"></span> Cerca de meta</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${HM.badBg};border:1px solid ${HM.bad};vertical-align:middle"></span> Bajo meta</span>
    <span>Δ vs mes anterior · Tarifa, Margen, Cobertura y Toneladas: último mes cerrado · clic en el encabezado para ordenar</span></div>`;
  box.innerHTML=h;
  box.querySelectorAll('th[data-sort]').forEach(th=>th.addEventListener('click',()=>{ const k=th.getAttribute('data-sort');
    if(_homeMx.sort===k) _homeMx.dir*=-1; else { _homeMx.sort=k; _homeMx.dir=(k==='grupo'||k==='tk')?1:1; } homePaintMx(); }));
}

function homeTips(el){
  el.querySelectorAll('[data-t]').forEach(n=>{
    n.addEventListener('mousemove',e=>{ _tip.textContent=n.getAttribute('data-t'); _tip.style.opacity=1;
      let x=e.clientX+12,y=e.clientY+12; if(x>window.innerWidth-220)x=e.clientX-_tip.offsetWidth-12;
      _tip.style.left=x+'px'; _tip.style.top=y+'px'; });
    n.addEventListener('mouseleave',()=>{ _tip.style.opacity=0; });
  });
}

// ============================================================================
//  NIVEL DE SERVICIO — detalle (6 análisis)
// ============================================================================
// ============================================================================
//  NIVEL DE SERVICIO · Comparativo por centro + Ranking de comunas (23-nov-2026)
//  Replica el análisis Nivel_de_Servicio.xlsx: general, por centro (CD RM separado
//  de Santiago), Regional/Interregional, Exclusivo, Spot/Planificado, Stock/Calzada
//  y ranking completo de comunas con mínimo de líneas y brecha vs centro.
//  Fuente: v_ind_ns_matriz y v_ind_ns_comuna_rank (sumas otif_n/fill_n → % exacto).
// ============================================================================
let _nsMx=null, _nsRank={}, _nsOpt={per:'anio', rech:'incluir', dim:'tipo_ruta', min:30, tr:'Regional'};
const NS_DIMS={
  tipo_ruta:{t:'Regional vs Interregional', cols:['Regional','Interregional','Sin clasificar']},
  exclusivo:{t:'Exclusivo vs No exclusivo', cols:['Exclusivo','No exclusivo']},
  spot:{t:'Spot vs Planificado', cols:['Spot','Planificado']},
  tipo_venta:{t:'Stock vs Calzada', cols:['STOCK','CALZADA']}
};
const NS_PER=[['anio','Año en curso'],['3m','Últimos 3 meses'],['mcerr','Último mes cerrado'],['mes','Mes en curso'],['todo','Todo el histórico']];
async function nsFetchAll(build){
  const out=[];
  for(let from=0;;from+=1000){
    const {data,error}=await build().range(from,from+999);
    if(error) throw error;
    out.push(...(data||[]));
    if(!data||data.length<1000) break;
  }
  return out;
}
function nsYm(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function nsRango(per){
  const d=new Date(), y=d.getFullYear(), m=d.getMonth();
  if(per==='anio') return [y+'-01','9999-12'];
  if(per==='3m')   return [nsYm(new Date(y,m-2,1)),'9999-12'];
  if(per==='mcerr'){ const p=nsYm(new Date(y,m-1,1)); return [p,p]; }
  if(per==='mes')  return [nsYm(d),'9999-12'];
  return ['0000-00','9999-12'];
}
function nsFiltra(rows){
  const [a,b]=nsRango(_nsOpt.per), ex=_nsOpt.rech==='excluir';
  return rows.filter(r=>r.mes_label>=a && r.mes_label<=b && !(ex && r.rechazada));
}
function nsAgg(rows){
  let n=0,o=0,f=0; rows.forEach(r=>{ n+=Number(r.lineas)||0; o+=Number(r.otif_n)||0; f+=Number(r.fill_n)||0; });
  return {n, otif:n?o/n*100:null, fill:n?f/n*100:null};
}
function nsCell(a,bold){
  if(!a||!a.n) return `<td class="text-right px-[6px] text-secondary">–</td><td class="text-center px-[6px] text-secondary">–</td><td class="text-right px-[6px] text-secondary">–</td>`;
  return `<td class="text-right px-[6px] tabular-nums ${bold?'font-semibold':''}">${nf0.format(a.n)}</td>`+
    `<td class="text-center px-[6px] tabular-nums ${bold?'font-semibold':''}" style="background:${heatOtif(a.otif)};color:#333">${nf1.format(a.otif)}</td>`+
    `<td class="text-right px-[6px] tabular-nums ${bold?'font-semibold':''}">${nf1.format(a.fill)}</td>`;
}
function nsSel(id,opts,val){
  return `<select id="${id}" class="border border-surface-variant rounded-lg px-sm py-[4px] bg-surface-container-lowest text-on-surface text-[14px]">`+
    opts.map(o=>`<option value="${o[0]}" ${o[0]===val?'selected':''}>${o[1]}</option>`).join('')+`</select>`;
}
function nsToolbarHTML(){
  return `<div class="flex flex-wrap items-center gap-md mb-md text-[14px]">
    <label class="text-secondary">Período:</label>${nsSel('ns_per',NS_PER,_nsOpt.per)}
    <label class="text-secondary">Posiciones con motivo de rechazo:</label>${nsSel('ns_rech',[['incluir','Incluir (criterio actual)'],['excluir','Excluir']],_nsOpt.rech)}
    <label class="text-secondary">Apertura:</label>${nsSel('ns_dim',Object.keys(NS_DIMS).map(k=>[k,NS_DIMS[k].t]),_nsOpt.dim)}
  </div>`;
}
function nsMatrizHTML(){
  const rows=nsFiltra(_nsMx||[]);
  if(!rows.length) return `<div class="text-secondary text-[14px] py-sm">Sin datos para el período.</div>`;
  const dim=NS_DIMS[_nsOpt.dim], tot=nsAgg(rows);
  const centros=[...new Set(rows.map(r=>r.centro))];
  const byC={}; centros.forEach(c=>byC[c]=nsAgg(rows.filter(r=>r.centro===c)));
  centros.sort((a,b)=>byC[b].n-byC[a].n);
  const grupoDe={}; rows.forEach(r=>grupoDe[r.centro]=r.grupo);
  // Calidad de dato y rechazos (independiente del toggle, sobre el período)
  const [a,b]=nsRango(_nsOpt.per);
  const perAll=(_nsMx||[]).filter(r=>r.mes_label>=a&&r.mes_label<=b);
  const all=nsAgg(perAll), rech=nsAgg(perAll.filter(r=>r.rechazada)), sinR=nsAgg(perAll.filter(r=>!r.rechazada));
  const tiles=tile('Líneas evaluadas',nf0.format(tot.n),'despachos del período')+
    tileS('OTIF red',pct(tot.otif),'línea de pedido',semaforo(tot.otif,META.otif,5))+
    tileS('Fill Rate red',pct(tot.fill),'línea de pedido',semaforo(tot.fill,META.fill,5))+
    tile('Líneas con motivo de rechazo',nf0.format(rech.n)+' ('+pct(all.n?rech.n/all.n*100:null)+')','OTIF sin ellas: '+pct(sinR.otif)+' · Fill: '+pct(sinR.fill));
  const head1=`<tr class="text-secondary"><th></th><th colspan="4" class="text-center font-medium pb-[2px]">Total</th>`+
    dim.cols.map(c=>`<th colspan="3" class="text-center font-medium pb-[2px] border-l border-surface-variant">${esc(nice(c))}</th>`).join('')+`</tr>`;
  const head2=`<tr class="text-secondary text-[13px]"><th class="text-left font-medium pr-sm">Centro</th><th class="text-right px-[6px] font-medium">Líneas</th><th class="text-right px-[6px] font-medium">% Líneas</th><th class="text-center px-[6px] font-medium">OTIF %</th><th class="text-right px-[6px] font-medium">Fill %</th>`+
    dim.cols.map(()=>`<th class="text-right px-[6px] font-medium border-l border-surface-variant">Líneas</th><th class="text-center px-[6px] font-medium">OTIF %</th><th class="text-right px-[6px] font-medium">Fill %</th>`).join('')+`</tr>`;
  const fila=(lbl,sub,agg,bold,hl)=>`<tr class="border-t border-surface-variant" style="${hl?'background:#FFF6F6':''}">
      <td class="py-[3px] pr-sm whitespace-nowrap ${bold?'font-semibold':''}">${hl?'▸ ':''}${esc(lbl)}</td>
      <td class="text-right px-[6px] tabular-nums ${bold?'font-semibold':''}">${nf0.format(agg.n)}</td>
      <td class="text-right px-[6px] tabular-nums">${pct(tot.n?agg.n/tot.n*100:null)}</td>
      <td class="text-center px-[6px] tabular-nums ${bold?'font-semibold':''}" style="background:${heatOtif(agg.otif)};color:#333">${nf1.format(agg.otif)}</td>
      <td class="text-right px-[6px] tabular-nums ${bold?'font-semibold':''}">${nf1.format(agg.fill)}</td>`+
      dim.cols.map(c=>nsCell(nsAgg(sub.filter(r=>r[_nsOpt.dim]===c)),bold).replace('<td class="text-right px-[6px]','<td class="text-right px-[6px] border-l border-surface-variant')).join('')+`</tr>`;
  const body=centros.map(c=>fila(c,rows.filter(r=>r.centro===c),byC[c],false,grupoDe[c]===_grupoN)).join('')+fila('Total red',rows,tot,true,false);
  // Alertas de maestro de rutas (líneas sin tipo de ruta)
  const alertas=centros.map(c=>{ const t=byC[c].n, s=nsAgg(rows.filter(r=>r.centro===c&&r.tipo_ruta==='Sin clasificar')).n; return {c,t,s,p:t?s/t*100:0}; })
    .filter(x=>x.p>=10).sort((x,y)=>y.p-x.p);
  const alertHTML=alertas.length?`<div class="mt-sm text-[13px]" style="color:#B5730B">⚠ Rutas no encontradas en el maestro (tipo de ruta y comuna sin clasificar): `+
    alertas.map(x=>`<b>${esc(x.c)}</b> ${nf0.format(x.s)} líneas (${nf1.format(x.p)}%)`).join(' · ')+`. Cargar esas rutas en Rutas para que entren al análisis regional y al ranking de comunas.</div>`:'';
  return `<div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div>
    <div class="ind-heat overflow-x-auto"><table class="w-full text-[14px]"><thead>${head1}${head2}</thead><tbody>${body}</tbody></table></div>
    <div class="text-[13px] text-secondary mt-sm">Medido a nivel de línea de pedido. CD RM se muestra separado de Santiago (en el resto de Indicadores se agrupa en Santiago); CD Concepción se suma a Concepción. ▸ = centro seleccionado. Color OTIF: verde ≥90 · rojo &lt;70.</div>${alertHTML}`;
}
async function nsRankHTML(){
  const g=_grupoN;
  if(!_nsRank[g]) _nsRank[g]=await nsFetchAll(()=>supabase.from('v_ind_ns_comuna_rank').select('*').eq('grupo',g));
  const base=nsFiltra(_nsRank[g]).filter(r=>_nsOpt.tr==='Todas'||r.tipo_ruta===_nsOpt.tr);
  const ref=nsAgg(base);
  const comunas=[...new Set(base.map(r=>r.comuna))].map(c=>Object.assign({comuna:c},nsAgg(base.filter(r=>r.comuna===c))));
  const eleg=comunas.filter(c=>c.n>=_nsOpt.min).sort((a,b)=>(b.otif-a.otif)||(b.fill-a.fill)||(b.n-a.n));
  const fuera=comunas.length-eleg.length;
  const ctrl=`<div class="flex flex-wrap items-center gap-md mb-md text-[14px]">
    <label class="text-secondary">Tipo de ruta:</label>${nsSel('ns_tr',[['Regional','Regional'],['Interregional','Interregional'],['Todas','Todas']],_nsOpt.tr)}
    <label class="text-secondary">Mín. líneas por comuna:</label><input id="ns_min" type="number" min="1" step="1" value="${_nsOpt.min}" class="border border-surface-variant rounded-lg px-sm py-[4px] w-[80px] bg-surface-container-lowest text-on-surface">
    <span class="text-secondary">${esc(nice(g))} · ${nf0.format(ref.n)} líneas · OTIF ${pct(ref.otif)} · Fill ${pct(ref.fill)} · ${eleg.length} comunas${fuera?' ('+fuera+' bajo el mínimo)':''}</span></div>`;
  if(!eleg.length) return ctrl+`<div class="text-secondary text-[14px] py-sm">Sin comunas que cumplan el mínimo de líneas en el período.</div>`;
  const body=eleg.map((c,i)=>{ const br=c.otif-ref.otif;
    return `<tr class="border-t border-surface-variant"><td class="py-[3px] pr-sm tabular-nums text-secondary">${i+1}</td><td class="pr-sm whitespace-nowrap">${esc(c.comuna)}</td>
      <td class="text-right px-[6px] tabular-nums">${nf0.format(c.n)}</td>
      <td class="text-center px-[6px] tabular-nums" style="background:${heatOtif(c.otif)};color:#333">${nf1.format(c.otif)}</td>
      <td class="text-right px-[6px] tabular-nums">${nf1.format(c.fill)}</td>
      <td class="text-right px-[6px] tabular-nums" style="color:${br>=0?'#1E8449':'#C0000C'}">${(br>0?'+':'')+nf1.format(br)} pp</td></tr>`; }).join('');
  return ctrl+`<div class="ind-heat overflow-auto" style="max-height:520px"><table class="w-full text-[14px]"><thead class="sticky top-0 bg-surface-container-lowest"><tr class="text-secondary text-[13px]">
    <th class="text-left font-medium">#</th><th class="text-left font-medium">Comuna</th><th class="text-right px-[6px] font-medium">Líneas</th><th class="text-center px-[6px] font-medium">OTIF %</th><th class="text-right px-[6px] font-medium">Fill %</th><th class="text-right px-[6px] font-medium">Brecha OTIF vs centro</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="text-[13px] text-secondary mt-sm">Orden: OTIF, luego Fill Rate y luego líneas (mejor → peor). Comuna según maestro de rutas (ID ruta). Período y criterio de rechazos según el cuadro anterior.</div>`;
}
async function nsPaint(container){
  const mx=document.getElementById('n_mx_wrap'), rk=document.getElementById('n_rank_wrap');
  if(!mx||!rk) return;
  try{
    if(!_nsMx){ mx.innerHTML=loadingHTML(); _nsMx=await nsFetchAll(()=>supabase.from('v_ind_ns_matriz').select('*')); }
    mx.innerHTML=nsToolbarHTML()+nsMatrizHTML();
    rk.innerHTML=loadingHTML(); rk.innerHTML=await nsRankHTML();
    nsBind(container); sweepHeat();
  }catch(e){ mx.innerHTML=errorHTML(e); }
}
function nsBind(container){
  const on=(id,k,num)=>{ const el=document.getElementById(id); if(!el) return;
    el.onchange=ev=>{ let v=ev.target.value; if(num){ v=Math.max(1,parseInt(v,10)||1); } _nsOpt[k]=v; nsPaint(container); }; };
  on('ns_per','per'); on('ns_rech','rech'); on('ns_dim','dim'); on('ns_tr','tr'); on('ns_min','min',true);
}
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
    ensureTip(); drawNivel(_cacheNivel,_grupoN); bindSelN(container,grupos); sweepHeat(); nsPaint(container);
  } catch(e){ container.innerHTML=errorHTML(e); }
}
function bindSelN(container,grupos){
  const el=document.getElementById('ind_seln'); if(!el) return;
  el.onchange=ev=>{ _grupoN=ev.target.value; container.innerHTML=nivelHTML(_cacheNivel,grupos,_grupoN); ensureTip(); drawNivel(_cacheNivel,_grupoN); bindSelN(container,grupos); sweepHeat(); nsPaint(container); };
}
function nivelHTML(d,grupos,grupo){
  const tp=d.tp.filter(r=>r.grupo===grupo);
  const stock=tp.find(r=>r.tipo==='STOCK')||{}, calz=tp.find(r=>r.tipo==='CALZADA')||{};
  const hayClase=tp.some(r=>r.tipo==='STOCK'||r.tipo==='CALZADA');
  const opciones=grupos.map(g=>`<option value="${g}" ${g===grupo?'selected':''}>${nice(g)}</option>`).join('');
  return `<div class="w-full mx-auto" style="max-width:1760px">
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

    ${card('Nivel de Servicio por Centro','Comparativo de la red: OTIF y Fill Rate por centro y apertura','',`<div id="n_mx_wrap"></div>`,'sec-ns-mx')}

    ${card('Ranking de Comunas — '+nice(grupo),'Todas las comunas, mejor → peor, con brecha vs el centro','',`<div id="n_rank_wrap"></div>`,'sec-ns-rank')}

    ${card('Nivel de Servicio por Tipo de Venta Stock y Calzada','OTIF y Tiempo de Entrega',
      tileS('OTIF Stock',pct(stock.otif_pct),(stock.lineas||0)+' líneas · 4 sem',semaforo(stock.otif_pct,META.otif,5))+
      tileS('OTIF Calzada',pct(calz.otif_pct),(calz.lineas||0)+' líneas · 4 sem',semaforo(calz.otif_pct,META.otif,5))+
      tile('Días Stock',(stock.dias_prom!=null?nf1.format(stock.dias_prom)+' d':'–'),'venta→entrega')+
      tile('Días Calzada',(calz.dias_prom!=null?nf1.format(calz.dias_prom)+' d':'–'),'venta→entrega'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'OTIF % por tipo',c:R.red}])+`<div id="n_tipo_otif"></div></div>`+
      `<div>`+legend([{n:'Días a entrega por tipo',c:R.grey}])+`<div id="n_tipo_dias"></div></div></div>`+
      (hayClase?'':`<div class="text-[13px] text-secondary mt-sm">Stock=ZV01/03/04 · Calzada=ZV08/09. Vacío = falta correr la carga con el Code.gs actualizado (nueva columna Clase Documento).</div>`))}

    ${card('Nivel de Servicio Spot y Planificado','Evolutivo Spot vs Planificado','',
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'OTIF % Planificado',c:R.red},{n:'OTIF % Spot',c:R.grey}])+`<div id="n_spot"></div></div>`+
      `<div>`+legend([{n:'Entregas Planificado',c:R.red},{n:'Entregas Spot',c:R.grey}])+`<div id="n_spot_ent"></div></div></div>`)}

    ${card('Envío Express vs Planificado','Entregas, cobertura y $/kg del envío express · año en curso','',`<div id="n_expr"><div class="text-secondary text-[14px]">Cargando…</div></div>`)}

    <div class="text-[13px] text-secondary mt-lg leading-relaxed">Comuna = comuna destino (routes.comuna); todas las rutas que llegan a una misma comuna se agrupan juntas. Solo rutas de clasificación Regional. Días venta→entrega = fecha guía − fecha creación.</div>
  </div>`;
}
function heatComunaHTML(rows){
  if(!rows.length) return `<div class="text-secondary text-[14px] py-sm">Sin datos.</div>`;
  const months=[...new Set(rows.map(r=>r.mes_label))].sort();
  const tot={}; rows.forEach(r=>{tot[r.comuna]=(tot[r.comuna]||0)+(r.lineas||0);});
  const comunas=Object.keys(tot).sort((a,b)=>tot[b]-tot[a]).slice(0,12);
  const map={}; rows.forEach(r=>{(map[r.comuna]=map[r.comuna]||{})[r.mes_label]=r.otif_pct;});
  const head=`<th class="text-left font-medium text-secondary pr-sm">Comuna</th>`+months.map(m=>`<th class="font-medium text-secondary px-[6px] text-center">${mesCorto(m)}</th>`).join('');
  const bodyr=comunas.map(c=>{
    const cells=months.map(m=>{const v=(map[c]||{})[m];return `<td class="text-center px-[6px] py-[3px] tabular-nums" style="background:${v==null?'transparent':heatOtif(v)};color:#333">${v==null?'':nf1.format(v)}</td>`;}).join('');
    return `<tr><td class="pr-sm py-[3px] text-[14px] whitespace-nowrap">${c}</td>${cells}</tr>`;
  }).join('');
  return `<div class="ind-heat overflow-x-auto"><table class="text-[13px] border-separate" style="border-spacing:2px"><thead><tr>${head}</tr></thead><tbody>${bodyr}</tbody></table></div>`;
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
  nivelExpress(grupo);
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
  return `<div class="w-full mx-auto" style="max-width:1760px">
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
    <div class="text-[13px] text-secondary -mt-sm mb-md">Solo <b>última milla</b> (entregas a cliente). Excluye traslados troncales de reposición.</div>
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
    ${showEbc?card('4 · Impacto EbemaClick — período (ene → a la fecha)','Financiamiento de la operación EbemaClick en todo el período (DT con entregas E-Click + sobrecosto 400141 del mismo DT)',
      tile('Documentos',nf0.format(ebcTot.docs),'ene → hoy')+
      tile('Toneladas',nf1.format(ebcTot.ton)+' t','movidas')+
      tile('Flete pagado',mm(ebcTot.pag),'costo operación','text-[#EE1B22]')+
      tile('Financiamiento neto',mm(ebcTot.pag-ebcTot.cob),'pagado − cobrado','text-[#EE1B22]'),
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md">`+
      `<div>`+legend([{n:'Flete pagado $MM',c:R.red2},{n:'Cobrado $MM',c:R.red}])+`<div id="t_ebc"></div></div>`+
      `<div>`+legend([{n:'Financiamiento neto $MM',c:R.grey}])+`<div id="t_ebc_neto"></div></div></div>`):''}
    <div class="text-[13px] text-secondary mt-lg leading-relaxed">Solo última milla (entregas a cliente ZE01/ZE06/ZE20/ZE05/ZE04); se excluyen los traslados troncales de reposición (NL/EL). Comuna = comuna destino (routes.comuna); rutas de una misma comuna se agrupan. EbemaClick = documentos de transporte con al menos una entrega marcada E-Click en el reporte de flete (regla 23-nov-2026; antes vendedor V Garrido T); se imputa el flete de sus entregas más el de las líneas 400141 (sobrecosto flete) del mismo DT. El cuadro solo aparece en centros con operación EbemaClick.</div>
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
// ============================================================================
//  MARGEN · Financiamiento por tipo de negocio + DETALLE POR DESPACHO (23-nov-2026)
//  Replica margenes_de_flete.xlsx: Normal / E-Click / ZV15 (flete especial cobrado
//  al cliente) / ZV20 (flete tercero, oficina 1004 → se asigna a la oficina de entrega).
//  Fuente: v_ind_fin_flete, v_ind_despacho, v_ind_despacho_entrega (ind_flete_cobrado).
// ============================================================================
let _finRows=null, _finOpt={per:'anio', seg:'TODOS'};
const SUC_NOM={'1000':'Santiago','1001':'Corte y Doblado','1002':'Electrosoldado','1003':'CD RM','1004':'Flete tercero','1081':'CD Biobío','1082':'Zincalum','1005':'San Bernardo','1020':'Antofagasta','1040':'Coquimbo','1050':'La Calera','1060':'Rancagua','1070':'Talca','1080':'Concepción','1090':'Temuco','1100':'Puerto Montt','1160':'Chillán'};
const sucNom=id=>SUC_NOM[id]||id||'(s/i)';
const NEG_LBL={NORMAL:'Normal',ECLICK:'E-Click',ZV15:'Flete especial ZV15',ZV20:'Flete tercero ZV20'};
const SEG_FIN=[['TODOS','Todos los despachos'],['ULTIMA_MILLA','Última milla'],['TRONCAL','Troncal'],['MIXTO','Mixto']];
const peso=v=>(v==null||isNaN(v)?'–':(v<0?'-':'')+'$'+nf0.format(Math.abs(Math.round(v))));
const pesoC=v=>`<span style="color:${v<0?'#C0000C':'#1E8449'}">${peso(v)}</span>`;
const cobC=v=>v==null?'–':`<span style="color:${v>=100?'#1E8449':v>=90?'#B5730B':'#C0000C'}">${nf1.format(v)}%</span>`;
function finAgg(rows){
  const o={entregas:0,viajes:0,kg:0,sug:0,cob:0,pag:0,lineas:0};
  rows.forEach(r=>{ o.lineas+=+r.lineas||0; o.entregas+=+r.entregas||0; o.viajes+=+r.viajes||0; o.kg+=+r.kg||0; o.sug+=+r.sugerido||0; o.cob+=+r.cobrado||0; o.pag+=+r.pagado||0; });
  o.res=o.cob-o.pag; o.cobt=o.pag?o.cob/o.pag*100:null; return o;
}
function finFiltra(rows){
  const [a,b]=nsRango(_finOpt.per);
  return rows.filter(r=>r.mes_label>=a && r.mes_label<=b && (_finOpt.seg==='TODOS'||r.segmento===_finOpt.seg));
}
function finHTML(){
  const rows=finFiltra(_finRows||[]);
  const ctrl=`<div class="flex flex-wrap items-center gap-md mb-md text-[14px]">
    <label class="text-secondary">Período:</label>${nsSel('fin_per',NS_PER,_finOpt.per)}
    <label class="text-secondary">Despachos:</label>${nsSel('fin_seg',SEG_FIN,_finOpt.seg)}</div>`;
  if(!rows.length) return ctrl+`<div class="text-secondary text-[14px] py-sm">Sin datos para el período.</div>`;
  const T=finAgg(rows), by=n=>finAgg(rows.filter(r=>r.negocio===n));
  const E=by('ECLICK'), Z15=by('ZV15'), Z20=by('ZV20'), N=by('NORMAL'), X=finAgg(rows.filter(r=>r.express));
  const cobSinE=(T.pag-E.pag)?(T.cob-E.cob)/(T.pag-E.pag)*100:null;
  const tiles=tileS('Resultado total',mm(T.res/1e6),'cobrado '+mm(T.cob/1e6)+' − pagado '+mm(T.pag/1e6),T.res>=0?{c:'#1E8449',t:'Cobertura '+pct(T.cobt)}:{c:'#C0000C',t:'Cobertura '+pct(T.cobt)})+
    tileS('Resultado E-Click',mm(E.res/1e6),nf0.format(E.entregas)+' entregas · no cobra flete al cliente',{c:'#C0000C',t:'Cobertura sin E-Click '+pct(cobSinE)})+
    tileS('Fletes especiales ZV15 + ZV20',mm((Z15.res+Z20.res)/1e6),'cobrado '+mm((Z15.cob+Z20.cob)/1e6)+' · pagado '+mm((Z15.pag+Z20.pag)/1e6),(Z15.res+Z20.res)>=0?{c:'#1E8449',t:'Aporte positivo'}:{c:'#C0000C',t:'Aporte negativo'})+
    tileS('Despachos normales',pct(N.cobt),'cobertura · resultado '+mm(N.res/1e6),semaforo(N.cobt,META.cobertura,10));
  const sucs=[...new Set(rows.map(r=>r.suc_id))];
  const bySuc={}; sucs.forEach(s=>bySuc[s]=rows.filter(r=>r.suc_id===s));
  sucs.sort((a,b)=>finAgg(bySuc[a]).res-finAgg(bySuc[b]).res);
  const fila=(lbl,rs,bold,hl)=>{ const t=finAgg(rs), g=n=>finAgg(rs.filter(r=>r.negocio===n)), e=g('ECLICK');
    const sinE=(t.pag-e.pag)?(t.cob-e.cob)/(t.pag-e.pag)*100:null;
    const imp=(t.cobt!=null&&sinE!=null)?t.cobt-sinE:null;
    const b=bold?'font-semibold':'';
    return `<tr class="border-t border-surface-variant" style="${hl?'background:#FFF6F6':''}">
      <td class="py-[3px] pr-sm whitespace-nowrap ${b}">${hl?'▸ ':''}${esc(lbl)}</td>
      <td class="text-right px-[6px] tabular-nums ${b}">${peso(t.pag)}</td><td class="text-right px-[6px] tabular-nums ${b}">${peso(t.cob)}</td>
      <td class="text-right px-[6px] tabular-nums ${b}">${pesoC(t.res)}</td><td class="text-right px-[6px] tabular-nums ${b}">${cobC(t.cobt)}</td>
      <td class="text-right px-[6px] tabular-nums border-l border-surface-variant">${pesoC(g('NORMAL').res)}</td>
      <td class="text-right px-[6px] tabular-nums">${e.pag||e.cob?pesoC(e.res):'–'}</td>
      <td class="text-right px-[6px] tabular-nums">${(g('ZV15').pag||g('ZV15').cob)?pesoC(g('ZV15').res):'–'}</td>
      <td class="text-right px-[6px] tabular-nums">${(g('ZV20').pag||g('ZV20').cob)?pesoC(g('ZV20').res):'–'}</td>
      <td class="text-right px-[6px] tabular-nums border-l border-surface-variant">${cobC(sinE)}</td>
      <td class="text-right px-[6px] tabular-nums">${imp==null||Math.abs(imp)<0.05?'–':`<span style="color:#C0000C">${nf1.format(imp)} pp</span>`}</td></tr>`; };
  const body=sucs.map(s=>fila(sucNom(s),bySuc[s],false,(bySuc[s][0]||{}).grupo===_grupoM)).join('')+fila('Total',rows,true,false);
  const th=(t,cls)=>`<th class="text-right px-[6px] font-medium ${cls||''}">${t}</th>`;
  return ctrl+`<div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div>
    <div class="ind-heat overflow-x-auto"><table class="w-full text-[14px]"><thead>
      <tr class="text-secondary text-[13px]"><th></th><th colspan="4" class="text-center font-medium">Total sucursal</th><th colspan="4" class="text-center font-medium border-l border-surface-variant">Resultado por tipo de negocio (cobrado − pagado)</th><th colspan="2" class="text-center font-medium border-l border-surface-variant">Efecto E-Click</th></tr>
      <tr class="text-secondary text-[13px]"><th class="text-left font-medium">Sucursal</th>${th('Pagado')}${th('Cobrado')}${th('Resultado')}${th('Cobertura')}${th('Normal','border-l border-surface-variant')}${th('E-Click')}${th('ZV15')}${th('ZV20')}${th('Cobertura sin E-Click','border-l border-surface-variant')}${th('Impacto')}</tr>
    </thead><tbody>${body}</tbody></table></div>
    <div class="text-[13px] text-secondary mt-sm leading-relaxed">Orden: peor resultado primero. <b>E-Click</b> = columna E-Click del reporte (no cobra flete al cliente). <b>ZV15</b> = flete especial cobrado al cliente (Flete ZV15 = Si). <b>ZV20</b> = flete tercero (oficina 1004): cobro en columna Flete ZV20, asignado a la oficina de entrega. Normal = resto. Envío Express en el período: ${nf0.format(X.entregas)} entregas · cobrado ${mm(X.cob/1e6)} · pagado ${mm(X.pag/1e6)} · cobertura ${pct(X.cobt)}.</div>`;
}
async function finPaint(){
  const el=document.getElementById('m_fin_wrap'); if(!el) return;
  try{
    if(!_finRows){ el.innerHTML=loadingHTML(); _finRows=await nsFetchAll(()=>supabase.from('v_ind_fin_flete').select('*')); }
    el.innerHTML=finHTML(); sweepHeat();
    const on=(id,k)=>{ const s=document.getElementById(id); if(s) s.onchange=ev=>{ _finOpt[k]=ev.target.value; finPaint(); }; };
    on('fin_per','per'); on('fin_seg','seg');
  }catch(e){ el.innerHTML=errorHTML(e); }
}

// ---------------------------- DETALLE POR DESPACHO ---------------------------
let _desp={grupo:null, per:'3m', neg:'TODOS', vend:'TODOS', perd:false, q:'', orden:'fecha', page:0, modo:'desp', ruta:'TODAS', vord:'cob'}, _despRows={}, _despEnt={}, _despEntG={}, _despOpen=null;
const RUTA_OPTS=[['TODAS','Todas'],['Regional','Regional'],['Interregional','Interregional'],['Sin clasificar','Sin clasificar']];
const VORD_OPTS=[['cob','Flete cobrado (mayor primero)'],['sug','Flete sugerido (mayor primero)'],['pag','Flete pagado (mayor primero)'],['viajes','N° viajes (más primero)'],['dcs','Cobrado − sugerido (peor primero)'],['dcp','Cobrado − pagado (peor primero)'],['dsp','Sugerido − pagado (peor primero)'],['pcs','% cobrado / sugerido (peor primero)'],['pcp','% cobrado / pagado (peor primero)']];
const MES_NOM=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function despRango(per){ return String(per).indexOf('M:')===0?[per.slice(2),per.slice(2)]:nsRango(per); }
function despRutaOk(r){ return _desp.ruta==='TODAS'||String(r.tipo_ruta||'Sin clasificar').split(',').map(x=>x.trim()).indexOf(_desp.ruta)>=0; }
const DESP_PAGE=50;
const fd=s=>s?String(s).slice(8,10)+'-'+String(s).slice(5,7)+'-'+String(s).slice(2,4):'–';
const NEG_OPTS=[['TODOS','Todos'],['NORMAL','Normal'],['ECLICK','E-Click'],['ZV15','Flete especial ZV15'],['ZV20','Flete tercero ZV20'],['EXPRESS','Envío Express']];
const ORD_OPTS=[['fecha','Fecha (reciente primero)'],['res','Resultado (peor primero)'],['pag','Pagado (mayor primero)'],['cob','Cobertura (peor primero)']];
function despChips(r){
  const c=[]; const n=String(r.negocios||'');
  if(n.indexOf('ECLICK')>=0) c.push(['E-Click','#6B6E70']);
  if(n.indexOf('ZV15')>=0) c.push(['ZV15','#1E8449']);
  if(n.indexOf('ZV20')>=0) c.push(['ZV20','#2E75B6']);
  if(r.express) c.push(['Express','#E97132']);
  return c.map(x=>`<span style="background:${x[1]};color:#fff;border-radius:999px;padding:0 6px;font-size:11px;margin-right:2px;white-space:nowrap">${x[0]}</span>`).join('');
}
function despFiltra(){
  const rows=_despRows[_desp.grupo]||[], [a,b]=despRango(_desp.per), q=_desp.q.trim().toLowerCase();
  let out=rows.filter(r=>r.mes_label>=a && r.mes_label<=b && despRutaOk(r));
  if(_desp.neg==='EXPRESS') out=out.filter(r=>r.express);
  else if(_desp.neg!=='TODOS') out=out.filter(r=>String(r.negocios||'').indexOf(_desp.neg)>=0);
  if(_desp.vend!=='TODOS') out=out.filter(r=>String(r.vendedores||'').split(',').map(x=>x.trim()).indexOf(_desp.vend)>=0);
  if(_desp.perd) out=out.filter(r=>(+r.cobrado||0)<(+r.pagado||0));
  if(q) out=out.filter(r=>[r.dt,r.entregas,r.vendedores,r.comunas,r.transportista,sucNom(r.suc_id)].join(' ').toLowerCase().indexOf(q)>=0);
  const res=r=>(+r.cobrado||0)-(+r.pagado||0), cob=r=>(+r.pagado?(+r.cobrado||0)/(+r.pagado):9e9);
  const cmp={fecha:(x,y)=>String(y.fecha_transporte).localeCompare(String(x.fecha_transporte))||String(y.dt).localeCompare(String(x.dt)),
    res:(x,y)=>res(x)-res(y), pag:(x,y)=>(+y.pagado||0)-(+x.pagado||0), cob:(x,y)=>cob(x)-cob(y)}[_desp.orden];
  return out.sort(cmp);
}
function despShellHTML(grupos){
  const opciones=grupos.map(g=>`<option value="${g}" ${g===_desp.grupo?'selected':''}>${nice(g)}</option>`).join('');
  return `<div class="w-full mx-auto" style="max-width:1760px">
    <div class="flex items-center gap-md mb-md flex-wrap">
      <div class="text-headline-sm font-bold">Detalle por Despacho — flete sugerido, cobrado y pagado</div>
      <label class="text-secondary text-body-md ml-auto">Centro:</label>
      <select id="desp_grp" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface">${opciones}</select>
    </div>
    <section class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md md:p-lg mb-lg">
      <div class="flex flex-wrap items-center gap-md mb-md text-[14px]">
        <div class="inline-flex rounded-lg border border-surface-variant overflow-hidden mr-sm">
          <button id="desp_m_desp" class="px-md py-[4px] ${_desp.modo==='desp'?'bg-primary text-on-primary font-semibold':'hover:bg-surface-container-low'}">Despachos</button>
          <button id="desp_m_vend" class="px-md py-[4px] border-l border-surface-variant ${_desp.modo==='vend'?'bg-primary text-on-primary font-semibold':'hover:bg-surface-container-low'}">Resumen por vendedor</button></div>
        <label class="text-secondary">Período:</label><select id="desp_per" class="border border-surface-variant rounded-lg px-sm py-[4px] bg-surface-container-lowest text-on-surface text-[14px]"></select>
        <label class="text-secondary">Tipo de ruta:</label>${nsSel('desp_ruta',RUTA_OPTS,_desp.ruta)}
        <label class="text-secondary">Tipo:</label>${nsSel('desp_neg',NEG_OPTS,_desp.neg)}
        <span id="desp_vonly" class="inline-flex flex-wrap items-center gap-md" style="${_desp.modo==='vend'?'':'display:none'}"><label class="text-secondary">Ordenar por:</label>${nsSel('desp_vord',VORD_OPTS,_desp.vord)}</span>
        <span id="desp_donly" class="inline-flex flex-wrap items-center gap-md" style="${_desp.modo==='desp'?'':'display:none'}">
        <label class="text-secondary">Vendedor:</label><select id="desp_vend" class="border border-surface-variant rounded-lg px-sm py-[4px] bg-surface-container-lowest text-on-surface text-[14px]" style="max-width:220px"></select>
        <label class="text-secondary">Ordenar:</label>${nsSel('desp_ord',ORD_OPTS,_desp.orden)}
        <label class="inline-flex items-center gap-[6px]"><input id="desp_perd" type="checkbox" ${_desp.perd?'checked':''}> Solo con pérdida (cobrado &lt; pagado)</label>
        <input id="desp_q" type="search" value="${esc(_desp.q)}" placeholder="Buscar DT, entrega, vendedor, comuna, transportista…" class="border border-surface-variant rounded-lg px-sm py-[4px] bg-surface-container-lowest text-on-surface" style="min-width:300px"></span>
        <button id="desp_csv" class="ml-auto border border-surface-variant rounded-lg px-md py-[4px] hover:bg-surface-container-low">⬇ Descargar CSV</button>
      </div>
      <div id="desp_body"></div>
    </section>
    <div class="text-[13px] text-secondary leading-relaxed">Un despacho = documento de transporte (DT) por sucursal. Montos en $ CLP del reporte FLETE COBRADO: sugerido = tarifa del sistema, cobrado = facturado al cliente (+ Flete ZV20 en flete tercero), pagado = pago al transportista. Al filtrar por vendedor se muestran los despachos donde participó (solo o con otros vendedores), con los montos completos del despacho. Clic en una fila para abrir el detalle del despacho con sus entregas (NV, factura, vendedor, cliente y fechas de NV, factura y entrega). <b>Resumen por vendedor</b>: montos sumados de las entregas de cada vendedor (fecha del DT); N° viajes = DT distintos donde participó, por eso la suma por vendedor puede superar el total. Tipo de ruta se toma del DT (un DT con rutas mixtas cuenta en cada tipo). Clic en un vendedor para ver sus despachos.</div>
  </div>`;
}
function despBodyHTML(){
  const rows=despFiltra(), T=finAgg(rows), n=rows.length, pages=Math.max(1,Math.ceil(n/DESP_PAGE));
  if(_desp.page>=pages) _desp.page=pages-1;
  const perd=rows.filter(r=>(+r.cobrado||0)<(+r.pagado||0)).length;
  const ent=rows.reduce((s,r)=>s+(+r.n_entregas||0),0);
  const tiles=tile('Despachos',nf0.format(n),nf0.format(ent)+' entregas · '+nf0.format(T.kg/1000)+' t')+
    tile('Sugerido',mm(T.sug/1e6),'tarifa sistema')+
    tile('Cobrado',mm(T.cob/1e6),'cobrado / sugerido '+pct(T.sug?T.cob/T.sug*100:null))+
    tileS('Resultado',mm(T.res/1e6),'pagado '+mm(T.pag/1e6)+' · '+nf0.format(perd)+' despachos con pérdida',T.res>=0?{c:'#1E8449',t:'Cobertura '+pct(T.cobt)}:{c:'#C0000C',t:'Cobertura '+pct(T.cobt)});
  if(!n) return `<div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div><div class="text-secondary text-[14px] py-sm">Sin despachos con esos filtros.</div>`;
  const pg=rows.slice(_desp.page*DESP_PAGE,(_desp.page+1)*DESP_PAGE);
  const th=(t,l)=>`<th class="${l?'text-left':'text-right'} px-[6px] font-medium whitespace-nowrap">${t}</th>`;
  const body=pg.map(r=>{ const res=(+r.cobrado||0)-(+r.pagado||0), cb=+r.pagado?(+r.cobrado||0)/(+r.pagado)*100:null, key=r.suc_id+'|'+r.dt;
    return `<tr class="border-t border-surface-variant cursor-pointer hover:bg-surface-container-low" data-desp="${esc(key)}" title="Ver detalle del despacho">
      <td class="px-[6px] py-[3px] whitespace-nowrap">${fd(r.fecha_transporte)}</td>
      <td class="px-[6px] tabular-nums">${esc(r.dt)}</td>
      <td class="px-[6px] whitespace-nowrap">${esc(sucNom(r.suc_id))}</td>
      <td class="px-[6px]" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.transportista)}">${esc(r.transportista||'–')}</td>
      <td class="px-[6px] text-right tabular-nums">${esc(r.cap_camion||'–')}</td>
      <td class="px-[6px]" style="max-width:200px" title="${esc(r.vendedores)}">${esc(r.vendedores||'–')}</td>
      <td class="px-[6px]" style="max-width:200px" title="${esc(r.comunas)}">${esc(r.comunas||'–')}</td>
      <td class="px-[6px] text-right tabular-nums">${nf0.format(r.n_entregas||0)}</td>
      <td class="px-[6px] text-right tabular-nums">${nf0.format(r.kg||0)}</td>
      <td class="px-[6px] text-right tabular-nums">${peso(+r.sugerido)}</td>
      <td class="px-[6px] text-right tabular-nums">${peso(+r.cobrado)}</td>
      <td class="px-[6px] text-right tabular-nums">${peso(+r.pagado)}</td>
      <td class="px-[6px] text-right tabular-nums font-semibold">${pesoC(res)}</td>
      <td class="px-[6px] text-right tabular-nums">${cobC(cb)}</td>
      <td class="px-[6px]">${despChips(r)}</td></tr>`; }).join('');
  const pager=`<div class="flex items-center gap-sm mt-sm text-[14px] text-secondary">
    <button id="desp_prev" class="border border-surface-variant rounded px-sm" ${_desp.page<=0?'disabled':''}>‹</button>
    <span>Página ${_desp.page+1} de ${pages} · ${nf0.format(n)} despachos</span>
    <button id="desp_next" class="border border-surface-variant rounded px-sm" ${_desp.page>=pages-1?'disabled':''}>›</button></div>`;
  return `<div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div>
    <div class="overflow-x-auto"><table class="w-full text-[13px]"><thead><tr class="text-secondary">
      ${th('Fecha',1)}${th('DT',1)}${th('Sucursal',1)}${th('Transportista',1)}${th('Cap. t')}${th('Vendedor(es)',1)}${th('Comunas',1)}${th('Entregas')}${th('Kg')}${th('Sugerido')}${th('Cobrado')}${th('Pagado')}${th('Resultado')}${th('Cobertura')}${th('Tipo',1)}
    </tr></thead><tbody>${body}</tbody></table></div>${pager}`;
}

// ---- Resumen por vendedor (23-nov-2026) — réplica "Ranking por Vendedor" del Excel ----
function despVendLista(){
  const g=_desp.grupo, ents=_despEntG[g]||[], [a,b]=despRango(_desp.per), dmap={};
  (_despRows[g]||[]).forEach(r=>{ if(r.mes_label>=a && r.mes_label<=b && despRutaOk(r)) dmap[r.suc_id+'|'+r.dt]=r; });
  const m=new Map(), T={viajes:new Set(),ent:0,kg:0,sug:0,cob:0,pag:0};
  ents.forEach(e=>{ const k=e.suc_id+'|'+e.dt; if(!dmap[k]) return;
    if(_desp.neg==='EXPRESS'){ if(!e.express) return; } else if(_desp.neg!=='TODOS' && e.negocio!==_desp.neg) return;
    const v=(e.vendedor||'').trim()||'(sin vendedor)';
    if(!m.has(v)) m.set(v,{v,viajes:new Set(),ent:0,kg:0,sug:0,cob:0,pag:0});
    [m.get(v),T].forEach(o=>{ o.viajes.add(k); o.ent++; o.kg+=+e.kg||0; o.sug+=+e.sugerido||0; o.cob+=+e.cobrado||0; o.pag+=+e.pagado||0; }); });
  const fin=o=>Object.assign(o,{nv:o.viajes.size,dcs:o.cob-o.sug,dcp:o.cob-o.pag,dsp:o.sug-o.pag,pcs:o.sug?o.cob/o.sug*100:null,pcp:o.pag?o.cob/o.pag*100:null,psp:o.pag?o.sug/o.pag*100:null});
  const lista=[...m.values()].map(fin); fin(T);
  const k=_desp.vord, desc={cob:1,sug:1,pag:1,viajes:1}[k], key=k==='viajes'?'nv':k;
  lista.sort((x,y)=>{ const X=x[key], Y=y[key]; if(X==null&&Y==null) return 0; if(X==null) return 1; if(Y==null) return -1; return desc?Y-X:X-Y; });
  return {lista,T};
}
function despVendHTML(){
  const {lista,T}=despVendLista();
  const tiles=tile('Vendedores',nf0.format(lista.length),nf0.format(T.nv)+' viajes · '+nf0.format(T.ent)+' entregas · '+nf0.format(T.kg/1000)+' t')+
    tileS('Cobrado vs sugerido',mm(T.dcs/1e6),'cobrado '+mm(T.cob/1e6)+' · sugerido '+mm(T.sug/1e6),{c:T.dcs>=0?'#1E8449':'#C0000C',t:'% cobrado / sugerido '+pct(T.pcs)})+
    tileS('Cobrado vs pagado',mm(T.dcp/1e6),'pagado '+mm(T.pag/1e6),{c:T.dcp>=0?'#1E8449':'#C0000C',t:'% cobrado / pagado '+pct(T.pcp)})+
    tileS('Sugerido vs pagado',mm(T.dsp/1e6),'tarifa sistema vs pago transportista',{c:T.dsp>=0?'#1E8449':'#C0000C',t:'% sugerido / pagado '+pct(T.psp)});
  if(!lista.length) return `<div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div><div class="text-secondary text-[14px] py-sm">Sin entregas con esos filtros.</div>`;
  const th=(t,l,c)=>`<th class="${l?'text-left':'text-right'} px-[6px] py-[4px] font-medium ${c||''}" style="color:#fff">${t}</th>`;
  const pc=v=>v==null?'–':nf1.format(v)+'%';
  const fila=(o,i,tot)=>{ const b=tot?'font-semibold':'';
    return `<tr class="border-t border-surface-variant ${tot?'':'cursor-pointer hover:bg-surface-container-low'}" ${tot?'style="background:#E9ECF2"':'data-vend="'+esc(o.v)+'" title="Ver despachos del vendedor"'}>
      <td class="px-[6px] py-[3px] text-secondary tabular-nums text-center">${tot?'':i+1}</td>
      <td class="px-[6px] whitespace-nowrap ${b}">${tot?'Total':esc(o.v)}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${nf0.format(o.nv)}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${nf0.format(o.ent)}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${nf0.format(o.kg)}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${o.sug?peso(o.sug):'–'}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${o.cob?peso(o.cob):'–'}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${o.pag?peso(o.pag):'–'}</td>
      <td class="px-[6px] text-right tabular-nums border-l border-surface-variant ${b}">${pesoC(o.dcs)}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${o.cob?pc(o.pcs):'–'}</td>
      <td class="px-[6px] text-right tabular-nums border-l border-surface-variant ${b}">${pesoC(o.dcp)}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${o.cob?cobC(o.pcp):'–'}</td>
      <td class="px-[6px] text-right tabular-nums border-l border-surface-variant ${b}">${pesoC(o.dsp)}</td>
      <td class="px-[6px] text-right tabular-nums ${b}">${o.sug?pc(o.psp):'–'}</td></tr>`; };
  return `<div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div>
    <div class="overflow-x-auto"><table class="w-full text-[13px]"><thead><tr style="background:#1F3864">
      ${th('#')}${th('Vendedor',1)}${th('N° viajes')}${th('N° entregas')}${th('Kg')}${th('Flete sugerido')}${th('Flete cobrado')}${th('Flete pagado')}${th('Cobrado − sugerido')}${th('% cobrado / sugerido')}${th('Cobrado − pagado')}${th('% cobrado / pagado')}${th('Sugerido − pagado')}${th('% sugerido / pagado')}
    </tr></thead><tbody>${fila(T,0,true)}${lista.map((o,i)=>fila(o,i,false)).join('')}</tbody></table></div>`;
}
function despVendCSV(){
  const {lista,T}=despVendLista(), r0=v=>v==null?'':Math.round(v), p1=v=>v==null?'':String(Math.round(v*10)/10).replace('.',',');
  const cols=['#','Vendedor','N viajes','N entregas','Kg','Flete sugerido','Flete cobrado','Flete pagado','Cobrado - sugerido','% cobrado/sugerido','Cobrado - pagado','% cobrado/pagado','Sugerido - pagado','% sugerido/pagado'];
  const fila=(o,i)=>[i,o.v,o.nv,o.ent,r0(o.kg),r0(o.sug),r0(o.cob),r0(o.pag),r0(o.dcs),p1(o.pcs),r0(o.dcp),p1(o.pcp),r0(o.dsp),p1(o.psp)].map(v=>{ v=v==null?'':String(v); return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }).join(';');
  const txt='﻿'+cols.join(';')+'\n'+fila(Object.assign({},T,{v:'Total'}),'')+'\n'+lista.map((o,i)=>fila(o,i+1)).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'}));
  a.download='Ranking_Vendedores_'+_desp.grupo+'_'+new Date().toISOString().slice(0,10)+'.csv'; document.body.appendChild(a); a.click(); a.remove();
}
function despEntHTML(list){
  if(!list.length) return `<div class="text-secondary text-[13px] py-sm">Sin entregas.</div>`;
  const th=(t,l)=>`<th class="${l?'text-left':'text-right'} px-[6px] font-medium whitespace-nowrap">${t}</th>`;
  const rows=list.map(e=>{ const res=(+e.cobrado||0)-(+e.pagado||0);
    return `<tr class="border-t border-surface-variant">
      <td class="px-[6px] tabular-nums">${esc(e.entrega)}</td><td class="px-[6px] tabular-nums">${esc(e.nota_venta||'–')}</td>
      <td class="px-[6px]">${esc(e.clase_doc_venta||'–')}</td><td class="px-[6px] tabular-nums">${esc(e.factura||'–')}</td>
      <td class="px-[6px] whitespace-nowrap">${esc(e.vendedor||'–')}</td><td class="px-[6px] tabular-nums">${esc(e.id_cliente||'–')}</td>
      <td class="px-[6px] tabular-nums">${esc(e.id_obra||'–')}</td><td class="px-[6px]">${esc(e.comuna||'–')}</td>
      <td class="px-[6px] whitespace-nowrap">${esc(NEG_LBL[e.negocio]||e.negocio)}${e.express?' · Express':''}</td>
      <td class="px-[6px] whitespace-nowrap">${fd(e.fecha_nv)}</td><td class="px-[6px] whitespace-nowrap">${fd(e.fecha_factura)}</td><td class="px-[6px] whitespace-nowrap">${fd(e.fecha_entrega)}</td>
      <td class="px-[6px] text-right tabular-nums">${nf0.format(e.kg||0)}</td><td class="px-[6px] text-right tabular-nums">${peso(+e.sugerido)}</td>
      <td class="px-[6px] text-right tabular-nums">${peso(+e.cobrado)}</td><td class="px-[6px] text-right tabular-nums">${peso(+e.pagado)}</td>
      <td class="px-[6px] text-right tabular-nums">${pesoC(res)}</td></tr>`; }).join('');
  return `<div class="overflow-x-auto"><table class="w-full text-[12px]"><thead><tr class="text-secondary">
    ${th('Entrega',1)}${th('NV',1)}${th('Clase doc.',1)}${th('Factura',1)}${th('Vendedor',1)}${th('Cliente',1)}${th('Obra',1)}${th('Comuna',1)}${th('Tipo',1)}${th('F. NV',1)}${th('F. factura',1)}${th('F. entrega',1)}${th('Kg')}${th('Sugerido')}${th('Cobrado')}${th('Pagado')}${th('Resultado')}
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function despModal(key){
  const [suc,dt]=key.split('|');
  const r=(_despRows[_desp.grupo]||[]).find(x=>x.suc_id===suc && x.dt===dt)||{suc_id:suc,dt:dt};
  const res=(+r.cobrado||0)-(+r.pagado||0), cb=+r.pagado?(+r.cobrado||0)/(+r.pagado)*100:null;
  const dato=(k,v)=>`<div><div class="text-[12px] text-secondary">${k}</div><div class="text-[14px] font-medium">${v}</div></div>`;
  const head=`<div class="flex items-baseline gap-md flex-wrap mb-sm pr-lg">
      <div class="text-headline-sm font-bold">Despacho DT ${esc(dt)}</div>
      <div class="text-secondary">${esc(sucNom(suc))} · ${fd(r.fecha_transporte)}</div><div>${despChips(r)}</div></div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-md">
      ${dato('Transportista',esc(r.transportista||'–'))}${dato('Capacidad camión',r.cap_camion?esc(r.cap_camion)+' t':'–')}
      ${dato('Vendedor(es)',esc(r.vendedores||'–'))}${dato('Comunas',esc(r.comunas||'–'))}</div>
    <div class="grid grid-cols-2 md:grid-cols-5 gap-sm mb-md">
      ${tile('Entregas',nf0.format(r.n_entregas||0),nf0.format(r.kg||0)+' kg')}
      ${tile('Sugerido',peso(+r.sugerido),'tarifa sistema')}
      ${tile('Cobrado',peso(+r.cobrado),'cobrado / sugerido '+pct(+r.sugerido?(+r.cobrado||0)/(+r.sugerido)*100:null))}
      ${tile('Pagado',peso(+r.pagado),'al transportista')}
      ${tileS('Resultado',pesoC(res),'cobrado − pagado',res>=0?{c:'#1E8449',t:'Cobertura '+pct(cb)}:{c:'#C0000C',t:'Cobertura '+pct(cb)})}</div>
    <div class="text-label-caps text-secondary uppercase mb-1">Entregas del despacho</div>`;
  openModal(head+`<div id="desp_modal_ent">${loadingHTML()}</div>`);
  const box=_modal && _modal.firstElementChild; if(box) box.style.maxWidth='1500px';
  try{
    if(!_despEnt[key]){ const {data,error}=await supabase.from('v_ind_despacho_entrega').select('*').eq('dt',dt).eq('suc_id',suc).order('entrega'); if(error) throw error; _despEnt[key]=data||[]; }
    const el=document.getElementById('desp_modal_ent'); if(el) el.innerHTML=despEntHTML(_despEnt[key]);
  }catch(e){ const el=document.getElementById('desp_modal_ent'); if(el) el.innerHTML=errorHTML(e); }
}
async function despPaint(){
  const el=document.getElementById('desp_body'); if(!el) return;
  try{
    const g=_desp.grupo;
    if(!_despRows[g]){ el.innerHTML=loadingHTML();
      _despRows[g]=await nsFetchAll(()=>supabase.from('v_ind_despacho').select('*').eq('grupo',g).order('fecha_transporte',{ascending:false}).order('dt')); }
    if(_desp.modo==='vend' && !_despEntG[g]){ el.innerHTML=loadingHTML();
      _despEntG[g]=await nsFetchAll(()=>supabase.from('v_ind_despacho_entrega').select('suc_id,dt,entrega,vendedor,negocio,express,kg,sugerido,cobrado,pagado').eq('grupo',g).order('dt').order('entrega')); }
    const ps=document.getElementById('desp_per');
    if(ps){ const meses=[...new Set((_despRows[g]||[]).map(r=>r.mes_label).filter(Boolean))].sort().reverse();
      if(String(_desp.per).indexOf('M:')===0 && meses.indexOf(_desp.per.slice(2))<0) meses.unshift(_desp.per.slice(2));
      const opts=NS_PER.concat(meses.map(m=>['M:'+m,'Mes '+MES_NOM[+m.slice(5,7)-1]+'-'+m.slice(0,4)]));
      ps.innerHTML=opts.map(o=>`<option value="${o[0]}" ${o[0]===_desp.per?'selected':''}>${o[1]}</option>`).join(''); }
    if(_desp.modo==='vend'){
      el.innerHTML=despVendHTML();
      el.querySelectorAll('tr[data-vend]').forEach(tr=>tr.onclick=()=>{ _desp.vend=tr.getAttribute('data-vend'); _desp.modo='desp'; _desp.page=0; despModoUI(); despPaint(); });
      return; }
    const vs=document.getElementById('desp_vend');
    if(vs){ const [a,b]=despRango(_desp.per), cnt={};
      (_despRows[g]||[]).filter(r=>r.mes_label>=a&&r.mes_label<=b&&despRutaOk(r)).forEach(r=>String(r.vendedores||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(v=>cnt[v]=(cnt[v]||0)+1));
      const vend=Object.keys(cnt).sort((x,y)=>x.localeCompare(y,'es'));
      if(_desp.vend!=='TODOS' && vend.indexOf(_desp.vend)<0) vend.unshift(_desp.vend);
      vs.innerHTML=[['TODOS','Todos ('+vend.length+')']].concat(vend.map(v=>[v,v+' ('+(cnt[v]||0)+')'])).map(o=>`<option value="${esc(o[0])}" ${o[0]===_desp.vend?'selected':''}>${esc(o[1])}</option>`).join(''); }
    el.innerHTML=despBodyHTML();
    el.querySelectorAll('tr[data-desp]').forEach(tr=>tr.onclick=()=>despModal(tr.getAttribute('data-desp')));
    const pv=document.getElementById('desp_prev'), nx=document.getElementById('desp_next');
    if(pv) pv.onclick=()=>{ _desp.page--; _despOpen=null; despPaint(); };
    if(nx) nx.onclick=()=>{ _desp.page++; _despOpen=null; despPaint(); };
  }catch(e){ el.innerHTML=errorHTML(e); }
}
function despModoUI(){
  const d=document.getElementById('desp_donly'), v=document.getElementById('desp_vonly');
  if(d) d.style.display=_desp.modo==='desp'?'':'none'; if(v) v.style.display=_desp.modo==='vend'?'':'none';
  [['desp_m_desp','desp'],['desp_m_vend','vend']].forEach(([id,m])=>{ const b=document.getElementById(id); if(!b) return;
    b.className=(id==='desp_m_vend'?'border-l border-surface-variant ':'')+'px-md py-[4px] '+(_desp.modo===m?'bg-primary text-on-primary font-semibold':'hover:bg-surface-container-low'); });
}
function despCSV(){
  if(_desp.modo==='vend') return despVendCSV();
  const rows=despFiltra();
  const cols=[['Fecha transporte',r=>r.fecha_transporte],['DT',r=>r.dt],['Sucursal',r=>sucNom(r.suc_id)],['Transportista',r=>r.transportista],['Cap camion',r=>r.cap_camion],
    ['Vendedores',r=>r.vendedores],['Comunas',r=>r.comunas],['N entregas',r=>r.n_entregas],['Entregas',r=>r.entregas],['Kg',r=>Math.round(+r.kg||0)],
    ['Flete sugerido',r=>Math.round(+r.sugerido||0)],['Flete cobrado',r=>Math.round(+r.cobrado||0)],['Flete pagado',r=>Math.round(+r.pagado||0)],
    ['Resultado',r=>Math.round((+r.cobrado||0)-(+r.pagado||0))],['Tipo negocio',r=>r.negocios],['Express',r=>r.express?'Si':'No'],['Segmento',r=>r.segmento]];
  const q=v=>{ v=v==null?'':String(v); return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const txt='﻿'+cols.map(c=>c[0]).join(';')+'\n'+rows.map(r=>cols.map(c=>q(c[1](r))).join(';')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'}));
  a.download='Detalle_Despachos_'+_desp.grupo+(_desp.vend!=='TODOS'?'_'+_desp.vend.replace(/\s+/g,'_'):'')+'_'+new Date().toISOString().slice(0,10)+'.csv'; document.body.appendChild(a); a.click(); a.remove();
}
async function renderDespachos(container){
  container.innerHTML=loadingHTML();
  try{
    if(!_finRows) _finRows=await nsFetchAll(()=>supabase.from('v_ind_fin_flete').select('*'));
    const grupos=[...new Set(_finRows.map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
    if(!grupos.length){ container.innerHTML=`<div class="text-secondary p-lg">Sin datos de flete para tus centros.</div>`; return; }
    if(!_desp.grupo||grupos.indexOf(_desp.grupo)<0) _desp.grupo=(grupos.indexOf('CONCEPCION')>=0?'CONCEPCION':grupos[0]);
    container.innerHTML=despShellHTML(grupos);
    const on=(id,k,ev)=>{ const s=document.getElementById(id); if(!s) return; s[ev||'onchange']=e=>{ _desp[k]=(e.target.type==='checkbox'?e.target.checked:e.target.value); if(k==='grupo') _desp.vend='TODOS'; _desp.page=0; _despOpen=null; despPaint(); }; };
    on('desp_grp','grupo'); on('desp_per','per'); on('desp_vend','vend'); on('desp_neg','neg'); on('desp_ord','orden'); on('desp_perd','perd'); on('desp_ruta','ruta'); on('desp_vord','vord');
    [['desp_m_desp','desp'],['desp_m_vend','vend']].forEach(([id,m])=>{ const bt=document.getElementById(id); if(bt) bt.onclick=()=>{ if(_desp.modo===m) return; _desp.modo=m; _desp.page=0; despModoUI(); despPaint(); }; });
    const qi=document.getElementById('desp_q'); let tq=null;
    if(qi) qi.oninput=e=>{ clearTimeout(tq); tq=setTimeout(()=>{ _desp.q=e.target.value; _desp.page=0; _despOpen=null; despPaint(); },250); };
    const b=document.getElementById('desp_csv'); if(b) b.onclick=despCSV;
    await despPaint();
  }catch(e){ container.innerHTML=errorHTML(e); }
}
// ============================================================================
//  PAGADO TRANSPORTISTAS (23-nov-2026) — por agente de servicio: monto pagado,
//  viajes (DT) y puntos de entrega por viaje. Fuente: v_ind_viaje_transp (FLETE 360).
// ============================================================================
let _tr={grupo:'TODOS', per:'anio', seg:'TODOS', cap:'TODAS', q:'', orden:'pag'}, _trRows={};
const TR_ORD=[['pag','Pagado (mayor primero)'],['viajes','Viajes (más primero)'],['ppv','Puntos por viaje (más primero)'],['cpv','$ por viaje (mayor primero)'],['cpp','$ por punto (mayor primero)']];
function trAgg(rows){
  const o={viajes:rows.length,pag:0,ptos:0,ent:0,ton:0,uno:0,pat:new Set()};
  rows.forEach(r=>{ o.pag+=+r.pagado||0; o.ptos+=+r.n_puntos||0; o.ent+=+r.n_entregas||0; o.ton+=+r.ton||0; if((+r.n_puntos||0)<=1) o.uno++;
    String(r.patentes||'').split(',').map(s=>s.trim()).filter(Boolean).forEach(p=>o.pat.add(p)); });
  o.ppv=o.viajes?o.ptos/o.viajes:null; o.epv=o.viajes?o.ent/o.viajes:null; o.cpv=o.viajes?o.pag/o.viajes:null;
  o.cpp=o.ptos?o.pag/o.ptos:null; o.ckg=o.ton?o.pag/(o.ton*1000):null; return o;
}
function trBase(){
  const rows=_trRows[_tr.grupo]||[], [a,b]=nsRango(_tr.per);
  return rows.filter(r=>r.mes_label>=a && r.mes_label<=b && (_tr.seg==='TODOS'||r.segmento===_tr.seg) && (_tr.cap==='TODAS'||String(r.cap_camion)===_tr.cap));
}
function trPorTransp(rows){
  const m=new Map();
  rows.forEach(r=>{ const k=r.id_transportista||r.transportista||'(sin transportista)'; if(!m.has(k)) m.set(k,{id:k,nombre:r.transportista||k,rows:[]}); m.get(k).rows.push(r); });
  const out=[...m.values()].map(t=>Object.assign(t,trAgg(t.rows),{caps:(()=>{const c={}; t.rows.forEach(r=>{const k=r.cap_camion||'–'; c[k]=(c[k]||0)+1;}); return Object.entries(c).sort((x,y)=>y[1]-x[1]).map(x=>x[0]+' t').slice(0,2).join(' / ');})()}));
  const q=_tr.q.trim().toLowerCase();
  const f=q?out.filter(t=>(t.nombre+' '+t.id).toLowerCase().indexOf(q)>=0):out;
  const k={pag:'pag',viajes:'viajes',ppv:'ppv',cpv:'cpv',cpp:'cpp'}[_tr.orden];
  return f.sort((x,y)=>(y[k]||0)-(x[k]||0));
}
function trDistHTML(rows){
  const n=rows.length||1, b=[0,0,0,0]; rows.forEach(r=>{ const p=+r.n_puntos||0; b[p<=1?0:p===2?1:p===3?2:3]++; });
  const col=['#A9ACAE','#E88A8F','#EE1B22','#C0000C'], lab=['1 punto','2 puntos','3 puntos','4 o más'];
  return `<div class="mb-md"><div class="text-[13px] text-secondary mb-[4px]">Distribución de viajes por N° de puntos de entrega</div>
    <div style="display:flex;height:22px;border-radius:6px;overflow:hidden">${b.map((v,i)=>v?`<div title="${lab[i]}: ${nf0.format(v)} viajes" style="width:${v/n*100}%;background:${col[i]};color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden">${v/n>=0.06?nf0.format(v/n*100)+'%':''}</div>`:'').join('')}</div>
    <div class="flex flex-wrap gap-md text-[12px] text-secondary mt-[4px]">${b.map((v,i)=>`<span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${col[i]}"></span> ${lab[i]}: ${nf0.format(v)} (${nf1.format(v/n*100)}%)</span>`).join('')}</div></div>`;
}
function trBodyHTML(){
  const rows=trBase(), T=trAgg(rows), lista=trPorTransp(rows);
  if(!rows.length) return `<div class="text-secondary text-[14px] py-sm">Sin viajes con esos filtros.</div>`;
  const tiles=tile('Pagado a transportistas',mm(T.pag/1e6),nf0.format(lista.length)+' agentes de servicio')+
    tile('Viajes',nf0.format(T.viajes),nf0.format(T.ent)+' entregas · '+nf0.format(T.ton)+' t')+
    tile('Puntos por viaje',nf1.format(T.ppv||0),nf0.format(T.ptos)+' puntos · '+nf1.format(T.epv||0)+' entregas/viaje')+
    tile('Costo por viaje',peso(T.cpv),'por punto '+peso(T.cpp)+' · $/kg '+(T.ckg!=null?nf1.format(T.ckg):'–'));
  const th=(t,l)=>`<th class="${l?'text-left':'text-right'} px-[6px] font-medium whitespace-nowrap">${t}</th>`;
  const body=lista.map((t,i)=>`<tr class="border-t border-surface-variant cursor-pointer hover:bg-surface-container-low" data-tr="${esc(t.id)}" title="Ver detalle del transportista">
      <td class="px-[6px] py-[3px] text-secondary tabular-nums">${i+1}</td>
      <td class="px-[6px] whitespace-nowrap">${esc(t.nombre)}</td>
      <td class="px-[6px] text-right tabular-nums">${nf0.format(t.viajes)}</td>
      <td class="px-[6px] text-right tabular-nums font-semibold">${peso(t.pag)}</td>
      <td class="px-[6px] text-right tabular-nums">${pct(T.pag?t.pag/T.pag*100:null)}</td>
      <td class="px-[6px] text-right tabular-nums">${peso(t.cpv)}</td>
      <td class="px-[6px] text-right tabular-nums">${nf0.format(t.ptos)}</td>
      <td class="px-[6px] text-right tabular-nums font-semibold">${nf1.format(t.ppv||0)}</td>
      <td class="px-[6px] text-right tabular-nums">${pct(t.viajes?t.uno/t.viajes*100:null)}</td>
      <td class="px-[6px] text-right tabular-nums">${nf1.format(t.epv||0)}</td>
      <td class="px-[6px] text-right tabular-nums">${peso(t.cpp)}</td>
      <td class="px-[6px] text-right tabular-nums">${nf0.format(t.ton)}</td>
      <td class="px-[6px] text-right tabular-nums">${t.ckg!=null?'$'+nf1.format(t.ckg):'–'}</td>
      <td class="px-[6px] text-right tabular-nums">${nf0.format(t.pat.size)}</td>
      <td class="px-[6px] whitespace-nowrap">${esc(t.caps)}</td></tr>`).join('');
  return `<div class="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">${tiles}</div>${trDistHTML(rows)}
    <div class="overflow-x-auto"><table class="w-full text-[13px]"><thead><tr class="text-secondary">
      ${th('#',1)}${th('Agente de servicio',1)}${th('Viajes')}${th('Pagado')}${th('% pagado')}${th('$ / viaje')}${th('Puntos')}${th('Puntos / viaje')}${th('% viajes 1 punto')}${th('Entregas / viaje')}${th('$ / punto')}${th('Ton')}${th('$ / kg')}${th('Patentes')}${th('Camión',1)}
    </tr></thead><tbody>${body}</tbody>
    <tfoot><tr class="border-t-2 border-surface-variant font-semibold"><td></td><td class="px-[6px]">Total</td>
      <td class="px-[6px] text-right tabular-nums">${nf0.format(T.viajes)}</td><td class="px-[6px] text-right tabular-nums">${peso(T.pag)}</td><td class="px-[6px] text-right">100%</td>
      <td class="px-[6px] text-right tabular-nums">${peso(T.cpv)}</td><td class="px-[6px] text-right tabular-nums">${nf0.format(T.ptos)}</td><td class="px-[6px] text-right tabular-nums">${nf1.format(T.ppv||0)}</td>
      <td class="px-[6px] text-right tabular-nums">${pct(T.viajes?T.uno/T.viajes*100:null)}</td><td class="px-[6px] text-right tabular-nums">${nf1.format(T.epv||0)}</td>
      <td class="px-[6px] text-right tabular-nums">${peso(T.cpp)}</td><td class="px-[6px] text-right tabular-nums">${nf0.format(T.ton)}</td>
      <td class="px-[6px] text-right tabular-nums">${T.ckg!=null?'$'+nf1.format(T.ckg):'–'}</td><td class="px-[6px] text-right tabular-nums">${nf0.format(T.pat.size)}</td><td></td></tr></tfoot></table></div>`;
}
function trModal(id){
  const t=trPorTransp(trBase()).find(x=>x.id===id); if(!t) return;
  const meses=[...new Set(t.rows.map(r=>r.mes_label))].sort();
  const mesRows=meses.map(m=>{ const a=trAgg(t.rows.filter(r=>r.mes_label===m));
    return `<tr class="border-t border-surface-variant"><td class="px-[6px] py-[2px]">${mesCorto(m)} ${m.slice(0,4)}</td><td class="px-[6px] text-right tabular-nums">${nf0.format(a.viajes)}</td><td class="px-[6px] text-right tabular-nums">${peso(a.pag)}</td><td class="px-[6px] text-right tabular-nums">${peso(a.cpv)}</td><td class="px-[6px] text-right tabular-nums">${nf1.format(a.ppv||0)}</td><td class="px-[6px] text-right tabular-nums">${nf0.format(a.ton)}</td></tr>`; }).join('');
  const viajes=t.rows.slice().sort((x,y)=>String(y.fecha_transporte).localeCompare(String(x.fecha_transporte)));
  const LIM=300, th=(x,l)=>`<th class="${l?'text-left':'text-right'} px-[6px] font-medium whitespace-nowrap">${x}</th>`;
  const vRows=viajes.slice(0,LIM).map(r=>`<tr class="border-t border-surface-variant">
      <td class="px-[6px] py-[2px] whitespace-nowrap">${fd(r.fecha_transporte)}</td><td class="px-[6px] tabular-nums">${esc(r.dt)}</td>
      <td class="px-[6px] whitespace-nowrap">${esc(sucNom(r.suc_id))}</td><td class="px-[6px] whitespace-nowrap">${esc(nice(String(r.segmento||'').replace('_',' ')))}</td>
      <td class="px-[6px] whitespace-nowrap">${esc(r.patentes||'–')}</td><td class="px-[6px]" style="max-width:160px">${esc(r.choferes||'–')}</td>
      <td class="px-[6px] text-right tabular-nums">${esc(r.cap_camion||'–')}</td><td class="px-[6px]" style="max-width:220px">${esc(r.comunas||'–')}</td>
      <td class="px-[6px] text-right tabular-nums font-semibold">${nf0.format(r.n_puntos||0)}</td><td class="px-[6px] text-right tabular-nums">${nf0.format(r.n_entregas||0)}</td>
      <td class="px-[6px] text-right tabular-nums">${nf1.format(+r.ton||0)}</td><td class="px-[6px] text-right tabular-nums">${peso(+r.pagado)}</td></tr>`).join('');
  const per=(NS_PER.find(p=>p[0]===_tr.per)||[])[1]||'';
  openModal(`<div class="flex items-baseline gap-md flex-wrap mb-sm pr-lg"><div class="text-headline-sm font-bold">${esc(t.nombre)}</div>
      <div class="text-secondary">Agente de servicio ${esc(t.id)} · ${esc(_tr.grupo==='TODOS'?'Todos los centros':nice(_tr.grupo))} · ${esc(per)}</div></div>
    <div class="grid grid-cols-2 md:grid-cols-5 gap-sm mb-md">
      ${tile('Pagado',peso(t.pag),'$/kg '+(t.ckg!=null?nf1.format(t.ckg):'–'))}${tile('Viajes',nf0.format(t.viajes),peso(t.cpv)+' por viaje')}
      ${tile('Puntos por viaje',nf1.format(t.ppv||0),nf0.format(t.ptos)+' puntos · '+pct(t.viajes?t.uno/t.viajes*100:null)+' de 1 punto')}
      ${tile('Entregas',nf0.format(t.ent),nf1.format(t.epv||0)+' por viaje')}${tile('Patentes',nf0.format(t.pat.size),esc([...t.pat].slice(0,4).join(', ')))}</div>
    ${trDistHTML(t.rows)}
    <div class="text-label-caps text-secondary uppercase mb-1">Evolución mensual</div>
    <div class="overflow-x-auto mb-md"><table class="text-[13px]"><thead><tr class="text-secondary">${th('Mes',1)}${th('Viajes')}${th('Pagado')}${th('$ / viaje')}${th('Puntos / viaje')}${th('Ton')}</tr></thead><tbody>${mesRows}</tbody></table></div>
    <div class="text-label-caps text-secondary uppercase mb-1">Viajes (${nf0.format(viajes.length)}${viajes.length>LIM?' · se muestran los '+LIM+' más recientes':''})</div>
    <div class="overflow-x-auto"><table class="w-full text-[12px]"><thead><tr class="text-secondary">${th('Fecha',1)}${th('DT',1)}${th('Centro',1)}${th('Tipo',1)}${th('Patente',1)}${th('Chofer',1)}${th('Cap. t')}${th('Comunas',1)}${th('Puntos')}${th('Entregas')}${th('Ton')}${th('Pagado')}</tr></thead><tbody>${vRows}</tbody></table></div>`);
  const box=_modal && _modal.firstElementChild; if(box) box.style.maxWidth='1500px';
}
function trCSV(){
  const rows=trBase(), lista=trPorTransp(rows);
  const cols=[['ID agente',t=>t.id],['Agente de servicio',t=>t.nombre],['Viajes',t=>t.viajes],['Pagado',t=>Math.round(t.pag)],['$ por viaje',t=>Math.round(t.cpv||0)],
    ['Puntos',t=>t.ptos],['Puntos por viaje',t=>nf1.format(t.ppv||0)],['% viajes 1 punto',t=>nf1.format(t.viajes?t.uno/t.viajes*100:0)],['Entregas',t=>t.ent],
    ['$ por punto',t=>Math.round(t.cpp||0)],['Ton',t=>nf1.format(t.ton)],['$ por kg',t=>t.ckg!=null?nf1.format(t.ckg):''],['Patentes',t=>[...t.pat].join(' ')],['Camion',t=>t.caps]];
  const q=v=>{ v=v==null?'':String(v); return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const txt='﻿'+cols.map(c=>c[0]).join(';')+'\n'+lista.map(t=>cols.map(c=>q(c[1](t))).join(';')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'}));
  a.download='Pagado_Transportistas_'+_tr.grupo+'_'+new Date().toISOString().slice(0,10)+'.csv'; document.body.appendChild(a); a.click(); a.remove();
}
async function trPaint(){
  const el=document.getElementById('tr_body'); if(!el) return;
  try{
    const g=_tr.grupo;
    if(!_trRows[g]){ el.innerHTML=loadingHTML();
      _trRows[g]=await nsFetchAll(()=>{ let q=supabase.from('v_ind_viaje_transp').select('*'); if(g!=='TODOS') q=q.eq('grupo',g); return q.order('dt'); }); }
    const caps=[...new Set((_trRows[g]||[]).map(r=>r.cap_camion).filter(Boolean))].sort((a,b)=>(+a)-(+b));
    const cs=document.getElementById('tr_cap');
    if(cs){ if(caps.indexOf(_tr.cap)<0) _tr.cap='TODAS'; cs.innerHTML=[['TODAS','Todas']].concat(caps.map(c=>[c,c+' t'])).map(o=>`<option value="${o[0]}" ${o[0]===_tr.cap?'selected':''}>${o[1]}</option>`).join(''); }
    el.innerHTML=trBodyHTML();
    el.querySelectorAll('tr[data-tr]').forEach(tr=>tr.onclick=()=>trModal(tr.getAttribute('data-tr')));
  }catch(e){ el.innerHTML=errorHTML(e); }
}
async function renderTransportistas(container){
  container.innerHTML=loadingHTML();
  try{
    const {data,error}=await supabase.from('v_ind_viaje_transp').select('grupo,fecha_transporte').order('fecha_transporte',{ascending:false}).limit(1);
    if(error) throw error;
    const ult=(data&&data[0])?data[0].fecha_transporte:null;
    if(!_finRows) _finRows=await nsFetchAll(()=>supabase.from('v_ind_fin_flete').select('*'));
    const grupos=[...new Set(_finRows.map(r=>r.grupo))].filter(g=>g&&g!=='OTROS').sort();
    if(_tr.grupo!=='TODOS' && grupos.indexOf(_tr.grupo)<0) _tr.grupo='TODOS';
    const opG=[['TODOS','Todos los centros']].concat(grupos.map(g=>[g,nice(g)]));
    container.innerHTML=`<div class="w-full mx-auto" style="max-width:1760px">
      <div class="flex items-center gap-md mb-md flex-wrap">
        <div class="text-headline-sm font-bold">Pagado Transportistas — por agente de servicio</div>
        <label class="text-secondary text-body-md ml-auto">Centro:</label>${nsSel('tr_grp',opG,_tr.grupo)}
      </div>
      <section class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md md:p-lg mb-lg">
        <div class="flex flex-wrap items-center gap-md mb-md text-[14px]">
          <label class="text-secondary">Período:</label>${nsSel('tr_per',NS_PER,_tr.per)}
          <label class="text-secondary">Despachos:</label>${nsSel('tr_seg',SEG_FIN,_tr.seg)}
          <label class="text-secondary">Camión:</label><select id="tr_cap" class="border border-surface-variant rounded-lg px-sm py-[4px] bg-surface-container-lowest text-on-surface text-[14px]"></select>
          <label class="text-secondary">Ordenar:</label>${nsSel('tr_ord',TR_ORD,_tr.orden)}
          <input id="tr_q" type="search" value="${esc(_tr.q)}" placeholder="Buscar transportista…" class="border border-surface-variant rounded-lg px-sm py-[4px] bg-surface-container-lowest text-on-surface" style="min-width:220px">
          <button id="tr_csv" class="ml-auto border border-surface-variant rounded-lg px-md py-[4px] hover:bg-surface-container-low">⬇ Descargar CSV</button>
        </div>
        <div id="tr_body"></div>
      </section>
      <div class="text-[13px] text-secondary leading-relaxed">Fuente: reporte FLETE 360 (flete pagado al transportista)${ult?' · último viaje cargado: <b>'+fd(ult)+'</b>':''}. Un viaje = documento de transporte (DT). Punto de entrega = obra distinta dentro del viaje (si falta, dirección, cliente o centro destino). Incluye última milla y troncales; filtra con "Despachos". Clic en un transportista para ver su detalle mensual y sus viajes.</div>
    </div>`;
    const on=(id,k)=>{ const s=document.getElementById(id); if(s) s.onchange=e=>{ _tr[k]=e.target.value; trPaint(); }; };
    on('tr_grp','grupo'); on('tr_per','per'); on('tr_seg','seg'); on('tr_cap','cap'); on('tr_ord','orden');
    const qi=document.getElementById('tr_q'); let tq=null;
    if(qi) qi.oninput=e=>{ clearTimeout(tq); tq=setTimeout(()=>{ _tr.q=e.target.value; trPaint(); },250); };
    const b=document.getElementById('tr_csv'); if(b) b.onclick=trCSV;
    await trPaint();
  }catch(e){ container.innerHTML=errorHTML(e); }
}
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
  ensureTip(); drawMargen(_cacheMar2,_grupoM); sweepHeat(); finPaint();
  const sel=document.getElementById('ind_selm'); if(sel) sel.onchange=ev=>{_grupoM=ev.target.value; paintMargen(container,grupos);};
}
function margenHTML(d,grupos,grupo){
  const opciones=grupos.map(g=>`<option value="${g}" ${g===grupo?'selected':''}>${nice(g)}</option>`).join('');
  const sc=d.sc.filter(r=>r.grupo===grupo && r.segmento===_segM);
  const scMonto=sum(sc.map(r=>r.monto_sugerido))/1e6, scEnt=sum(sc.map(r=>r.entregas));
  return `<div class="w-full mx-auto" style="max-width:1760px">
    <div class="flex items-center gap-md mb-md flex-wrap">
      <div class="text-headline-sm font-bold">Margen de Flete — detalle</div>
      <label class="text-secondary text-body-md ml-auto">Centro:</label>
      <select id="ind_selm" class="border border-surface-variant rounded-lg px-md py-sm bg-surface-container-lowest text-on-surface">${opciones}</select>
    </div>
    <div class="text-[13px] text-secondary -mt-sm mb-md">Solo <b>última milla</b> (entregas a cliente). Excluye traslados troncales de reposición.</div>
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
    ${card('4 · Financiamiento del flete por sucursal','Normal, E-Click y fletes especiales (ZV15 / ZV20) — cobrado vs pagado','',`<div id="m_fin_wrap"></div>`,'sec-fin')}
    <div class="text-[13px] text-secondary mt-lg leading-relaxed">Flete no cobrado = entregas con flete cobrado = 0; monto = flete sugerido (lo que no se cobró). Ranking excluye EbemaClick.</div>
  </div>`;
}
function vendMargenTablaHTML(rows,grupo){
  const v=(rows||[]).filter(r=>r.grupo===grupo && r.segmento===_segM)
    .map(r=>({...r,brechaPC:(r.pagado||0)-(r.cobrado||0)}))
    .sort((a,b)=>b.brechaPC-a.brechaPC).slice(0,10);
  if(!v.length) return `<div class="text-secondary text-[14px] py-md">Sin datos.</div>`;
  const filas=v.map(r=>`<tr class="border-t border-surface-variant">
    <td class="py-[4px] pr-sm">${r.vendedor||'—'}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.sugerido||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.cobrado||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums">${mm((r.pagado||0)/1e6)}</td>
    <td class="py-[4px] pr-sm text-right tabular-nums ${r.brechaPC>0?'text-[#C0000C]':''}">${mm(r.brechaPC/1e6)}</td>
    <td class="py-[4px] text-right tabular-nums">${pct(r.cumplimiento_pct)}</td></tr>`).join('');
  return `<table class="w-full text-[14px]"><thead><tr class="text-secondary text-left">
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

// ============================================================================
//  REDISEÑO UX GERENCIAL (23-nov-2026) — diseño aprobado en Claude Design
//  · Pestañas entre subvistas  · «Resumen · dónde actuar» calculado con datos
//  · Índice «En esta vista»    · Secciones numeradas · paleta de la plataforma
//  Se monta sobre el render existente (MutationObserver): no cambia cálculos.
// ============================================================================
const UX_TABS=[['consolidado','Consolidado'],['nivel','Nivel de Servicio'],['tarifa','Tarifa $/Kg'],['margen','Margen de Flete'],['despachos','Detalle por Despacho'],['transportistas','Pagado Transportistas']];
let _uxObs=null, _uxT=null, _uxBusy=false, _uxSeq=0;
function uxCSS(){
  if(document.getElementById('ux-ind-css')) return;
  const st=document.createElement('style'); st.id='ux-ind-css';
  st.textContent=`
.ind2{--ux-pr:#B5000B;--ux-ink:#191C1D;--ux-sec:#5C5F61;--ux-line:#E1E3E4;--ux-low:#F3F4F5;--ux-bg:#F8F9FA;color:var(--ux-ink)}
.ind2 .ux-nav{display:flex;flex-wrap:wrap;gap:4px;background:#fff;border:1px solid var(--ux-line);border-radius:12px;padding:4px;margin-bottom:16px}
.ind2 .ux-nav button{height:40px;padding:0 16px;border:0;border-radius:9px;background:transparent;font:inherit;font-size:14px;font-weight:500;color:var(--ux-ink);cursor:pointer}
.ind2 .ux-nav button:hover{background:var(--ux-low)}
.ind2 .ux-nav button[aria-current]{background:var(--ux-pr);color:#fff;font-weight:700}
.ind2 .ux-res{background:#fff;border:1px solid var(--ux-line);border-top:4px solid var(--ux-pr);border-radius:16px;padding:18px 22px;margin:4px 0 16px;display:flex;flex-direction:column;gap:12px}
.ind2 .ux-res-k{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ux-pr)}
.ind2 .ux-res-t{font-size:19px;font-weight:700;line-height:1.3}
.ind2 .ux-res-s{font-size:14px;color:var(--ux-sec)}
.ind2 .ux-res-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.ind2 .ux-act{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-radius:12px;background:var(--ux-bg);border:1px solid var(--ux-line);text-align:left;font:inherit;color:var(--ux-ink);cursor:pointer;transition:border-color .15s,box-shadow .15s}
.ind2 .ux-act:hover{border-color:rgba(181,0,11,.45);box-shadow:0 2px 8px rgba(0,0,0,.06)}
.ind2 .ux-act b{font-size:15px;line-height:1.3}
.ind2 .ux-act .d{font-size:13px;color:var(--ux-sec);line-height:1.45}
.ind2 .ux-act .cta{font-size:13px;font-weight:700;color:var(--ux-pr)}
.ind2 .ux-idx{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px}
.ind2 .ux-idx .l{font-size:12px;font-weight:700;color:var(--ux-sec);text-transform:uppercase;letter-spacing:.06em;margin-right:4px}
.ind2 .ux-idx a{padding:7px 12px;border-radius:999px;border:1px solid var(--ux-line);background:#fff;color:var(--ux-ink);text-decoration:none;font-size:13px;font-weight:600}
.ind2 .ux-idx a:hover{border-color:var(--ux-pr);color:var(--ux-pr)}
.ind2 .ux-card{background:#fff;border:1px solid var(--ux-line);border-radius:16px;padding:22px 24px;margin-bottom:20px}
.ind2 .ux-card-h{display:flex;flex-direction:column;gap:4px;margin-bottom:16px;padding-right:110px}
.ind2 .ux-card-k{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ux-sec)}
.ind2 .ux-badge{min-width:28px;height:28px;padding:0 7px;box-sizing:border-box;border-radius:8px;background:#FFDAD5;color:var(--ux-pr);font-weight:800;font-size:13px;display:inline-flex;align-items:center;justify-content:center;letter-spacing:0}
.ind2 .ux-card-t{font-size:19px;font-weight:700;color:var(--ux-ink);line-height:1.3}
.ind2 .ux-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:16px}
.ind2 .ux-tile{background:var(--ux-bg);border:1px solid var(--ux-low);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:3px;min-width:0}
.ind2 .ux-tile-k{font-size:13px;font-weight:600;color:var(--ux-sec)}
.ind2 .ux-tile-v{font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:500;line-height:1.2;font-variant-numeric:tabular-nums}
.ind2 .ux-tile-d{font-size:12.5px;color:var(--ux-sec)}
.ind2 .ux-chip{display:inline-flex;align-self:flex-start;gap:4px;align-items:center;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
.ind2 .ux-ok{background:#E3F1E8;color:#1E7A46}.ind2 .ux-warn{background:#FCEBD5;color:#8A4A00}.ind2 .ux-bad{background:#FFDAD5;color:#B5000B}.ind2 .ux-info{background:var(--ux-low);color:var(--ux-sec)}
.ind2 .ux-kpi{display:flex;flex-direction:column;gap:6px;background:#fff;border:1px solid var(--ux-line);border-radius:14px;padding:16px;text-decoration:none;color:var(--ux-ink);transition:border-color .15s,box-shadow .15s}
.ind2 .ux-kpi:hover{border-color:rgba(181,0,11,.45);box-shadow:0 2px 8px rgba(0,0,0,.06)}
.ind2 .ux-kpi-top{display:flex;justify-content:space-between;gap:6px;align-items:center;flex-wrap:wrap}
.ind2 .ux-kpi-k{font-size:12.5px;font-weight:700;color:var(--ux-sec);text-transform:uppercase;letter-spacing:.04em}
.ind2 .ux-kpi-v{font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:500;line-height:1.1;font-variant-numeric:tabular-nums}
.ind2 .ux-kpi-s{font-size:12.5px;color:var(--ux-sec)}
.ind2 .ux-kpi-d{font-size:13px;font-weight:600;border-top:1px solid var(--ux-low);padding-top:8px}
.ind2 table td.tabular-nums,.ind2 .tabular-nums{font-variant-numeric:tabular-nums}
`;
  document.head.appendChild(st);
}
function uxInit(container){
  uxCSS(); container.classList.add('ind2');
  if(_uxObs) _uxObs.disconnect();
  _uxObs=new MutationObserver(()=>{ if(_uxBusy) return; clearTimeout(_uxT); _uxT=setTimeout(()=>uxDecorate(container),140); });
  _uxObs.observe(container,{childList:true,subtree:true});
  if(!container.__uxClick){ container.__uxClick=true;
    container.addEventListener('click',ev=>{
      const t=ev.target.closest('[data-uxtab]'); if(t){ const k=t.getAttribute('data-uxtab'); if(k!==_view) homeGo('indicadores',k); return; }
      const g=ev.target.closest('[data-uxgo]'); if(g){ ev.preventDefault(); uxGo(g.getAttribute('data-uxgo')); }
    });
  }
}
function uxSecFind(txt){
  const q=String(txt).toLowerCase();
  return [..._container.querySelectorAll('section[data-card]')].find(s=>(s.querySelector('.ux-card-k')||s).textContent.toLowerCase().indexOf(q)>=0);
}
function uxGo(go){
  if(!go) return;
  if(go.indexOf('#')===0){ const el=document.getElementById(go.slice(1)); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); return; }
  if(go.indexOf('sec:')===0){ const el=uxSecFind(go.slice(4)); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); return; }
  const setSel=(id,v)=>{ const e=document.getElementById(id); if(e){ if(e.type==='checkbox') e.checked=v; else e.value=v; } };
  if(go==='desp_perd'){ _desp.perd=true; _desp.page=0; setSel('desp_perd',true); despPaint(); }
  else if(go==='desp_sincobro'){ _desp.orden='cob'; _desp.page=0; setSel('desp_ord','cob'); despPaint(); }
  else if(go==='desp_express'){ _desp.neg='EXPRESS'; _desp.page=0; setSel('desp_neg','EXPRESS'); despPaint(); }
  else if(go==='tr_cpv'){ _tr.orden='cpv'; setSel('tr_ord','cpv'); trPaint(); }
  else if(go==='tr_ppv'){ _tr.orden='ppv'; setSel('tr_ord','ppv'); trPaint(); }
  const tb=_container.querySelector('#desp_body,#tr_body'); if(tb && /^(desp|tr)_/.test(go)) setTimeout(()=>tb.scrollIntoView({behavior:'smooth',block:'start'}),60);
}
function uxDecorate(container){
  if(!container.isConnected){ if(_uxObs) _uxObs.disconnect(); return; }
  const wrap=container.firstElementChild;
  if(!wrap || !wrap.classList.contains('w-full')) return;   // cargando / error
  _uxBusy=true;
  try{
    let nav=wrap.querySelector(':scope > .ux-nav');
    if(!nav){
      nav=document.createElement('nav'); nav.className='ux-nav'; nav.setAttribute('aria-label','Subvistas de indicadores');
      nav.innerHTML=UX_TABS.map(([k,t])=>`<button type="button" data-uxtab="${k}" ${k===_view?'aria-current="page"':''}>${t}</button>`).join('');
      wrap.insertBefore(nav,wrap.firstElementChild);
    }
    const title=nav.nextElementSibling; if(!title) return;
    // numerar secciones
    const secs=[...wrap.querySelectorAll('section[data-card]')]; let n=0;
    secs.forEach(sec=>{
      if(!sec.id) sec.id='ux-sec-'+(++_uxSeq);
      const k=sec.querySelector('.ux-card-k'); if(!k) return; n++;
      if(k.querySelector('.ux-badge')) return;
      const raw=k.textContent.trim(), m=/^([\d.]+)\s*·\s*(.*)$/.exec(raw);
      k.innerHTML=`<span class="ux-badge">${m?m[1]:n}</span><span class="ux-sec-t">${esc(m?m[2]:raw)}</span>`;
    });
    const idx=secs.map(sec=>{ const t=sec.querySelector('.ux-sec-t'); return t?{id:sec.id,t:t.textContent.replace(/\s+—\s+.*$/,'').trim()}:null; }).filter(Boolean);
    let R0={t:'',s:'',acc:[]}; try{ R0=uxAcciones()||R0; }catch(e){ console.warn('[ux] acciones',e); }
    let top=wrap.querySelector(':scope > .ux-top');
    if(!top){ top=document.createElement('div'); top.className='ux-top'; }
    if(top.previousElementSibling!==title) title.after(top);
    const sig=JSON.stringify([R0,idx]);
    if(top.dataset.sig!==sig){
      top.dataset.sig=sig;
      top.innerHTML=uxResumenHTML(R0)+(idx.length>2?`<nav class="ux-idx" aria-label="En esta vista"><span class="l">En esta vista</span>${idx.map(i=>`<a href="#${i.id}" data-uxgo="#${i.id}">${esc(i.t)}</a>`).join('')}</nav>`:'');
    }
  } finally { setTimeout(()=>{ _uxBusy=false; },0); }
}
function uxResumenHTML(R0){
  if(!R0 || (!R0.t && !(R0.acc||[]).length)) return '';
  const lab={bad:'✕ Actuar ahora',warn:'! Vigilar',ok:'✓ Bien',info:'• Dato'};
  const acc=(R0.acc||[]).slice().sort((a,b)=>({bad:0,warn:1,info:2,ok:3}[a.sev])-({bad:0,warn:1,info:2,ok:3}[b.sev])).slice(0,3);
  return `<section class="ux-res" aria-label="Resumen y dónde actuar">
    <div><div class="ux-res-k">Resumen · dónde actuar</div><div class="ux-res-t">${R0.t||''}</div>${R0.s?`<div class="ux-res-s">${R0.s}</div>`:''}</div>
    ${acc.length?`<div class="ux-res-g">${acc.map(a=>`<button type="button" class="ux-act" data-uxgo="${esc(a.go||'')}"><span class="ux-chip ux-${a.sev}">${lab[a.sev]}</span><b>${a.t}</b><span class="d">${a.d||''}</span>${a.go?`<span class="cta">${a.cta||'Ver detalle'} →</span>`:''}</button>`).join('')}</div>`:''}
  </section>`;
}
// --- utilidades para acciones ---
function uxLastClosed(rows){ const cur=mesEnCurso(); const ms=[...new Set((rows||[]).map(r=>r.mes_label))].filter(m=>m&&m<cur).sort(); return ms[ms.length-1]||null; }
function uxPrevMes(rows,M){ const ms=[...new Set((rows||[]).map(r=>r.mes_label))].filter(m=>m&&m<M).sort(); return ms[ms.length-1]||null; }
function uxSevMeta(v,meta,tol){ return v>=meta?'ok':(v>=meta-tol?'warn':'bad'); }
function uxAcciones(){
  if(_view==='nivel') return uxAccNivel();
  if(_view==='tarifa') return uxAccTarifa();
  if(_view==='margen') return uxAccMargen();
  if(_view==='despachos') return uxAccDesp();
  if(_view==='transportistas') return uxAccTr();
  return uxAccConsol();
}
function uxAccConsol(){
  const G=_cacheGrp, D=_cacheGen; if(!G||!D) return null;
  const gs=_cenGen==='TODOS'?gruposGen():[_cenGen];
  const M=uxLastClosed(G.ns); if(!M) return null;
  const at=(rows,f,g)=>{ const r=(rows||[]).find(x=>x.grupo===g&&x.mes_label===M); return r?r[f]:null; };
  const acc=[];
  const worst=(rows,f,asc)=>gs.map(g=>[g,at(rows,f,g)]).filter(x=>x[1]!=null).sort((a,b)=>asc?a[1]-b[1]:b[1]-a[1])[0];
  const wo=worst(G.ns,'otif_pct',true); if(wo&&wo[1]<META.otif) acc.push({sev:uxSevMeta(wo[1],META.otif,5),t:'OTIF bajo meta en '+nice(wo[0]),d:pct(wo[1])+' en '+mesCorto(M)+' · meta '+META.otif+'%.',go:'sec:Nivel de Servicio',cta:'Ver nivel de servicio'});
  const wm=worst(G.mar,'margen',true); if(wm&&wm[1]<0) acc.push({sev:'bad',t:'Margen negativo en '+nice(wm[0]),d:'Pagado supera a cobrado en '+mm(Math.abs(wm[1])/1e6)+' en '+mesCorto(M)+'.',go:'sec:Margen',cta:'Ver margen'});
  const wc=worst(G.con,'consol_pct',true); if(wc&&wc[1]<META.consol) acc.push({sev:uxSevMeta(wc[1],META.consol,5),t:'Consolidación baja en '+nice(wc[0]),d:'Camiones al '+pct(wc[1])+' de capacidad en '+mesCorto(M)+' · meta '+META.consol+'%.',go:'sec:Operación',cta:'Ver operación'});
  const sc=gs.map(g=>{ const r=(G.scm||[]).find(x=>x.grupo===g&&x.mes_label===M); return [g,r?(r.monto_sugerido!=null?r.monto_sugerido:r.monto):null]; }).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1])[0];
  if(sc) acc.push({sev:'warn',t:'Flete no cobrado en '+nice(sc[0]),d:mm(sc[1]/1e6)+' sin cobrar al cliente en '+mesCorto(M)+'.',go:'sec:no cobrado',cta:'Ver no cobrado'});
  const sh=D.shes||{}; if(_cenGen==='TODOS' && (sh.docs_sin_hes||0)>0) acc.push({sev:'warn',t:'Troncal: '+nf0.format(sh.docs_sin_hes)+' documentos sin HES',d:(sh.ton_sin_hes!=null?nf1.format(sh.ton_sin_hes)+' t ':'')+'sin costo final reconocido.',go:'sec:Troncal',cta:'Ver troncal'});
  const ebc=sum((G.ebm||[]).filter(r=>gs.indexOf(r.grupo)>=0).map(r=>r.pagado));
  if(ebc>0) acc.push({sev:'info',t:'EbemaClick: '+mm(ebc/1e6)+' de flete pagado',d:'Costo de la operación E-Click en el año (incluye sobrecosto 400141).',go:'sec:EbemaClick',cta:'Ver impacto'});
  // resumen: indicadores con meta del último mes cerrado (red o filtro)
  const n=(D.ns||[]).find(r=>r.mes_label===M)||{}, m=(D.mar||[]).find(r=>r.mes_label===M)||{}, k=(D.con||[]).find(r=>r.mes_label===M)||{};
  const ch=[[n.otif_pct,META.otif],[n.fillrate_pct,META.fill],[m.cobertura_pct,META.cobertura],[k.consol_pct,META.consol]].filter(x=>x[0]!=null);
  const ok=ch.filter(x=>x[0]>=x[1]).length;
  const bajo=[['OTIF',n.otif_pct,META.otif],['Fill Rate',n.fillrate_pct,META.fill],['cobertura',m.cobertura_pct,META.cobertura],['consolidación',k.consol_pct,META.consol]].filter(x=>x[1]!=null&&x[1]<x[2]).map(x=>x[0]+' ('+pct(x[1])+')');
  return {t:ok+' de '+ch.length+' indicadores con meta cumplidos en '+mesCorto(M)+(_cenGen!=='TODOS'?' · '+nice(_cenGen):''),
    s:bajo.length?'Bajo meta: '+bajo.join(', ')+'.':'Todos los indicadores con meta están cumplidos.',acc};
}
function uxAccNivel(){
  const d=_cacheNivel, g=_grupoN; if(!d||!g) return null;
  const acc=[]; const s4=last4(d.sem,g), w=s4[s4.length-1]||{}, w0=s4[0]||{};
  if(w.otif_pct!=null) acc.push({sev:uxSevMeta(w.otif_pct,META.otif,5),t:'OTIF semanal '+pct(w.otif_pct),d:semLbl(w.semana)+' · '+(w0.otif_pct!=null?((w.otif_pct-w0.otif_pct>=0?'▲ +':'▼ ')+nf1.format(w.otif_pct-w0.otif_pct)+' pp en 4 semanas'):'')+' · meta '+META.otif+'%.',go:'sec:Semana Móvil',cta:'Ver semana móvil'});
  const co=(d.co4||[]).filter(r=>r.grupo===g && r.otif_pct!=null && (r.lineas==null||r.lineas>=20)).sort((a,b)=>a.otif_pct-b.otif_pct).slice(0,3);
  if(co.length && co[0].otif_pct<META.otif) acc.push({sev:co[0].otif_pct<META.otif-10?'bad':'warn',t:'Comunas críticas: '+co.map(r=>nice(r.comuna)).join(', '),d:'OTIF '+co.map(r=>pct(r.otif_pct)).join(' · ')+' en las últimas 4 semanas.',go:'sec:Ranking de Comunas',cta:'Ver ranking'});
  const spg=(d.spw||[]).filter(r=>r.grupo===g), sems=last4Sem(spg);
  const wa=t=>{ const rr=spg.filter(r=>r.tipo===t&&sems.indexOf(r.semana)>=0); return wavg(rr.map(r=>[r.otif_pct,r.lineas])); };
  const ps=wa('Planificado'), ss=wa('Spot');
  if(ps!=null&&ss!=null&&ps-ss>3) acc.push({sev:ps-ss>8?'bad':'warn',t:'Spot rinde '+nf1.format(ps-ss)+' pp bajo Planificado',d:'Spot '+pct(ss)+' vs Planificado '+pct(ps)+' en 4 semanas.',go:'sec:Spot',cta:'Ver Spot y Planificado'});
  const tp=(d.tp||[]).filter(r=>r.grupo===g), st=tp.find(r=>r.tipo==='STOCK')||{}, cz=tp.find(r=>r.tipo==='CALZADA')||{};
  if(st.otif_pct!=null&&cz.otif_pct!=null&&st.otif_pct-cz.otif_pct>5) acc.push({sev:'warn',t:'Calzada '+nf1.format(st.otif_pct-cz.otif_pct)+' pp bajo Stock',d:'Calzada '+pct(cz.otif_pct)+' ('+(cz.dias_prom!=null?nf1.format(cz.dias_prom)+' d':'–')+') vs Stock '+pct(st.otif_pct)+'.',go:'sec:Stock',cta:'Ver tipo de venta'});
  return {t:'Nivel de servicio · '+nice(g),s:w.otif_pct!=null?'Última semana cerrada: OTIF '+pct(w.otif_pct)+' · Fill Rate '+pct(w.fillrate_pct)+'.':'',acc};
}
function uxAccTarifa(){
  const d=_cacheTar, g=_grupoT; if(!d||!g) return null;
  const acc=[]; const seg=r=>(r.segmento==null||r.segmento===_segT);
  const tm=(d.tm||[]).filter(r=>r.grupo===g&&seg(r)), M=uxLastClosed(tm), P=M?uxPrevMes(tm,M):null;
  const t1=tm.find(r=>r.mes_label===M)||{}, t0=tm.find(r=>r.mes_label===P)||{};
  if(t1.tarifa_kg!=null&&t0.tarifa_kg!=null){ const dd=t1.tarifa_kg-t0.tarifa_kg;
    acc.push({sev:dd>0.5?'warn':'ok',t:'Tarifa '+money(t1.tarifa_kg)+'/kg en '+mesCorto(M),d:(dd>0?'▲ +':'▼ ')+money1(dd)+' vs '+mesCorto(P)+(t1.toneladas!=null?' · '+nf0.format(t1.toneladas)+' t':'')+'.',go:'sec:Evolutivo',cta:'Ver evolutivo'}); }
  const cm=(d.consm||[]).filter(r=>r.grupo===g), Mc=uxLastClosed(cm), c1=cm.find(r=>r.mes_label===Mc)||{};
  if(c1.consol_pct!=null&&c1.consol_pct<META.consol) acc.push({sev:uxSevMeta(c1.consol_pct,META.consol,5),t:'Consolidación '+pct(c1.consol_pct),d:'Camiones bajo la meta de '+META.consol+'% en '+mesCorto(Mc)+': el espacio libre encarece el $/kg.',go:'sec:Consolidación',cta:'Ver consolidación'});
  const cc=(d.com||[]).filter(r=>r.grupo===g&&r.tarifa_kg!=null).sort((a,b)=>b.tarifa_kg-a.tarifa_kg).slice(0,2);
  if(cc.length) acc.push({sev:'warn',t:'Comunas más caras: '+cc.map(r=>nice(r.comuna)).join(' y '),d:cc.map(r=>money(r.tarifa_kg)+'/kg').join(' · ')+(t1.tarifa_kg!=null?' vs '+money(t1.tarifa_kg)+' del centro.':'.'),go:'sec:Comunas',cta:'Ver comunas'});
  const eb=(d.ebc||[]).filter(r=>r.grupo===g), ep=sum(eb.map(r=>r.pagado));
  if(ep>0) acc.push({sev:'info',t:'EbemaClick: '+mm(ep/1e6)+' pagados',d:nf0.format(sum(eb.map(r=>r.docs)))+' documentos en el período.',go:'sec:EbemaClick',cta:'Ver impacto'});
  return {t:'Pesos por kilo · '+nice(g),s:'Último mes cerrado: '+(M?mesCorto(M):'–')+'. Solo última milla, salvo troncal.',acc};
}
function uxAccMargen(){
  const d=_cacheMar2, g=_grupoM; if(!d||!g) return null;
  const acc=[]; const mg=(d.mg||[]).filter(r=>r.grupo===g&&r.segmento===_segM), M=uxLastClosed(mg), m1=mg.find(r=>r.mes_label===M)||{};
  if(m1.margen!=null) acc.push({sev:m1.margen<0?'bad':'ok',t:'Margen '+mm(m1.margen/1e6)+' en '+mesCorto(M),d:m1.margen<0?'Pagado supera a cobrado: revisar tarifas cobradas.':'Cobrado sobre pagado.',go:'sec:Semana Móvil',cta:'Ver margen'});
  if(m1.cobertura_pct!=null&&m1.cobertura_pct<META.cobertura) acc.push({sev:uxSevMeta(m1.cobertura_pct,META.cobertura,10),t:'Cobertura '+pct(m1.cobertura_pct),d:'Cobrado / pagado bajo la meta de '+META.cobertura+'% en '+mesCorto(M)+'.',go:'sec:Cobertura',cta:'Ver pagado vs cobrado'});
  const sc=(d.sc||[]).filter(r=>r.grupo===g&&r.segmento===_segM), Ms=uxLastClosed(sc), s1=sc.find(r=>r.mes_label===Ms)||{};
  if((s1.monto_sugerido||0)>0) acc.push({sev:'warn',t:'No cobrado '+mm(s1.monto_sugerido/1e6),d:nf0.format(s1.entregas||0)+' entregas con flete cobrado en $0 en '+mesCorto(Ms)+'.',go:'sec:no cobrado',cta:'Ver no cobrado'});
  const vn=(d.vn||[]).filter(r=>r.grupo===g&&r.segmento===_segM).map(r=>({v:r.vendedor,b:(r.pagado||0)-(r.cobrado||0)})).sort((a,b)=>b.b-a.b)[0];
  if(vn&&vn.b>0) acc.push({sev:'warn',t:'Mayor brecha: '+esc(vn.v||'—'),d:'Pagado supera a cobrado en '+mm(vn.b/1e6)+' (período).',go:'sec:Ranking Vendedor',cta:'Ver ranking'});
  return {t:'Margen de flete · '+nice(g),s:'Último mes cerrado: '+(M?mesCorto(M):'–')+'. Excluye EbemaClick del ranking.',acc};
}
function uxAccDesp(){
  if(!_desp.grupo||!_despRows[_desp.grupo]) return null;
  const rows=despFiltra(); if(!rows.length) return {t:'Sin despachos con esos filtros',s:'',acc:[]};
  const perd=rows.filter(r=>(+r.cobrado||0)<(+r.pagado||0)), sinc=rows.filter(r=>!(+r.cobrado)&&(+r.pagado||0)>0), ex=rows.filter(r=>r.express);
  const T=finAgg(rows), acc=[];
  if(perd.length) acc.push({sev:'bad',t:nf0.format(perd.length)+' despachos con pérdida',d:'Resultado '+peso(sum(perd.map(r=>(+r.cobrado||0)-(+r.pagado||0))))+' (cobrado < pagado).',go:'desp_perd',cta:'Filtrar con pérdida'});
  if(sinc.length) acc.push({sev:'warn',t:nf0.format(sinc.length)+' despachos sin cobro',d:'Flete pagado '+peso(sum(sinc.map(r=>+r.pagado||0)))+' sin tarifa cobrada al cliente.',go:'desp_sincobro',cta:'Ordenar por cobertura'});
  if(ex.length){ const E=finAgg(ex); acc.push({sev:(E.pag&&E.cob/E.pag<1)?'warn':'info',t:nf0.format(ex.length)+' despachos Express',d:'Cobertura '+pct(E.pag?E.cob/E.pag*100:null)+' · pagado '+mm(E.pag/1e6)+'.',go:'desp_express',cta:'Ver Express'}); }
  return {t:nf0.format(rows.length)+' despachos · resultado '+mm((T.cob-T.pag)/1e6),s:'Cobertura '+pct(T.pag?T.cob/T.pag*100:null)+' · '+nice(_desp.grupo)+'. Usa las tarjetas para filtrar directo.',acc};
}
function uxAccTr(){
  if(!_trRows[_tr.grupo]) return null;
  const rows=trBase(); if(!rows.length) return {t:'Sin viajes con esos filtros',s:'',acc:[]};
  const T=trAgg(rows), L=trPorTransp(rows).slice(), acc=[];
  const top=L.filter(t=>t.viajes>=10).sort((a,b)=>(b.cpv||0)-(a.cpv||0))[0];
  if(top) acc.push({sev:'warn',t:esc(top.nombre)+': '+peso(top.cpv)+' por viaje',d:'Mayor costo por viaje con '+nf1.format(top.ppv||0)+' puntos/viaje (promedio '+peso(T.cpv)+').',go:'tr_cpv',cta:'Ordenar por $/viaje'});
  if(T.viajes) acc.push({sev:T.uno/T.viajes>0.4?'warn':'info',t:pct(T.uno/T.viajes*100)+' de los viajes con 1 punto',d:'Puntos por viaje promedio: '+nf1.format(T.ppv||0)+'.',go:'tr_ppv',cta:'Ordenar por puntos'});
  const s3=L.slice().sort((a,b)=>b.pag-a.pag).slice(0,3), p3=T.pag?sum(s3.map(t=>t.pag))/T.pag*100:0;
  if(s3.length) acc.push({sev:p3>70?'warn':'info',t:'3 agentes concentran el '+pct(p3)+' del pago',d:s3.map(t=>esc(t.nombre)).join(', ')+'.',go:'#tr_body',cta:'Ver detalle'});
  return {t:mm(T.pag/1e6)+' pagados a '+nf0.format(L.length)+' agentes de servicio',s:nf0.format(T.viajes)+' viajes · '+peso(T.cpv)+' por viaje · $/kg '+(T.ckg!=null?nf1.format(T.ckg):'–')+'.',acc};
}
// --- Nivel: Envío Express vs Planificado (flete) ---
async function nivelExpress(grupo){
  const el=document.getElementById('n_expr'); if(!el) return;
  try{
    if(!_finRows) _finRows=await nsFetchAll(()=>supabase.from('v_ind_fin_flete').select('*'));
    if(grupo!==_grupoN) return;
    const y=String(new Date().getFullYear());
    const rows=_finRows.filter(r=>r.grupo===grupo && String(r.mes_label||'').slice(0,4)===y);
    const ex=rows.filter(r=>r.express), no=rows.filter(r=>!r.express);
    const A=a=>({ent:sum(a.map(r=>r.entregas)),pag:sum(a.map(r=>r.pagado)),cob:sum(a.map(r=>r.cobrado)),kg:sum(a.map(r=>r.kg))});
    const E=A(ex), N=A(no), tot=E.ent+N.ent;
    const meses=[...new Set(rows.map(r=>r.mes_label))].sort();
    if(!ex.length){ el.innerHTML=`<div class="text-secondary text-[14px]">Sin despachos Express en ${y} para ${nice(grupo)}.</div>`; return; }
    el.innerHTML=`<div class="ux-tiles">`+
      tile('Entregas Express',nf0.format(E.ent),(tot?nf1.format(E.ent/tot*100):'0')+'% del total · '+y)+
      tile('Entregas planificadas',nf0.format(N.ent),'despacho normal')+
      tileS('Cobertura Express',pct(E.pag?E.cob/E.pag*100:null),'normal '+pct(N.pag?N.cob/N.pag*100:null),semaforo(E.pag?E.cob/E.pag*100:null,META.cobertura,10))+
      tile('$/kg Express',E.kg?money(E.pag/E.kg):'–','normal '+(N.kg?money(N.pag/N.kg):'–'))+`</div>`+
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-md"><div>`+legend([{n:'Entregas Express',c:R.red}])+`<div id="n_expr_ch"></div></div>`+
      `<div>`+legend([{n:'Entregas planificadas',c:R.grey}])+`<div id="n_expr_ch2"></div></div></div>`+
      `<div class="text-[13px] text-secondary mt-sm">Fuente: flete (columna Express del DT). El OTIF Express requiere la marca Express en el reporte OTIF.</div>`;
    const ve=meses.map(m=>sum(ex.filter(r=>r.mes_label===m).map(r=>r.entregas))), vn=meses.map(m=>sum(no.filter(r=>r.mes_label===m).map(r=>r.entregas)));
    barChart('n_expr_ch',ve,meses.map(mesCorto),0,niceMax(ve),R.red,'',meses.indexOf(mesEnCurso())>=0?meses.length-1:null,v=>Math.round(v));
    barChart('n_expr_ch2',vn,meses.map(mesCorto),0,niceMax(vn),R.grey,'',meses.indexOf(mesEnCurso())>=0?meses.length-1:null,v=>Math.round(v));
  }catch(e){ el.innerHTML=`<div class="text-secondary text-[14px]">No se pudo cargar el flete Express.</div>`; console.warn(e); }
}
