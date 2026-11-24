import{supabase as b}from"./supabase-client.js?v=fd17fd7d20";import{filtrarPorCentro as N,getRol as _,rolClase as h}from"./permisos.js?v=a8b193e9fb";import{showAlert as f,escapeHtml as A}from"./utils.js";const n={ink:"#191c1d",ink2:"#5c5f61",line:"#e1e3e4",soft:"#f8f9fa",red:"#b5000b",amber:"#ca8a04",green:"#15803d",blue:"#1d4ed8"},x={PLANNER_ABASTECIMIENTO:"Planner Abastecimiento",PLANNER_OPERACIONES:"Planner Operaciones",OWNER:"Owner"},w={PLANNER_ABASTECIMIENTO:"PLANNER_ABASTECIMIENTO",JEFE_ABASTECIMIENTO:"PLANNER_ABASTECIMIENTO",PLANNER_OPERACIONES:"PLANNER_OPERACIONES",JEFE_OPERACIONES:"PLANNER_OPERACIONES"},y={abierta:"Abiertas",cerrada:"Cerradas",resuelta_auto:"Resueltas automáticas"},t={estado:"abierta",resp:null,control:"all",q:"",rows:[],cat:[],ult:null,page:0},$=50;let u=null;const l=e=>A(String(e??"")),S=(e,s=1)=>e==null||e===""||isNaN(e)?"—":Number(e).toLocaleString("es-CL",{minimumFractionDigits:s,maximumFractionDigits:s}),g=e=>{if(!e)return"—";const s=new Date(e);return isNaN(s)?"—":s.toLocaleString("es-CL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})},E=()=>_()||"",L=e=>["OWNER","ADMIN"].includes(h())||E()===e.responsable||h()===e.responsable||w[E()]===e.responsable,R=()=>["OWNER","ADMIN","PLANNER_ABASTECIMIENTO"].includes(h());async function z(e){let o=[];for(let a=0;a<50;a++){const{data:r,error:i}=await e().range(a*1e3,a*1e3+1e3-1);if(i){f("Error al cargar diferencias: "+i.message,"error");break}if(o=o.concat(r||[]),!r||r.length<1e3)break}return o}async function D(e){u=e,t.resp===null&&(t.resp=w[E()]||"all"),u.innerHTML=`${C()}<div class="cdf"><div class="cdf-empty">Cargando diferencias…</div></div>`,await m(),p()}async function m(){const[e,s]=await Promise.all([b.from("abast_control_catalogo").select("*").order("orden"),z(()=>b.from("abast_control_diferencia").select("*").eq("estado",t.estado).order("detectado_en",{ascending:!1}))]);t.cat=e.data||[],t.rows=N(s,o=>o.centro||"").concat(s.filter(o=>!o.centro)),t.rows=Array.from(new Map(t.rows.map(o=>[o.id,o])).values()),t.ult=s.reduce((o,a)=>!o||a.actualizado_en>o?a.actualizado_en:o,null)}function k(){const e=t.q.trim().toLowerCase();return t.rows.filter(s=>(t.resp==="all"||s.responsable===t.resp)&&(t.control==="all"||s.control===t.control)&&(!e||`${s.centro} ${s.documento} ${s.material} ${s.detalle}`.toLowerCase().includes(e)))}function p(){const e=new Map(t.cat.map(c=>[c.control,c])),s=t.rows.filter(c=>t.resp==="all"||c.responsable===t.resp),o={};s.forEach(c=>{o[c.control]=(o[c.control]||0)+1});const a={};t.rows.forEach(c=>{a[c.responsable]=(a[c.responsable]||0)+1});const r=k(),i=Math.max(1,Math.ceil(r.length/$));t.page=Math.min(t.page,i-1);const d=r.slice(t.page*$,(t.page+1)*$),v=s.filter(c=>c.efecto==="Bloquea líneas").length;u.querySelector(".cdf").innerHTML=`
    <div class="cdf-card">
      <div class="cdf-head">
        <div><h3>GESTIÓN TRONCALES – CONTROL DE DIFERENCIAS</h3>
          <p>Diferencias entre SAP, el Plan de Carga, lo programado y lo despachado. Cada una tiene un responsable y se cierra con motivo antes del corte.</p></div>
        <div class="cdf-actions"><span class="cdf-muted">Última detección: ${g(t.ult)}</span>
          <button class="cdf-btn ghost" data-act="csv"><span class="material-symbols-outlined">download</span>CSV</button>
          <button class="cdf-btn" data-act="refresh"><span class="material-symbols-outlined">refresh</span>Actualizar ahora</button></div>
      </div>
      <div class="cdf-kpis">
        ${["abierta","cerrada","resuelta_auto"].map(c=>`<button class="cdf-seg ${t.estado===c?"on":""}" data-estado="${c}">${y[c]}</button>`).join("")}
        <span class="cdf-sep"></span>
        <button class="cdf-chip ${t.resp==="all"?"on":""}" data-resp="all">Todos <b>${t.rows.length}</b></button>
        ${Object.keys(x).map(c=>`<button class="cdf-chip ${t.resp===c?"on":""}" data-resp="${c}">${x[c]} <b>${a[c]||0}</b></button>`).join("")}
        ${t.estado==="abierta"&&v?`<span class="cdf-tag red">${v} bloquean líneas del plan</span>`:""}
      </div>
      <div class="cdf-ctls">
        <button class="cdf-ctl ${t.control==="all"?"on":""}" data-ctl="all">Todos los controles</button>
        ${t.cat.filter(c=>o[c.control]).map(c=>`<button class="cdf-ctl ${t.control===c.control?"on":""}" data-ctl="${c.control}" title="${l(c.regla)}">${c.control} ${l(c.nombre)} <b>${o[c.control]}</b></button>`).join("")}
      </div>
      <label class="cdf-search"><span class="material-symbols-outlined">search</span>
        <input id="cdf-q" value="${l(t.q)}" placeholder="Buscar centro, documento, material o detalle…" autocomplete="off"/></label>
      ${t.control!=="all"&&e.get(t.control)?`<p class="cdf-note"><b>${t.control} · ${l(e.get(t.control).nombre)}:</b> ${l(e.get(t.control).regla)}. <b>Acción:</b> ${l(e.get(t.control).accion)}.</p>`:""}
      <div class="cdf-scroll"><table class="cdf-tbl">
        <thead><tr><th>Control</th><th>Centro</th><th>Documento</th><th>Material</th><th>Detalle</th><th class="r">Valor</th><th>Responsable</th><th>Efecto</th><th>Detectado</th><th>${t.estado==="abierta"?"Acción":"Cierre"}</th></tr></thead>
        <tbody>${d.length===0?`<tr><td colspan="10" class="cdf-empty ok">${t.estado==="abierta"?"Sin diferencias abiertas para este filtro.":"Sin registros."}</td></tr>`:d.map(c=>O(c,e)).join("")}</tbody>
      </table></div>
      ${i>1?`<div class="cdf-pag"><button class="cdf-btn ghost" data-pg="-1" ${t.page===0?"disabled":""}>Anterior</button><span>${t.page+1} / ${i} · ${r.length} filas</span><button class="cdf-btn ghost" data-pg="1" ${t.page>=i-1?"disabled":""}>Siguiente</button></div>`:`<p class="cdf-muted">${r.length} filas</p>`}
    </div>`,q()}function O(e,s){const o=s.get(e.control)||{},a=t.estado==="abierta"?`${e.control==="C02"&&R()?`<button class="cdf-mini" data-subir="${l(String(e.clave).split("|")[0])}" title="Subir el exceso al plan (queda sujeto al llenado del camión)">Subir al plan</button>`:""}
       ${L(e)?`<button class="cdf-mini ghost" data-cerrar="${e.id}">Cerrar</button>`:'<span class="cdf-muted">—</span>'}`:`<span class="cdf-muted">${l(e.motivo||(e.estado==="resuelta_auto"?"Dejó de detectarse":""))}${e.cerrado_por?" · "+l(e.cerrado_por):""} · ${g(e.cerrado_en)}</span>`;return`<tr>
    <td title="${l(o.regla||"")}"><b>${e.control}</b> <span class="cdf-muted">${l(o.nombre||"")}</span></td>
    <td>${l(e.centro||"—")}</td><td class="mono">${l(e.documento||"—")}</td><td class="mono">${l(e.material||"—")}</td>
    <td class="wrap">${l(e.detalle||"")}</td><td class="r">${S(e.valor,e.control==="C01"?1:e.control==="C13"?2:1)}</td>
    <td>${l(x[e.responsable]||e.responsable)}</td>
    <td>${e.efecto==="Bloquea líneas"?'<span class="cdf-tag red">Bloquea</span>':'<span class="cdf-tag">Aviso</span>'}</td>
    <td>${g(e.detectado_en)}</td><td class="nowrap">${a}</td></tr>`}function q(){const e=a=>u.querySelectorAll(a);e("[data-estado]").forEach(a=>a.addEventListener("click",async()=>{t.estado=a.dataset.estado,t.page=0,await m(),p()})),e("[data-resp]").forEach(a=>a.addEventListener("click",()=>{t.resp=a.dataset.resp,t.control="all",t.page=0,p()})),e("[data-ctl]").forEach(a=>a.addEventListener("click",()=>{t.control=a.dataset.ctl,t.page=0,p()})),e("[data-pg]").forEach(a=>a.addEventListener("click",()=>{t.page+=Number(a.dataset.pg),p()}));const s=u.querySelector("#cdf-q");let o;s&&s.addEventListener("input",a=>{clearTimeout(o),o=setTimeout(()=>{t.q=a.target.value,t.page=0,p();const r=u.querySelector("#cdf-q");r&&(r.focus(),r.setSelectionRange(r.value.length,r.value.length))},200)}),e('[data-act="refresh"]').forEach(a=>a.addEventListener("click",async()=>{a.disabled=!0,a.textContent="Actualizando…";const{error:r}=await b.rpc("fn_abast_controles_actualizar");r&&f("No se pudo actualizar: "+r.message,"error"),await m(),p()})),e('[data-act="csv"]').forEach(a=>a.addEventListener("click",P)),e("[data-cerrar]").forEach(a=>a.addEventListener("click",()=>I(t.rows.find(r=>String(r.id)===a.dataset.cerrar)))),e("[data-subir]").forEach(a=>a.addEventListener("click",async()=>{a.disabled=!0;const{error:r}=await b.rpc("fn_abast_subir_exceso_entrega",{p_entrega:a.dataset.subir});if(r){f(r.message,"error"),a.disabled=!1;return}f("Exceso subido al plan: entra al llenado del camión (si no cabe, va al excedente).","success"),await m(),p()}))}function I(e){if(!e)return;const s=t.cat.find(r=>r.control===e.control)||{},o=document.createElement("div");o.className="cdf-ov",o.innerHTML=`${C()}<div class="cdf-modal">
    <div class="cdf-mhead"><h3>Cerrar ${e.control} · ${l(s.nombre||"")}</h3><button class="cdf-x" data-x><span class="material-symbols-outlined">close</span></button></div>
    <p class="cdf-sub">${l(e.detalle||"")}</p>
    <p class="cdf-note"><b>Acción sugerida:</b> ${l(s.accion||"")}</p>
    <textarea id="cdf-motivo" class="cdf-in" rows="3" placeholder="Motivo del cierre (obligatorio)"></textarea>
    <div class="cdf-mfoot"><button class="cdf-btn ghost" data-x>Cancelar</button><button class="cdf-btn" data-ok>Cerrar diferencia</button></div></div>`,document.body.appendChild(o);const a=()=>o.remove();o.querySelectorAll("[data-x]").forEach(r=>r.addEventListener("click",a)),o.addEventListener("click",r=>{r.target===o&&a()}),o.querySelector("[data-ok]").addEventListener("click",async()=>{const r=o.querySelector("#cdf-motivo").value.trim();if(!r){f("El motivo es obligatorio.","error");return}const{error:i}=await b.rpc("fn_abast_cerrar_diferencia",{p_id:e.id,p_motivo:r});if(i){f(i.message,"error");return}a(),await m(),p()}),o.querySelector("#cdf-motivo").focus()}function P(){const e=new Map(t.cat.map(d=>[d.control,d])),s=["Control","Nombre","Centro","Documento","Material","Detalle","Valor","Responsable","Efecto","Estado","Detectado","Motivo","Cerrado por","Cerrado en"],o=d=>`"${String(d??"").replace(/"/g,'""')}"`,a=[s.join(";")].concat(k().map(d=>[d.control,(e.get(d.control)||{}).nombre,d.centro,d.documento,d.material,d.detalle,d.valor==null?"":String(d.valor).replace(".",","),x[d.responsable]||d.responsable,d.efecto,y[d.estado]||d.estado,g(d.detectado_en),d.motivo,d.cerrado_por,g(d.cerrado_en)].map(o).join(";"))),r=new Blob(["\uFEFF"+a.join(`
`)],{type:"text/csv;charset=utf-8"}),i=document.createElement("a");i.href=URL.createObjectURL(r),i.download=`control_diferencias_${new Date().toISOString().slice(0,10)}.csv`,i.click(),setTimeout(()=>URL.revokeObjectURL(i.href),2e3)}function C(){return`<style>
  .cdf{display:flex;flex-direction:column;gap:16px;color:${n.ink}}
  .cdf-card{background:#fff;border:1px solid ${n.line};border-radius:8px;padding:20px 24px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .cdf-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:1px solid ${n.line};padding-bottom:12px;margin-bottom:12px}
  .cdf-head h3{margin:0;font-size:18px;font-weight:700}.cdf-head p{margin:4px 0 0;font-size:13px;color:${n.ink2};max-width:720px}
  .cdf-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .cdf-muted{font-size:12px;color:${n.ink2}}
  .cdf-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid ${n.red};background:${n.red};color:#fff;border-radius:4px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer}
  .cdf-btn.ghost{background:#fff;color:${n.ink};border-color:${n.line}}.cdf-btn[disabled]{opacity:.5;cursor:default}
  .cdf-btn .material-symbols-outlined{font-size:18px}
  .cdf-kpis,.cdf-ctls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}
  .cdf-sep{width:1px;height:22px;background:${n.line};margin:0 6px}
  .cdf-seg,.cdf-chip,.cdf-ctl{border:1px solid ${n.line};background:#fff;color:${n.ink2};border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:600;cursor:pointer}
  .cdf-seg.on,.cdf-chip.on,.cdf-ctl.on{background:${n.ink};border-color:${n.ink};color:#fff}
  .cdf-chip b,.cdf-ctl b{margin-left:4px}
  .cdf-search{display:flex;align-items:center;gap:6px;border:1px solid ${n.line};border-radius:6px;padding:6px 10px;max-width:520px;margin-bottom:10px}
  .cdf-search input{border:0;outline:0;width:100%;font:inherit;font-size:13px;background:transparent}.cdf-search .material-symbols-outlined{font-size:18px;color:${n.ink2}}
  .cdf-note{font-size:12.5px;color:${n.ink2};background:${n.soft};border:1px solid ${n.line};border-radius:6px;padding:8px 10px;margin:0 0 10px;line-height:1.5}
  .cdf-scroll{overflow-x:auto}
  .cdf-tbl{width:100%;border-collapse:collapse;font-size:13px}
  .cdf-tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${n.ink2};font-weight:700;border-bottom:1px solid ${n.line};padding:8px 10px;white-space:nowrap;background:${n.soft}}
  .cdf-tbl td{padding:8px 10px;border-bottom:1px solid #edeeef;white-space:nowrap;vertical-align:top}
  .cdf-tbl td.wrap{white-space:normal;min-width:240px;max-width:420px}.cdf-tbl .r{text-align:right;font-variant-numeric:tabular-nums}
  .cdf-tbl .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}
  .cdf-tag{font-size:11px;font-weight:700;background:#e5e7eb;color:${n.ink};border-radius:3px;padding:2px 6px}
  .cdf-tag.red{background:#fee2e2;color:${n.red}}
  .cdf-mini{border:1px solid ${n.red};background:${n.red};color:#fff;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:700;cursor:pointer;margin-right:4px}
  .cdf-mini.ghost{background:#fff;color:${n.ink};border-color:${n.line}}
  .cdf-empty{padding:24px;color:${n.ink2};font-size:13px;text-align:center}.cdf-empty.ok{color:${n.green};font-weight:600}
  .cdf-pag{display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-top:10px;font-size:12px;color:${n.ink2}}
  .cdf-ov{position:fixed;inset:0;background:rgba(25,28,29,.28);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
  .cdf-modal{background:#fff;border-radius:8px;padding:20px 24px;width:min(560px,100%);box-shadow:0 16px 48px rgba(0,0,0,.2)}
  .cdf-mhead{display:flex;justify-content:space-between;align-items:center}.cdf-mhead h3{margin:0;font-size:16px;font-weight:700}
  .cdf-sub{font-size:13px;color:${n.ink2};margin:6px 0 10px}.cdf-x{border:0;background:none;cursor:pointer;color:${n.ink2}}
  .cdf-in{border:1px solid ${n.line};border-radius:4px;padding:8px;font:inherit;font-size:13px;width:100%;box-sizing:border-box}
  .cdf-mfoot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
  .nowrap{white-space:nowrap}
  </style>`}export{D as renderControlDiferencias};
