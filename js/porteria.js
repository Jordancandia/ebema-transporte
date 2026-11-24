import{supabase as k}from"./supabase-client.js?v=fd17fd7d20";import{escapeHtml as d,showAlert as y,toCSV as Ve,downloadFile as Ge}from"./utils.js";import{confirmar as ne,pedirDato as ee}from"./confirmar.js?v=84d7f13f40";import{getPerfil as Fe,PERFIL_UMBRALES as Ze}from"./permisos.js?v=a8b193e9fb";const U="1003",ie="America/Santiago",R={TRONCAL:{label:"Troncal",icon:"local_shipping",pill:"info",hitos:["presentacion","ingreso","salida"],contra:"Sucursal destino"},PROVEEDOR:{label:"Proveedor",icon:"factory",pill:"purple",hitos:["presentacion","ingreso","salida"],contra:"Proveedor"},RETIRO_CLIENTE:{label:"Cliente retira",icon:"person",pill:"orange",hitos:["presentacion","ingreso","salida"],contra:"Cliente"},DESPACHO_EBEMA:{label:"Despacho Ebema",icon:"outbound",pill:"mute",hitos:["salida","regreso"],contra:"Cliente / obra"}},ke=[{k:"TRONCAL",icon:"local_shipping",label:"Troncales",sub:"Programados · por bloque"},{k:"PROVEEDOR",icon:"factory",label:"Proveedores",sub:"Agenda por bloque"},{k:"RETIRO_CLIENTE",icon:"person",label:"Cliente retira",sub:"Sin agenda · llega y se presenta"},{k:"DESPACHO_EBEMA",icon:"outbound",label:"Despacho a cliente",sub:"Salida y retorno"}],G={presentacion:"Llegada",ingreso:"Ingreso",salida:"Salida",regreso:"Ingreso"},Qe={presentacion:"Llegó",ingreso:"Ingresa",salida:"Sale",regreso:"Registrar retorno"},te={PROGRAMADO:["Programado","mute"],EN_COLA:["En cola","warn"],EN_PATIO:["En patio","info"],EN_RUTA:["En ruta","purple"],FINALIZADO:["Finalizado","ok"],NO_SE_PRESENTA:["No se presenta","bad"],NO_CARGA:["No carga","orange"],ANULADO:["Anulado","mute"]},Je=["GUIA","OC","NV","ENTREGA","DT"],Ke=["Cliente rechazó la entrega","No había quien recibiera","Dirección o acceso con problema","Producto no conforme","Otro"],F="id,fecha,centro,tipo,subtipo,estado,patente,patente_carro,chofer_nombre,chofer_rut,chofer_telefono,id_transporte,transportista,contraparte,ce,documentos,hora_agenda,t_presentacion,t_ingreso,t_salida,t_regreso,tara_kg,bruto_kg,peso_guias_kg,neto_kg,origen,clave_esperado,plan_ref,retiros,consolida_retiro,obs,created_by,updated_by,updated_at,pedido_venta,retira_nombre,retira_rut,retira_telefono,retira_es_chofer,fuera_agenda,guias_proveedor,bruto_ingreso_kg,entregas_devueltas,motivo_devolucion,anden,sin_romana_autorizado,sin_romana_por,patente_coordinada,chofer_coordinado,datos_confirmados_at,datos_confirmados_por",o={fecha:j(),sub:"registro",tab:"TRONCAL",q:"",busq:null,visitas:[],esperados:[],metas:{},cfg:{},bloques:[],centros:null,proveedores:null,desde:Se(j(),-30),hasta:j(),ind:null,alertas:null};let S=null,ve=null,le=null;function j(){return new Date().toLocaleDateString("en-CA",{timeZone:ie})}function Se(e,t){const s=new Date(e+"T12:00:00");return s.setDate(s.getDate()+t),s.toISOString().slice(0,10)}const M=e=>e?new Date(e).toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:ie}):"",J=e=>e?new Date(e+"T12:00:00").toLocaleDateString("es-CL",{day:"2-digit",month:"short"}):"",Z=(e,t)=>e&&t?(new Date(t)-new Date(e))/6e4:null,E=(e,t=0)=>e==null||e===""||isNaN(e)?"":Number(e).toLocaleString("es-CL",{maximumFractionDigits:t});function L(e){return e==null||isNaN(e)?"—":(e=Math.max(0,Math.round(e)),e<60?`${e} min`:`${Math.floor(e/60)} h ${String(e%60).padStart(2,"0")}`)}function T(e){if(e==null)return null;let t=String(e).trim();if(!t)return null;t=t.replace(/\s/g,""),t.includes(",")?t=t.replace(/\./g,"").replace(",","."):/^\d{1,3}(\.\d{3})+$/.test(t)&&(t=t.replace(/\./g,""));const s=parseFloat(t);return isFinite(s)?s:null}function H(e){const t=String(e||"").toUpperCase().replace(/[^A-Z0-9]/g,"");return/^[A-Z]{2}([A-Z]{2}|[0-9]{2})[0-9]{2}$/.test(t)?`${t.slice(0,2)}-${t.slice(2,4)}-${t.slice(4)}`:String(e||"").trim().toUpperCase()}const de=e=>/^[A-Z]{2}-[A-Z0-9]{2}-[0-9]{2}$/.test(H(e));function we(e){if(!e)return"";const t=new Date(e),s=new Intl.DateTimeFormat("en-CA",{timeZone:ie,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(t).reduce((a,n)=>(a[n.type]=n.value,a),{});return`${s.year}-${s.month}-${s.day}T${s.hour}:${s.minute}`}function Oe(e){return e?new Date(e).toISOString():null}const me=(e,t)=>`<span class="sv-pill ${t}"><i></i>${d(e)}</span>`,K=e=>me(R[e]?.label||e,R[e]?.pill||"mute"),We=e=>me((te[e]||[e])[0],(te[e]||[e,"mute"])[1]),Xe=e=>(Array.isArray(e)?e:[]).map(t=>`${t.tipo} ${t.numero}`).join(" · "),w=e=>Array.isArray(e)?e:[],Ye=15,ae=e=>{const t=/^(\d{1,2}):(\d{2})/.exec(String(e||""));return t?Number(t[1])*60+Number(t[2]):null},se=e=>e&&e.subtipo==="CD_CLIENTE",W=se;function z(e){const t=e&&e.plan_ref||{},s=e.hora_presentacion||t.hora_presentacion||(e.hora_agenda?M(e.hora_agenda):""),a=e.hora_hasta||t.hora_hasta||"",n=e.bloque??t.bloque??null;return s?{desde:s,hasta:a,bloque:n,txt:a?`${s}–${a}`:s}:null}const qe=(e,t)=>new Date(`${e}T${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}:00`),ge=(e,t)=>qe(t,ae(e.hasta)??(ae(e.desde)??0)+Ye),et=(e,t)=>qe(t,ae(e.desde)??0);function Ce(e){const t=z(e);if(!t||!e.t_presentacion)return null;const s=new Date(e.t_presentacion),a=et(t,e.fecha),n=ge(t,e.fecha);return s<a?{txt:`Anticipado ${L((a-s)/6e4)}`,cls:"info"}:s<=n?{txt:"En horario",cls:"ok"}:{txt:`Atrasado ${L((s-(t.hasta?n:a))/6e4)}`,cls:"bad"}}function D(e){const t=e?.message||String(e);return/ROMANA_INGRESO/.test(t)?"Todo camión que ingresa se pesa: registre el peso de entrada antes del ingreso.":/ROMANA_REGRESO/.test(t)?"Registre el peso de ingreso del camión antes de cerrar el retorno.":/chk_pv_ingreso/.test(t)?"El ingreso no puede ser anterior a la presentación.":/chk_pv_salida/.test(t)?"La salida no puede ser anterior al ingreso.":/chk_pv_regreso/.test(t)?"El regreso no puede ser anterior a la salida.":/ux_porteria_esperado/.test(t)?"Ese camión esperado ya fue registrado hoy.":t}function Re(e){return["FINALIZADO","NO_SE_PRESENTA","NO_CARGA","ANULADO"].includes(e.estado)?null:(R[e.tipo]?.hitos||[]).find(t=>!e["t_"+t])||null}function be(e,t=new Date){const s=t.toISOString(),a=o.metas[e.tipo]||{};return e.tipo==="DESPACHO_EBEMA"?e.t_regreso?{min:Z(e.t_salida,e.t_regreso),que:"Ruta",vivo:!1,umbral:a.meta_min}:e.t_salida&&e.estado==="EN_RUTA"?{min:Z(e.t_salida,s),que:"En ruta",vivo:!0,umbral:a.meta_min}:{min:null,que:""}:e.t_salida&&e.t_ingreso?{min:Z(e.t_ingreso,e.t_salida),que:"Permanencia",vivo:!1,umbral:a.meta_min}:e.t_ingreso&&e.estado==="EN_PATIO"?{min:Z(e.t_ingreso,s),que:"En patio",vivo:!0,umbral:a.meta_min}:e.t_presentacion&&e.estado==="EN_COLA"?{min:Z(e.t_presentacion,s),que:"Sin atención",vivo:!0,umbral:a.meta_espera_min}:{min:null,que:""}}function tt(e){return!e.umbral||e.min==null?"mute":e.min>e.umbral?"bad":e.min>e.umbral*.8?"warn":"ok"}function he(e){if(e.tipo!=="DESPACHO_EBEMA"||e.bruto_kg==null||e.tara_kg==null)return null;const t=e.bruto_kg-e.tara_kg,s=e.peso_guias_kg,a=s>0?(t-s)/s*100:null;return{carga:t,guias:s,pct:a,fuera:a!=null&&Math.abs(a)>Number(o.metas[e.tipo]?.tolerancia_peso_pct??3)}}const at=e=>e.bruto_ingreso_kg!=null&&e.tara_kg!=null?e.bruto_ingreso_kg-e.tara_kg:null;function st(){if(document.getElementById("pt-css"))return;const e=document.createElement("style");e.id="pt-css",e.textContent=`
  .pt .sv-card { overflow: hidden; }
  .pt-ch { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:13px 16px; border-bottom:1px solid var(--sv-line); }
  .pt-ch h2 { margin:0; font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px; }
  .pt-ch h2 small { font-weight:600; color:var(--sv-ink2); font-size:12px; }
  .pt-mono { font-family: var(--sv-mono); font-size:12.5px; }
  .pt-sub { font-size:12px; color:var(--sv-ink2); margin-top:2px; }
  .pt-na { color: var(--sv-line); }
  .pt-live { animation: ptPulse 2s ease-in-out infinite; }
  @keyframes ptPulse { 50% { opacity:.55; } }
  /* Pestañas de tipo de visita */
  .pt-tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:16px; }
  .pt-tab { font:inherit; cursor:pointer; background:#fff; border:1px solid var(--sv-line); border-radius:11px; padding:12px 14px; min-height:72px; display:flex; align-items:center; gap:11px; text-align:left; color:var(--sv-ink); }
  .pt-tab:hover { border-color: var(--sv-ink); }
  .pt-tab.is-on { background: var(--sv-ink); border-color: var(--sv-ink); color:#fff; }
  .pt-tab i { width:36px; height:36px; border-radius:9px; background:var(--sv-s2); display:flex; align-items:center; justify-content:center; flex:none; }
  .pt-tab.is-on i { background: rgba(255,255,255,.14); }
  .pt-tab i .material-symbols-outlined { font-size:21px; }
  .pt-tab b { display:block; font-size:14px; font-weight:700; }
  .pt-tab span { display:block; font-size:11.5px; color:var(--sv-ink2); margin-top:2px; }
  .pt-tab.is-on span { color: rgba(255,255,255,.72); }
  .pt-tab em { margin-left:auto; font-style:normal; font-family:var(--sv-mono); font-size:17px; font-weight:700; }
  /* Buscador único */
  .pt-srch { display:flex; align-items:center; gap:8px; background:#fff; border:1px solid var(--sv-line); border-radius:8px; padding:0 11px; min-height:38px; min-width:250px; }
  .pt-srch:focus-within { border-color: var(--sv-ink); }
  .pt-srch input { border:none; outline:none; font:inherit; font-size:13px; width:100%; min-width:0; background:none; font-family:var(--sv-mono); text-transform:uppercase; }
  .pt-srch .material-symbols-outlined { font-size:19px; color:var(--sv-ink2); }
  /* Secciones y filas */
  .pt-sect { font-size:11.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--sv-ink); background:var(--sv-s1); padding:8px 16px; display:flex; justify-content:space-between; gap:10px; border-bottom:1px solid var(--sv-line); border-top:1px solid var(--sv-line); }
  .pt-sect span { font-family:var(--sv-mono); letter-spacing:0; text-transform:none; color:var(--sv-ink2); font-size:12px; }
  .pt-sect.is-off { background:#fdf6e6; color:#7a4f00; }
  .pt-row { display:grid; grid-template-columns:120px 190px minmax(0,1fr) 292px 116px 128px; gap:12px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--sv-line); }
  .pt-row:hover { background: var(--sv-s1); }
  .pt-plate { font-family:var(--sv-mono); font-size:20px; font-weight:700; line-height:1.1; }
  .pt-dest { font-size:14px; font-weight:600; }
  .pt-st { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:700; white-space:nowrap; }
  .pt-st i { width:10px; height:10px; border-radius:50%; flex:none; }
  .pt-step { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
  .pt-step.is-2 { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .pt-h { border:1px solid var(--sv-line); border-radius:7px; padding:5px 7px; background:var(--sv-s1); }
  .pt-h.done { background:#eef4ef; border-color:#cfe2d5; }
  .pt-h.next { background:#fff; border:2px solid var(--sv-ink); padding:4px 6px; }
  .pt-h b { display:block; font-size:9.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--sv-ink2); }
  .pt-h u { display:block; text-decoration:none; font-family:var(--sv-mono); font-size:14.5px; font-weight:700; margin-top:1px; }
  .pt-h u.na { color:#a9aba7; }
  .pt-h s { display:block; text-decoration:none; font-family:var(--sv-mono); font-size:10.5px; color:var(--sv-ink2); }
  .pt-tm { font-family:var(--sv-mono); font-size:17px; font-weight:700; line-height:1.1; }
  .pt-tml { font-size:11px; color:var(--sv-ink2); margin-top:2px; }
  .pt-bar { height:4px; background:var(--sv-s2); border-radius:2px; overflow:hidden; margin-top:5px; }
  .pt-bar i { display:block; height:100%; }
  .pt-band { display:flex; align-items:center; gap:9px; flex-wrap:wrap; background:#fdf6e6; border-bottom:1px solid #f0dcb0; padding:8px 16px; font-size:12.5px; color:#5a3b00; }
  .pt-band b { font-weight:700; }
  .pt-band .sv-btn { background:#fff; }
  .pt-cta { background:var(--sv-ink); color:#fff; border-radius:12px; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
  .pt-cta h2 { margin:0; font-size:16px; font-weight:700; }
  .pt-cta p { margin:4px 0 0; font-size:12.5px; color:rgba(255,255,255,.72); max-width:80ch; }
  .pt-tag { font-size:11px; font-weight:600; border-radius:5px; padding:2px 7px; background:var(--sv-s2); color:var(--sv-ink); border:1px solid var(--sv-line); font-family:var(--sv-mono); }
  .pt-tag.miss { background:#fbe7e8; border-color:#e8c3c5; color:#8e0009; font-family:inherit; }
  .pt-tags { display:flex; gap:5px; flex-wrap:wrap; margin-top:4px; align-items:center; }
  .pt-addg { font:inherit; font-size:11px; font-weight:600; border:1px dashed var(--sv-line); background:#fff; border-radius:5px; padding:3px 7px; cursor:pointer; color:var(--sv-ink2); }
  .pt-addg:hover { border-color: var(--sv-ink); color: var(--sv-ink); }
  .pt-act { display:flex; flex-direction:column; gap:5px; }
  .pt-act .sv-btn, .pt-act .sv-btn-p { width:100%; justify-content:center; }
  /* Formularios */
  .pt-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px 12px; }
  .pt-grid .full { grid-column: 1 / -1; }
  .pt-f { display:flex; flex-direction:column; gap:4px; min-width:0; }
  .pt-f > span { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--sv-ink2); }
  .pt-f input, .pt-f select, .pt-f textarea { border:1px solid var(--sv-line); border-radius:4px; padding:8px 10px; font:inherit; font-size:13px; color:var(--sv-ink); background:#fff; min-width:0; }
  .pt-f input:focus, .pt-f select:focus, .pt-f textarea:focus { outline:none; border-color: var(--sv-ink2); }
  .pt-f input.is-mono { font-family: var(--sv-mono); text-transform: uppercase; }
  .pt-f input.is-err { border-color:#b5000b; }
  .pt-f input[readonly] { background: var(--sv-s1); color: var(--sv-ink2); }
  .pt-chk { display:flex; align-items:flex-start; gap:10px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px 12px; cursor:pointer; }
  .pt-chk input { width:18px; height:18px; flex:none; margin:1px 0 0; }
  .pt-chk b { display:block; font-size:13px; font-weight:700; color:#17388f; }
  .pt-chk span { display:block; font-size:11.5px; color:#28457f; margin-top:2px; line-height:1.4; }
  .pt-docs { display:flex; flex-wrap:wrap; gap:6px; }
  .pt-doc { display:inline-flex; align-items:center; gap:4px; background:var(--sv-s2); border-radius:4px; padding:3px 4px 3px 8px; font-family:var(--sv-mono); font-size:12px; }
  .pt-doc b { font-family: inherit; font-size:10px; color:var(--sv-ink2); }
  .pt-doc button { border:none; background:none; cursor:pointer; color:var(--sv-ink2); padding:0; display:flex; }
  .pt-doc button .material-symbols-outlined { font-size:16px; }
  .pt-docadd { display:flex; gap:6px; }
  .pt-docadd select { width:110px; }
  .pt-docadd input { flex:1; }
  .pt-match { border:1px solid #bfdbfe; background:#eff6ff; border-radius:8px; padding:10px 12px; font-size:13px; display:flex; gap:10px; align-items:flex-start; justify-content:space-between; }
  .pt-calc { font-size:12px; color:var(--sv-ink2); }
  .pt-calc b { color: var(--sv-ink); }
  .pt-kv { display:grid; grid-template-columns: 1fr auto; gap:4px 12px; font-size:12.5px; }
  .pt-kv span:nth-child(odd) { color:var(--sv-ink2); }
  .pt-kv span:nth-child(even) { font-weight:700; text-align:right; font-family:var(--sv-mono); }
  .pt-ent { display:flex; align-items:center; gap:10px; border:1px solid var(--sv-line); border-radius:8px; padding:9px 11px; cursor:pointer; margin-bottom:7px; background:#fff; }
  .pt-ent.is-on { border-color:#b5000b; background:#fdf5f5; }
  .pt-ent input { width:18px; height:18px; flex:none; }
  .pt-ent b { font-family:var(--sv-mono); font-size:14px; font-weight:700; }
  .pt-ent em { margin-left:auto; font-style:normal; font-family:var(--sv-mono); font-size:13px; font-weight:700; white-space:nowrap; }
  /* Indicadores / monitor */
  .pt-heat { border-collapse:separate; border-spacing:2px; font-size:11px; width:100%; }
  .pt-heat th { font-weight:700; color:var(--sv-ink2); padding:2px 4px; text-align:center; }
  .pt-heat th:first-child { text-align:left; white-space:nowrap; }
  .pt-heat td { text-align:center; padding:6px 0; border-radius:3px; font-family:var(--sv-mono); min-width:26px; }
  .pt-tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px; }
  .pt-tile { background:#fff; border:1px solid var(--sv-line); border-radius:8px; padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
  .pt-tile-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .pt-big { font-size:28px; line-height:34px; font-weight:700; }
  .pt-big small { font-size:13px; font-weight:600; color:var(--sv-ink2); margin-left:4px; }
  .pt-al { display:flex; gap:13px; align-items:flex-start; padding:14px 16px; border-bottom:1px solid var(--sv-line); }
  .pt-al.is-crit { background:#fdf5f5; }
  .pt-al-i { width:36px; height:36px; border-radius:9px; flex:none; display:flex; align-items:center; justify-content:center; }
  .pt-al-b { flex:1 1 auto; min-width:0; }
  .pt-al-k { font-size:11.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
  .pt-al-h { font-size:15.5px; font-weight:700; margin:4px 0 0; display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; }
  .pt-al-h b { font-family:var(--sv-mono); font-size:16px; }
  .pt-al-d { font-size:12.5px; color:var(--sv-ink); margin-top:4px; line-height:1.5; }
  .pt-al-a { display:flex; flex-direction:column; gap:6px; flex:none; width:150px; }
  .pt-al-a .pt-big { font-family:var(--sv-mono); font-size:24px; line-height:1; }
  @media (max-width: 1280px) { .pt-row { grid-template-columns:110px 170px minmax(0,1fr) 262px 104px 118px; gap:10px; } }
  @media (max-width: 1080px) { .pt-tabs { grid-template-columns:repeat(2,minmax(0,1fr)); } .pt-row { grid-template-columns:minmax(0,1fr); gap:9px; } .pt-act { flex-direction:row; } }
  @media (max-width: 640px) { .pt-grid { grid-template-columns: 1fr; } .pt-tabs { grid-template-columns:minmax(0,1fr); } }
  `,document.head.appendChild(e)}async function _e(){const[e,t]=await Promise.all([k.from("porteria_metas").select("*"),k.from("porteria_config").select("*")]);e.error||(o.metas=Object.fromEntries((e.data||[]).map(s=>[s.tipo,s]))),t.error||(o.cfg=Object.fromEntries((t.data||[]).map(s=>[s.clave,Number(s.valor)])))}async function Q(){const e=o.fecha,t=`and(fecha.gte.${Se(e,-3)},fecha.lt.${e},estado.in.(EN_COLA,EN_PATIO,EN_RUTA))`,[s,a]=await Promise.all([k.from("porteria_visitas").select(F).eq("centro",U).or(`fecha.eq.${e},${t}`).order("created_at",{ascending:!0}),k.rpc("fn_porteria_esperados",{p_fecha:e,p_centro:U})]);return s.error?(y("Error al leer portería: "+s.error.message,"error"),!1):(a.error&&y("No se pudieron leer los esperados del día: "+a.error.message,"error"),o.visitas=s.data||[],o.esperados=a.data||[],!0)}async function ce(){if(!o.bloques.length){const{data:e}=await k.from("abast_bloque_presentacion").select("bloque,desde,hasta,cupo").eq("activo",!0).order("bloque");o.bloques=(e||[]).map(t=>({...t,desde:String(t.desde).slice(0,5),hasta:String(t.hasta).slice(0,5)}))}if(!o.centros){const{data:e}=await k.from("logistics_centres").select("id,nombre").order("nombre");o.centros=(e||[]).filter(t=>t.id!==U)}if(!o.proveedores){const{data:e}=await k.from("abast_proveedores").select("nombre").eq("activo",!0).order("nombre").limit(3e3);o.proveedores=(e||[]).map(t=>t.nombre).filter(Boolean)}}function re(){clearInterval(ve),clearInterval(le),ve=le=null}function $e(){return S&&document.body.contains(S)&&S.querySelector(".pt")}async function Nt(e,t="registro"){if(S=e,st(),re(),o.sub=t,e.innerHTML='<div class="sv-view pt"><div class="sv-desc">Cargando portería…</div></div>',await _e(),t==="indicadores")return ue();if(t==="alertas")return X();await ce(),await Q(),N(),ve=setInterval(()=>{if(!$e())return re();_t()},3e4),le=setInterval(async()=>{if(!$e())return re();document.querySelector(".sv-dr")||document.querySelector(".sv-cf-bg")||o.busq||await Q()&&N()},12e4)}const Le=e=>o.esperados.filter(t=>t.tipo===e&&!t.visita_id).length,ye=e=>o.visitas.filter(t=>t.tipo===e&&t.estado!=="ANULADO");function rt(){return`<nav class="pt-tabs" aria-label="Tipo de visita">${ke.map(e=>{const t=Le(e.k)+ye(e.k).length;return`<button type="button" class="pt-tab ${o.tab===e.k?"is-on":""}" data-tab="${e.k}" ${o.tab===e.k?'aria-current="page"':""}>
      <i><span class="material-symbols-outlined" style="font-size:21px;color:inherit">${e.icon}</span></i>
      <div style="min-width:0"><b>${d(e.label)}</b><span>${d(e.sub)}</span></div>
      <em>${t}</em></button>`}).join("")}</nav>`}function ot(){const e=ye(o.tab),t=l=>e.filter(r=>r.estado===l).length,s=(l,r,v,u)=>`<div class="sv-kpi" style="cursor:default"><div class="sv-kpi-l"><i style="background:${v}"></i>${l}</div><div class="sv-kpi-v">${r}</div><div class="sv-kpi-s">${u}</div></div>`;if(o.tab==="DESPACHO_EBEMA"){const l=e.filter(v=>he(v)?.fuera).length,r=e.filter(v=>w(v.entregas_devueltas).length).length;return`<div class="sv-kpis">
      ${s("En ruta",t("EN_RUTA"),"#7e22ce","sin registrar retorno")}
      ${s("Retornos",t("FINALIZADO"),"#15803d","cerrados hoy")}
      ${s("Diferencia de peso",l,"#b5000b","romana vs guías")}
      ${s("Entregas devueltas",r,"#b5000b","vuelven al CD")}
      ${s("Sin salida",t("PROGRAMADO"),"#9a9c99","registrados sin partir")}
    </div>`}const a=Le(o.tab),n=o.esperados.filter(l=>l.tipo===o.tab&&!l.visita_id&&z(l)&&o.fecha===j()&&new Date>ge(z(l),o.fecha)).length,f=`${s("En cola",t("EN_COLA"),"#ca8a04","sin atención")}
      ${s("En patio",t("EN_PATIO"),"#1d4ed8","dentro del CD")}
      ${s("Finalizados",t("FINALIZADO"),"#15803d","ciclo completo")}`;if(o.tab==="RETIRO_CLIENTE"){const l=e.filter(v=>v.estado==="FINALIZADO").map(v=>Z(v.t_ingreso,v.t_salida)).filter(v=>v!=null),r=l.length?l.reduce((v,u)=>v+u,0)/l.length:null;return`<div class="sv-kpis">${f}${s("Permanencia promedio",L(r),"#9a9c99","ingreso → salida")}</div>`}return`<div class="sv-kpis">${f}
      ${s("Por llegar",a,"#9a9c99",o.tab==="TRONCAL"?"del Plan de Carga":"de la agenda del día")}
      ${s("Fuera de horario",n,"#b5000b","no llegaron en su bloque")}
    </div>`}function nt(){const e=o.bloques.map(t=>({k:"b"+t.bloque,t:`Bloque ${t.bloque} · ${t.desde}–${t.hasta}`,meta:`cupo ${t.cupo}`}));return o.tab==="TRONCAL"?[...e,{k:"libre",t:"Hora libre · ramplas a cliente",meta:"sin tope de bloque"},{k:"sin",t:"Sin horario solicitado"}]:o.tab==="PROVEEDOR"?[...e,{k:"libre",t:"Con hora de agenda"},{k:"sin",t:"Sin agenda",off:!0}]:o.tab==="RETIRO_CLIENTE"?[{k:"all",t:"Retiros de cliente de hoy",meta:"presentación → ingreso → salida"}]:[{k:"ruta",t:"En ruta · pendientes de retorno"},{k:"retorno",t:"Retornos registrados hoy"},{k:"otros",t:"Registrados sin salida"}]}function it(e){if(o.tab==="RETIRO_CLIENTE")return"all";if(o.tab==="DESPACHO_EBEMA")return e.estado==="EN_RUTA"?"ruta":e.t_regreso?"retorno":"otros";if(W(e))return"libre";const t=z(e);return t&&t.bloque?"b"+t.bloque:t?"libre":"sin"}function Ne(e){return`<div><div class="pt-plate">${d(e.patente||"— sin patente")}</div>
    <div class="pt-sub">${e.patente_carro?"Carro "+d(e.patente_carro)+"<br>":""}${d(e.chofer_nombre||"")}${e.transportista?"<br>"+d(e.transportista):""}</div></div>`}function Te(e){const t=[];W(e)&&t.push('<span class="pt-tag" style="background:#e6f0e9;border-color:#c7e0d1;color:#14603a;font-family:inherit">RAMPLA</span>'),e.fuera_agenda&&t.push('<span class="pt-tag" style="background:#fdf6e6;border-color:#f0dcb0;color:#7a4f00;font-family:inherit">SIN AGENDA</span>'),e.pedido_venta&&t.push(`<span class="pt-tag">NV ${d(e.pedido_venta)}</span>`),w(e.documentos).slice(0,3).forEach(f=>t.push(`<span class="pt-tag">${d(f.tipo)} ${d(f.numero)}</span>`)),w(e.retiros).forEach(f=>t.push(`<span class="pt-tag">OC ${d(f.doc_compr)}</span>`));const s=e.plan_ref||{},a=o.tab==="TRONCAL"&&!W(e)&&s.camion!=null?`Camión ${d(s.camion)} · ${E(s.ton,1)} t · ${E(s.pct)}%`:W(e)?`${E(s.ton,1)} t · carga de material a cliente`:o.tab==="DESPACHO_EBEMA"?`${w(e.documentos).length} entrega(s)${e.subtipo==="FIERRO"?" · Fierro":""}`:s.tipo?d(s.tipo):"",n=e.retira_nombre?`<div class="pt-sub">Retira <b>${d(e.retira_nombre)}</b>${e.retira_rut?" · "+d(e.retira_rut):""}${e.retira_es_chofer?" · es el chofer":""}</div>`:"";return`<div style="min-width:0"><div class="pt-dest">${d(e.contraparte||"—")}</div>
    ${a?`<div class="pt-sub">${a}</div>`:""}${n}
    ${t.length?`<div class="pt-tags">${t.join("")}</div>`:""}</div>`}function lt(e){const t=z(e),s=t&&o.fecha===j()&&new Date>ge(t,o.fecha);return`<div><div class="pt-st" style="color:${s?"#b5000b":"var(--sv-ink2)"}"><i style="background:${s?"#b5000b":"#9a9c99"}"></i>${s?"No llegó":"Programado"}</div>
    <div class="pt-sub pt-mono">${t?d(t.txt):"sin horario"}</div></div>`}function dt(e){const t={EN_COLA:"#ca8a04",EN_PATIO:"#1d4ed8",EN_RUTA:"#7e22ce",FINALIZADO:"#15803d",PROGRAMADO:"#9a9c99",NO_SE_PRESENTA:"#b5000b",NO_CARGA:"#c2410c",ANULADO:"#9a9c99"}[e.estado]||"#9a9c99",s=Ce(e);return`<div><div class="pt-st"><i style="background:${t}"></i>${(te[e.estado]||[e.estado])[0]}</div>
    ${s?`<div class="pt-sub" style="color:${s.cls==="bad"?"#b5000b":s.cls==="ok"?"#15803d":"inherit"}">${d(s.txt)}</div>`:e.fuera_agenda?'<div class="pt-sub">llegada sin cita</div>':""}</div>`}function ct(e,t,s){const a=e["t_"+t],n=t==="ingreso"?e.tara_kg:t==="salida"?(e.tipo==="DESPACHO_EBEMA",e.bruto_kg):t==="regreso"?e.bruto_ingreso_kg:null,f=e.tipo==="DESPACHO_EBEMA"&&t==="salida"?"Salida":G[t];return`<div class="pt-h ${s}"><b>${f}</b><u class="${a?"":"na"}">${a?M(a):"—"}</u>
    ${n!=null?`<s>${E(n)} kg</s>`:s==="next"&&(t==="ingreso"||t==="regreso")?"<s>pesar</s>":""}</div>`}function pt(e){const t=R[e.tipo].hitos,s=Re(e);return`<div class="pt-step ${t.length===2?"is-2":""}">${t.map(a=>ct(e,a,e["t_"+a]?"done":a===s?"next":"")).join("")}</div>`}function ut(e){const t=R[e.tipo].hitos;return`<div class="pt-step ${t.length===2?"is-2":""}">${t.map((s,a)=>`<div class="pt-h ${a===0?"next":""}"><b>${G[s]}</b><u class="na">—</u></div>`).join("")}</div>`}function Pe(e){const t=be(e);if(t.min==null)return'<div><div class="pt-tm pt-na">—</div><div class="pt-tml">sin medición</div></div>';const s=tt(t),a={ok:"#15803d",warn:"#8a5a00",bad:"#b5000b",mute:"var(--sv-ink2)"}[s],n=t.umbral?Math.min(100,Math.round(t.min/t.umbral*100)):0;return`<div data-timer="${e.id}"><div class="pt-tm ${t.vivo?"pt-live":""}" style="color:${a}">${L(t.min)}</div>
    <div class="pt-tml">${d(t.que)}${t.umbral?` · meta ${t.umbral}`:""}</div>
    ${t.umbral?`<div class="pt-bar"><i style="width:${n}%;background:${a}"></i></div>`:""}</div>`}function ft(e){const t=he(e),s=at(e),a=t?.fuera?"#b5000b":"#15803d";return`<div class="pt-sub" style="margin:0">
    ${e.tara_kg!=null?`Tara ${E(e.tara_kg)} · `:""}${e.bruto_kg!=null?`Bruto ${E(e.bruto_kg)}`:"sin pesaje"}
    ${t?`<div>Carga romana <b>${E(t.carga)} kg</b> · guías ${E(t.guias)} kg</div>
      <div style="color:${a};font-weight:700">${t.pct!=null?(t.pct>0?"+":"")+E(t.carga-t.guias)+" kg · "+(t.pct>0?"+":"")+E(t.pct,1)+"%":"sin guías"}${t.fuera?" fuera de tolerancia":""}</div>`:""}
    ${s!=null?`<div>Vuelve con <b>${E(s)} kg</b>${w(e.entregas_devueltas).length?" · "+w(e.entregas_devueltas).map(n=>"ENT "+d(n.n_entrega)).join(", "):""}</div>`:""}</div>`}function vt(){return o.tab==="RETIRO_CLIENTE"?`<div class="pt-cta">
    <div><h2>Se presentó un cliente a retirar</h2>
      <p>Obligatorio: N° de pedido de ventas, nombre y RUT de quien retira, patente del vehículo y transportista. La patente del carro es opcional y, si quien retira es el mismo chofer, se copian nombre y RUT.</p></div>
    <button class="sv-btn" id="pt-retiro" style="background:#fff;color:var(--sv-ink)"><span class="material-symbols-outlined">add</span>Registrar retiro de cliente</button></div>`:o.tab==="DESPACHO_EBEMA"?`<div class="pt-cta">
    <div><h2>Salida de un despacho a cliente</h2>
      <p>Se registra patente, hora de salida, las entregas cargadas y los pesos (tara, bruto de salida y peso de las guías) para calcular la diferencia. Al volver se piden hora y peso de ingreso y qué entregas regresan.</p></div>
    <button class="sv-btn" id="pt-salida" style="background:#fff;color:var(--sv-ink)"><span class="material-symbols-outlined">outbound</span>Registrar salida</button></div>`:""}function De(e){if(e.tipo!=="TRONCAL"||!w(e.retiros).length)return"";const t=w(e.guias_proveedor);return`<div class="pt-band"><span class="material-symbols-outlined" style="font-size:18px">merge</span>
    <b>Viene con retiro de fábrica</b> · ${w(e.retiros).map(s=>d(s.proveedor||"")+" · OC "+d(s.doc_compr)).join(" · ")} · misma patente y chofer, una sola línea
    ${t.map(s=>`<span class="pt-tag">GUÍA ${d(s.numero)}</span>`).join("")||'<span class="pt-tag miss">Sin guías del proveedor</span>'}
    ${e.id?`<button class="sv-btn" data-guia="${e.id}" style="min-height:0;padding:4px 10px">Agregar guía</button>`:'<span class="pt-sub" style="margin:0">Las guías se piden al registrar la llegada.</span>'}</div>`}function mt(e){const t=o.esperados.indexOf(e);return`<div class="pt-row">
    ${lt(e)}${Ne(e)}${Te(e)}${ut(e)}
    <div><div class="pt-tm pt-na">—</div><div class="pt-tml">sin presentación</div></div>
    <div class="pt-act"><button class="sv-btn-p" data-esp="${t}" ${o.fecha===j()?"":'disabled title="Sólo se registra la llegada del día de hoy"'}>Llegó</button></div>
  </div>${De(e)}`}function gt(e){const t=Re(e),s=e.tipo==="DESPACHO_EBEMA",a=t==="regreso"?`<button class="sv-btn-p" data-ret="${e.id}">Registrar retorno</button>`:t?`<button class="sv-btn-p" data-hito="${t}" data-vid="${e.id}">${Qe[t]}</button>`:"";return`<div class="pt-row" data-id="${e.id}">
    ${dt(e)}${Ne(e)}
    <div style="min-width:0">${Te(e)}${s?ft(e):""}</div>
    ${pt(e)}${Pe(e)}
    <div class="pt-act">${a}<button class="sv-btn is-icon" data-edit="${e.id}" title="Editar / corregir"><span class="material-symbols-outlined">edit</span></button></div>
  </div>${De(e)}`}function bt(){const e=ke.find(l=>l.k===o.tab),t=o.esperados.filter(l=>l.tipo===o.tab&&!l.visita_id),s=ye(o.tab);let a=`<div class="pt-ch"><h2><span class="material-symbols-outlined">${e.icon}</span>${d(e.label)}
      <small>${J(o.fecha)} · ${t.length} por llegar · ${s.length} registrado(s)</small></h2>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${o.tab==="PROVEEDOR"?'<button class="sv-btn" id="pt-agenda"><span class="material-symbols-outlined">event_available</span>Agregar cita de proveedor</button>':""}
      <button class="sv-btn" id="pt-csv"><span class="material-symbols-outlined">download</span>CSV del día</button></div></div>`;const n=[...t.map(l=>({e:l,cita:z(l)})),...s.map(l=>({v:l,cita:z(l)}))];let f=0;return nt().forEach(l=>{const r=n.filter(u=>it(u.e||u.v)===l.k).sort((u,h)=>(ae(u.cita&&u.cita.desde)??9999)-(ae(h.cita&&h.cita.desde)??9999)),v=/^b\d+$/.test(l.k)&&["TRONCAL","PROVEEDOR"].includes(o.tab);!r.length&&!v||(f+=r.length,a+=`<div class="pt-sect ${l.off?"is-off":""}">${d(l.t)}<span>${r.length?r.length+" camión(es)":"sin camiones"}${l.meta?" · "+d(l.meta):""}</span></div>`,a+=r.map(u=>u.e?mt(u.e):gt(u.v)).join(""))}),f||(a+=`<div class="sv-empty" style="padding:28px 16px;text-align:center">Sin camiones de este tipo para ${J(o.fecha)}.</div>`),a}function N(){if(!S)return;if(o.sub==="alertas")return X();if(o.sub==="indicadores")return ue();const e=o.fecha===j();S.innerHTML=`<div class="sv-view pt">
    <div class="sv-vhead">
      <div>
        <h1 class="sv-h1">Control puerta · CD Quilicura</h1>
        <div class="sv-desc">Busca la patente o elige el tipo de visita. La hora de cada hito la pone el servidor y el ingreso al patio exige el peso de romana.</div>
      </div>
      <div class="sv-actions">
        <label class="pt-srch"><span class="material-symbols-outlined">search</span>
          <input id="pt-q" value="${d(o.q)}" placeholder="Patente, NV, OC o guía" autocomplete="off" aria-label="Buscar patente, pedido de venta, orden de compra o guía"></label>
        <label class="sv-inp"><span class="material-symbols-outlined">event</span><input type="date" id="pt-fecha" value="${o.fecha}"></label>
        ${e?"":'<button class="sv-btn" id="pt-hoy">Hoy</button>'}
        <button class="sv-btn is-icon" id="pt-ref" title="Actualizar"><span class="material-symbols-outlined">refresh</span></button>
        <button class="sv-btn-p" id="pt-nuevo"><span class="material-symbols-outlined">add</span>Llegada sin agenda</button>
      </div>
    </div>
    ${rt()}
    <div id="pt-busq">${o.busq?ze():""}</div>
    ${ot()}
    ${vt()}
    <div class="sv-card">${bt()}</div>
  </div>`,ht()}function ht(){const e=a=>S.querySelector(a);e("#pt-fecha").addEventListener("change",async a=>{o.fecha=a.target.value||j(),await Q(),N()}),e("#pt-hoy")?.addEventListener("click",async()=>{o.fecha=j(),await Q(),N()}),e("#pt-ref").addEventListener("click",async()=>{await Q(),N()}),e("#pt-nuevo").addEventListener("click",()=>V(null)),e("#pt-retiro")?.addEventListener("click",()=>Me(null)),e("#pt-salida")?.addEventListener("click",()=>V(null,"DESPACHO_EBEMA")),e("#pt-agenda")?.addEventListener("click",()=>kt()),e("#pt-csv")?.addEventListener("click",yt),S.querySelectorAll("[data-tab]").forEach(a=>a.addEventListener("click",()=>{o.tab=a.dataset.tab,N()}));const t=e("#pt-q");let s;t.addEventListener("input",()=>{clearTimeout(s),s=setTimeout(()=>je(t.value),350)}),t.addEventListener("keydown",a=>{a.key==="Enter"&&(a.preventDefault(),clearTimeout(s),je(t.value))}),S.querySelectorAll("[data-esp]").forEach(a=>a.addEventListener("click",n=>{n.stopPropagation(),Ie(o.esperados[+a.dataset.esp])})),S.querySelectorAll("[data-hito]").forEach(a=>a.addEventListener("click",n=>{n.stopPropagation(),$t(+a.dataset.vid,a.dataset.hito)})),S.querySelectorAll("[data-ret]").forEach(a=>a.addEventListener("click",n=>{n.stopPropagation(),Et(o.visitas.find(f=>f.id===+a.dataset.ret))})),S.querySelectorAll("[data-guia]").forEach(a=>a.addEventListener("click",n=>{n.stopPropagation(),At(o.visitas.find(f=>f.id===+a.dataset.guia))})),S.querySelectorAll("[data-edit]").forEach(a=>a.addEventListener("click",n=>{n.stopPropagation(),V(o.visitas.find(f=>f.id===+a.dataset.edit))})),S.querySelectorAll("[data-ver]").forEach(a=>a.addEventListener("click",n=>{n.stopPropagation(),V(o.visitas.find(f=>f.id===+a.dataset.ver))})),S.querySelector("#pt-bcerrar")?.addEventListener("click",()=>{o.busq=null,o.q="",N()})}function _t(){S.querySelectorAll("[data-timer]").forEach(e=>{const t=o.visitas.find(s=>s.id===+e.dataset.timer);t&&be(t).vivo&&(e.outerHTML=Pe(t))})}function oe(e){const t=o.visitas.findIndex(s=>s.id===e.id);t>=0?o.visitas[t]=e:o.visitas.push(e)}async function $t(e,t){const s=o.visitas.find(r=>r.id===e);if(!s)return;const a=s.tipo==="DESPACHO_EBEMA",n={};if(t==="ingreso"&&!a&&s.tara_kg==null){const r=await ee(`Ingreso · ${s.patente||""}

Peso de entrada en romana (kg). Todo camión que ingresa se pesa.`,{aceptar:"Registrar ingreso",placeholder:"Ej: 15.420",icono:"scale",patron:/^[\d.,\s]+$/,error:"Ingrese el peso en kg"});if(r===null)return;const v=T(r);if(v==null)return y("El ingreso necesita el peso de romana.","error");n.tara_kg=v}if(t==="salida"&&s.bruto_kg==null){const r=a?"Peso de salida con carga (bruto)":"Peso de salida (bruto)",v=await ee(`Salida · ${s.patente||""}

${r} en romana (kg).${a?"":" Puede quedar vacío y completarse después."}`,{aceptar:"Registrar salida",placeholder:"Ej: 27.980",opcional:!a,icono:"scale",patron:/^[\d.,\s]+$/,error:"Ingrese sólo números (kg)"});if(v===null)return;const u=T(v);if(u==null&&a)return y("La salida del despacho necesita el peso de romana.","error");u!=null&&(n.bruto_kg=u)}if(Object.keys(n).length){const{error:r}=await k.from("porteria_visitas").update(n).eq("id",e);if(r)return y(D(r),"error");Object.assign(s,n)}const{data:f,error:l}=await k.rpc("fn_porteria_marcar",{p_id:e,p_hito:t});if(l)return y(D(l),"error");oe({...s,...n,...f}),y(`${G[t]} registrada ${M(f["t_"+t])} · ${f.patente||""}`),N()}function xe(e){const t=[],s=new Set,a=(n,f)=>{const l=n+"|"+f;f&&!s.has(l)&&(s.add(l),t.push({tipo:n,numero:String(f)}))};return w(e.retiros).forEach(n=>{a("OC",n.doc_compr),a("ENTREGA",n.entrega_entrante)}),w(e.plan_ref&&e.plan_ref.docs).forEach(n=>{a("NV",n.pedido_venta),a("ENTREGA",n.n_entrega)}),{tipo:e.tipo,subtipo:e.subtipo||null,hora_agenda:e.hora_agenda||null,patente:e.patente,patente_carro:e.patente_carro,chofer_nombre:e.chofer_nombre,chofer_rut:e.chofer_rut,chofer_telefono:e.chofer_telefono,id_transporte:e.id_transporte,transportista:e.transportista,contraparte:e.contraparte,ce:e.ce,documentos:t,clave_esperado:e.clave,plan_ref:{...e.plan_ref||{},bloque:e.bloque??null,hora_presentacion:e.hora_presentacion||null,hora_hasta:e.hora_hasta||null},retiros:w(e.retiros),consolida_retiro:!!e.consolida_retiro,patente_coordinada:e.patente||null,chofer_coordinado:e.chofer_nombre||null,origen:e.tipo==="TRONCAL"?e.consolida_retiro?"PLAN_CARGA+RETIRO":"PLAN_CARGA":"RETIRO_FABRICA"}}async function Ie(e){if(!e)return;if(e.tipo==="TRONCAL")return xt(e);const t=xe(e);if(!t.patente){const n=await ee(`Llegada · ${e.contraparte||""}

No hay patente coordinada. Ingrese la patente del camión que llegó.`,{aceptar:"Registrar llegada",placeholder:"AA-BB-12",icono:"local_shipping"});if(n===null)return;t.patente=H(n),t.patente_coordinada=null}const{data:s,error:a}=await k.rpc("fn_porteria_registrar",{p:t,p_hito:"presentacion"});if(a)return y(D(a),"error");o.visitas.push(s),e.visita_id=s.id,y(`Llegada registrada ${M(s.t_presentacion)} · ${s.patente||""}`),N()}async function yt(){const e=o.desde,t=o.hasta;o.desde=o.fecha,o.hasta=o.fecha,await Be(),o.desde=e,o.hasta=t}function pe(e){const t=document.createElement("div");t.innerHTML=`<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(600px,100vw)" role="dialog" aria-label="${d(e)}"></aside>`,document.body.appendChild(t);const s=t.querySelector(".sv-dr"),a=f=>{f.key==="Escape"&&!document.querySelector(".sv-cf-bg")&&(f.preventDefault(),n())},n=()=>{document.removeEventListener("keydown",a,!0),t.remove()};return document.addEventListener("keydown",a,!0),t.querySelector(".sv-dr-bg").addEventListener("click",n),{dr:s,cerrar:n}}const C=(e,t,s,a="",n="")=>`<label class="pt-f ${n}"><span>${e}</span><input id="${t}" value="${d(s??"")}" ${a}></label>`;async function xt(e){const{dr:t,cerrar:s}=pe("Confirmar llegada de troncal"),a=z(e),n=[],f=w(e.retiros).length>0,l=()=>{t.innerHTML=`
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
        <div class="sv-dr-k">${W(e)?"Rampla a cliente · confirmar datos":"Llegada de troncal · confirmar datos"}</div>
        <div class="sv-dr-t">${d(e.contraparte||"")}</div>
        <div class="sv-dr-s">${a?`Citación ${d(a.txt)}${a.bloque?" · bloque "+a.bloque:""}`:"Sin horario solicitado"}${e.plan_ref?.camion!=null?` · camión ${d(e.plan_ref.camion)} · ${E(e.plan_ref.ton,1)} t`:""}</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div class="pt-match"><div><div class="pt-sub" style="margin:0">Patente coordinada</div>
          <div style="font-family:var(--sv-mono);font-size:26px;font-weight:700">${d(e.patente||"— sin patente —")}</div>
          ${e.chofer_nombre?`<div class="pt-sub">Chofer coordinado: ${d(e.chofer_nombre)}</div>`:""}</div>
          <button type="button" class="sv-btn" id="f-ok">Coincide todo</button></div>
        ${f?`<div class="pt-band" style="border:1px solid #f0dcb0;border-radius:8px;padding:10px 12px">
          <span class="material-symbols-outlined" style="font-size:18px">merge</span>
          <div style="flex:1;min-width:0"><b>Viene con retiro de fábrica</b> · ${w(e.retiros).map(h=>d(h.proveedor||"")+" · OC "+d(h.doc_compr)).join(" · ")}
            <div class="pt-sub" style="color:#5a3b00">Mismo camión planificado para retirar y consolidar en el CD: queda como una sola línea. Registre las guías del proveedor.</div></div></div>
          <div>
            <div class="sv-dr-sect">Guías del proveedor</div>
            <div class="pt-docs" id="f-gl">${n.length?n.map((h,b)=>`<span class="pt-doc"><b>GUÍA</b>${d(h.numero)}<button type="button" data-delg="${b}"><span class="material-symbols-outlined">close</span></button></span>`).join(""):'<span class="pt-sub">Sin guías registradas aún.</span>'}</div>
            <div class="pt-docadd" style="margin-top:8px"><input id="f-gnum" class="pt-mono" placeholder="N° de guía (varias separadas por coma)" autocomplete="off"><button type="button" class="sv-btn" id="f-gadd">Agregar</button></div>
          </div>`:""}
        <div>
          <div class="sv-dr-sect">Datos del camión que llegó</div>
          <div class="pt-grid">
            ${C("Patente camión *","f-pat",e.patente,'class="is-mono" autocomplete="off" placeholder="AA-BB-12"')}
            ${C("Patente carro","f-car",e.patente_carro,'class="is-mono" autocomplete="off"')}
            ${C("Nombre del chofer","f-cho",e.chofer_nombre,'autocomplete="off"',"full")}
            ${C("RUT chofer","f-rut",e.chofer_rut,'autocomplete="off"')}
            ${C("Teléfono","f-tel",e.chofer_telefono,'autocomplete="off"')}
            ${C("Transportista","f-tra",e.transportista,"readonly","full")}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Romana (opcional ahora)</div>
          <div class="pt-grid">
            ${C("Peso de entrada (kg)","f-tara","",'inputmode="decimal" class="pt-mono" placeholder="se exige al ingresar"')}
            ${C("Peso según guías (kg)","f-guias","",'inputmode="decimal" class="pt-mono"')}
          </div>
          <div class="pt-sub" style="margin-top:6px">El peso de entrada es obligatorio para marcar el ingreso al patio; el de salida se pide al salir.</div>
        </div>
      </div>
      <div class="sv-dr-f"><div></div><div style="display:flex;gap:6px">
        <button class="sv-btn" data-x>Cancelar</button>
        <button class="sv-btn-p" id="f-save"><span class="material-symbols-outlined">login</span>Registrar llegada</button></div></div>`,t.querySelectorAll("[data-x]").forEach(h=>h.addEventListener("click",s)),t.querySelector("#f-ok")?.addEventListener("click",()=>t.querySelector("#f-save").click());const u=()=>{const h=(t.querySelector("#f-gnum")?.value||"").split(/[,;\s]+/).map(b=>b.trim()).filter(Boolean);h.length&&(h.forEach(b=>{n.some($=>$.numero===b)||n.push({numero:b,proveedor:w(e.retiros)[0]?.proveedor||null,doc_compr:w(e.retiros)[0]?.doc_compr||null})}),l(),t.querySelector("#f-gnum")?.focus())};t.querySelector("#f-gadd")?.addEventListener("click",u),t.querySelector("#f-gnum")?.addEventListener("keydown",h=>{h.key==="Enter"&&(h.preventDefault(),u())}),t.querySelectorAll("[data-delg]").forEach(h=>h.addEventListener("click",()=>{n.splice(+h.dataset.delg,1),l()})),t.querySelector("#f-save").addEventListener("click",v)},r=u=>t.querySelector("#"+u)?.value?.trim()??"";async function v(){const u=H(r("f-pat"));if(!u)return y("Ingrese la patente del camión que llegó","error");if(!de(u)&&!await ne(`¿Continuar con la patente ${u}?

No tiene el formato AA-BB-12 / AA-12-34.`,{aceptar:"Continuar"}))return;const h=t.querySelector("#f-save");h.disabled=!0;const b=xe(e);b.patente=u,b.patente_carro=r("f-car")?H(r("f-car")):null,b.chofer_nombre=r("f-cho")||null,b.chofer_rut=r("f-rut")||null,b.chofer_telefono=r("f-tel")||null,b.guias_proveedor=n,b.tara_kg=T(r("f-tara")),b.peso_guias_kg=T(r("f-guias")),b.datos_confirmados_at=new Date().toISOString();const{data:$,error:O}=await k.rpc("fn_porteria_registrar",{p:b,p_hito:"presentacion"});if(h.disabled=!1,O)return y(D(O),"error");o.visitas.push($),e.visita_id=$.id,s(),y(`Llegada registrada ${M($.t_presentacion)} · ${$.patente}`),N()}l(),t.querySelector("#f-pat")?.focus()}async function Me(){await ce();const{dr:e,cerrar:t}=pe("Registrar cliente que retira");let s=!0;const a=()=>{e.innerHTML=`
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
        <div class="sv-dr-k">Cliente retira · sin agenda</div>
        <div class="sv-dr-t">Registrar quien viene a retirar</div>
        <div class="sv-dr-s">Los campos con * son obligatorios para abrir el reloj.</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div>
          <div class="sv-dr-sect">Pedido</div>
          <div class="pt-grid">
            ${C("N° pedido de ventas *","f-nv","",'inputmode="numeric" class="pt-mono" autocomplete="off"')}
            ${C("Cliente *","f-cli","",'autocomplete="off"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Quien retira</div>
          <div class="pt-grid">
            ${C("Nombre completo *","f-rnom","",'autocomplete="off"',"full")}
            ${C("RUT *","f-rrut","",'autocomplete="off" class="pt-mono"')}
            ${C("Teléfono","f-rtel","",'autocomplete="off" class="pt-mono"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Vehículo</div>
          <div class="pt-grid">
            ${C("Patente vehículo *","f-pat","",'class="is-mono" autocomplete="off" placeholder="AA-BB-12"')}
            ${C("Patente carro","f-car","",'class="is-mono" autocomplete="off" placeholder="opcional"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Transportista y chofer</div>
          <label class="pt-f"><span>Transportista *</span>
            <input id="f-tra" list="pt-tra" value="Particular del cliente" autocomplete="off">
            <datalist id="pt-tra"><option value="Particular del cliente"></option>${(o.proveedores||[]).slice(0,0).map(r=>"").join("")}</datalist></label>
          <label class="pt-chk" for="f-mismo" style="margin-top:10px">
            <input type="checkbox" id="f-mismo" ${s?"checked":""}>
            <span><b>Quien retira es el mismo chofer</b><span>Copia el nombre y el RUT de arriba a los datos del chofer; si lo desmarcas, se piden por separado.</span></span></label>
          <div class="pt-grid" style="margin-top:10px">
            ${C("Nombre del chofer","f-cho","",s?"readonly":'autocomplete="off"',"full")}
            ${C("RUT del chofer","f-crut","",s?"readonly":'autocomplete="off" class="pt-mono"')}
            ${C("Guía de despacho","f-guia","",'class="pt-mono" autocomplete="off" placeholder="se agrega a la salida"')}
          </div>
        </div>
      </div>
      <div class="sv-dr-f"><div class="pt-sub">La hora de presentación la pone el servidor al confirmar.</div>
        <div style="display:flex;gap:6px"><button class="sv-btn" data-x>Cancelar</button>
        <button class="sv-btn-p" id="f-save"><span class="material-symbols-outlined">login</span>Registrar presentación</button></div></div>`,e.querySelectorAll("[data-x]").forEach(r=>r.addEventListener("click",t)),e.querySelector("#f-mismo").addEventListener("change",r=>{s=r.target.checked;const v=e.querySelector("#f-rnom").value,u=e.querySelector("#f-rrut").value,h=e.querySelector("#f-cho"),b=e.querySelector("#f-crut");h.readOnly=b.readOnly=s,s&&(h.value=v,b.value=u)});const l=()=>{s&&(e.querySelector("#f-cho").value=e.querySelector("#f-rnom").value,e.querySelector("#f-crut").value=e.querySelector("#f-rrut").value)};e.querySelector("#f-rnom").addEventListener("input",l),e.querySelector("#f-rrut").addEventListener("input",l),e.querySelector("#f-save").addEventListener("click",f)},n=l=>e.querySelector("#"+l)?.value?.trim()??"";async function f(){const l=[];if(n("f-nv")||l.push("N° de pedido de ventas"),n("f-cli")||l.push("cliente"),n("f-rnom")||l.push("nombre de quien retira"),n("f-rrut")||l.push("RUT de quien retira"),n("f-pat")||l.push("patente del vehículo"),n("f-tra")||l.push("transportista"),l.length)return y("Falta "+l.join(", ")+".","error");const r=H(n("f-pat"));if(!de(r)&&!await ne(`¿Continuar con la patente ${r}?`,{aceptar:"Continuar"}))return;const v=e.querySelector("#f-save");v.disabled=!0;const u=[{tipo:"NV",numero:n("f-nv")}];n("f-guia")&&u.push({tipo:"GUIA",numero:n("f-guia")});const h={tipo:"RETIRO_CLIENTE",fecha:o.fecha,patente:r,patente_carro:n("f-car")?H(n("f-car")):null,chofer_nombre:n(s?"f-rnom":"f-cho")||null,chofer_rut:n(s?"f-rrut":"f-crut")||null,transportista:n("f-tra"),contraparte:n("f-cli"),documentos:u,pedido_venta:n("f-nv"),retira_nombre:n("f-rnom"),retira_rut:n("f-rrut"),retira_telefono:n("f-rtel")||null,retira_es_chofer:s,fuera_agenda:!0,origen:"MANUAL"},{data:b,error:$}=await k.rpc("fn_porteria_registrar",{p:h,p_hito:"presentacion"});if(v.disabled=!1,$)return y(D($),"error");o.visitas.push(b),t(),y(`Retiro registrado ${M(b.t_presentacion)} · ${b.patente}`),o.tab="RETIRO_CLIENTE",N()}a(),e.querySelector("#f-nv")?.focus()}async function Et(e){if(!e)return;const{dr:t,cerrar:s}=pe("Registrar retorno de despacho"),a=w(e.documentos).filter(v=>v.tipo==="ENTREGA"),n=new Set;let f=!0;const l=()=>{const v=T(t.querySelector("#f-bi")?.value)??null,u=he(e),h=v!=null&&e.tara_kg!=null?v-e.tara_kg:null,b=[...n].reduce(($,O)=>$+(T(t.querySelector(`#f-kg-${O}`)?.value)??0),0);t.innerHTML=`
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
        <div class="sv-dr-k">Despacho a cliente · retorno</div>
        <div class="sv-dr-t" style="font-family:var(--sv-mono)">${d(e.patente||"")}</div>
        <div class="sv-dr-s">${d(e.chofer_nombre||"")} · salió ${M(e.t_salida)} con ${a.length} entrega(s)</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div>
          <div class="sv-dr-sect">Ingreso y romana</div>
          <div class="pt-grid">
            ${C("Peso de ingreso, bruto (kg) *","f-bi",v??"",'inputmode="decimal" class="pt-mono"')}
            <div class="pt-f"><span>Cálculo</span><div class="pt-calc" style="padding:8px 0">
              ${e.tara_kg!=null?`Tara <b>${E(e.tara_kg)} kg</b><br>`:"Sin tara registrada<br>"}
              ${u?`Carga que salió <b>${E(u.carga)} kg</b> · guías ${E(u.guias)} kg<br>`:""}
              ${h!=null?`Vuelve con <b style="color:${h>50?"#b5000b":"#15803d"}">${E(h)} kg</b>`:"Ingrese el peso de ingreso"}</div></div>
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">¿Vuelve con alguna entrega?</div>
          <div class="sv-seg" style="display:inline-flex">
            <button type="button" data-cc="0" class="${f?"":"is-on"}">No, volvió vacío</button>
            <button type="button" data-cc="1" class="${f?"is-on":""}">Sí, trae carga</button></div>
        </div>
        ${f?`<div>
          <div class="sv-dr-sect">Marca las entregas que vuelven al CD</div>
          ${a.length?a.map(($,O)=>`<label class="pt-ent ${n.has(O)?"is-on":""}" for="f-e-${O}">
              <input type="checkbox" id="f-e-${O}" data-ent="${O}" ${n.has(O)?"checked":""}>
              <span style="min-width:0"><b>${d($.numero)}</b></span>
              <em><input id="f-kg-${O}" class="pt-mono" placeholder="kg" value="${d($.kg??"")}" inputmode="decimal" style="width:88px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 7px" ${n.has(O)?"":"disabled"}></em></label>`).join(""):'<div class="pt-sub">Este camión no tiene entregas registradas: agréguelas con el lápiz de la fila.</div>'}
          ${n.size?`<div class="pt-calc" style="margin-top:8px">Marcado <b>${E(b)} kg</b>${h!=null?` · el camión trae <b>${E(h)} kg</b>${Math.abs(b-h)>100?' <span style="color:#b5000b">— no cuadra</span>':' <span style="color:#15803d">— cuadra</span>'}`:""}</div>`:""}
          <label class="pt-f" style="margin-top:12px"><span>Motivo de la devolución</span>
            <select id="f-mot">${Ke.map($=>`<option>${d($)}</option>`).join("")}</select></label>
        </div>`:""}
        <label class="pt-f"><span>Observación</span><textarea id="f-obs" rows="2">${d(e.obs||"")}</textarea></label>
      </div>
      <div class="sv-dr-f"><div class="pt-sub">La hora de ingreso la pone el servidor.</div>
        <div style="display:flex;gap:6px"><button class="sv-btn" data-x>Cancelar</button>
        <button class="sv-btn-p" id="f-save"><span class="material-symbols-outlined">login</span>Registrar retorno</button></div></div>`,t.querySelectorAll("[data-x]").forEach($=>$.addEventListener("click",s)),t.querySelectorAll("[data-cc]").forEach($=>$.addEventListener("click",()=>{f=$.dataset.cc==="1",f||n.clear(),l()})),t.querySelectorAll("[data-ent]").forEach($=>$.addEventListener("change",()=>{const O=+$.dataset.ent;$.checked?n.add(O):n.delete(O),l()})),t.querySelector("#f-bi")?.addEventListener("change",l),t.querySelector("#f-save").addEventListener("click",r)};async function r(){const v=T(t.querySelector("#f-bi").value);if(v==null)return y("Registre el peso de ingreso del camión.","error");if(f&&!n.size)return y("Marque qué entrega vuelve al CD, o indique que volvió vacío.","error");const u=t.querySelector("#f-save");u.disabled=!0;const h=[...n].map(i=>({n_entrega:a[i].numero,kg:T(t.querySelector(`#f-kg-${i}`)?.value)})),b={bruto_ingreso_kg:v,entregas_devueltas:h,motivo_devolucion:h.length&&t.querySelector("#f-mot")?.value||null,obs:t.querySelector("#f-obs").value.trim()||null},{error:$}=await k.from("porteria_visitas").update(b).eq("id",e.id);if($)return u.disabled=!1,y(D($),"error");const{data:O,error:_}=await k.rpc("fn_porteria_marcar",{p_id:e.id,p_hito:"regreso"});if(u.disabled=!1,_)return y(D(_),"error");oe({...e,...b,...O}),s(),y(`Retorno registrado ${M(O.t_regreso)} · ${O.patente}${h.length?" · "+h.length+" entrega(s) de vuelta":""}`),N()}l(),t.querySelector("#f-bi")?.focus()}async function At(e){if(!e)return;const t=await ee(`Guías del proveedor · ${e.patente||""}

${w(e.retiros).map(l=>"OC "+l.doc_compr).join(" · ")}

N° de guía (varias separadas por coma).`,{aceptar:"Agregar",placeholder:"Ej: 884120, 884121",icono:"receipt_long"});if(t===null)return;const s=String(t).split(/[,;\s]+/).map(l=>l.trim()).filter(Boolean);if(!s.length)return;const a=w(e.guias_proveedor).slice();s.forEach(l=>{a.some(r=>r.numero===l)||a.push({numero:l,proveedor:w(e.retiros)[0]?.proveedor||null,doc_compr:w(e.retiros)[0]?.doc_compr||null})});const{data:n,error:f}=await k.from("porteria_visitas").update({guias_proveedor:a}).eq("id",e.id).select(F).single();if(f)return y(D(f),"error");oe(n),y(`${s.length} guía(s) registrada(s)`),N()}async function kt(){await ce();const{dr:e,cerrar:t}=pe("Agregar cita de proveedor");e.innerHTML=`
    <div class="sv-dr-h"><div style="flex:1;min-width:0">
      <div class="sv-dr-k">Agenda de proveedores · ${J(o.fecha)}</div>
      <div class="sv-dr-t">Agregar cita</div>
      <div class="sv-dr-s">Queda en la pestaña Proveedores, en su bloque de horario.</div></div>
      <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="sv-dr-b">
      <div class="pt-grid">
        <label class="pt-f full"><span>Proveedor *</span><input id="a-prov" list="a-dl" autocomplete="off"><datalist id="a-dl">${(o.proveedores||[]).map(a=>`<option value="${d(a)}">`).join("")}</datalist></label>
        <label class="pt-f"><span>Bloque de horario</span><select id="a-blo"><option value="">— Sin bloque —</option>${o.bloques.map(a=>`<option value="${a.bloque}">Bloque ${a.bloque} · ${a.desde}–${a.hasta}</option>`).join("")}</select></label>
        ${C("Hora (si no usa bloque)","a-hora","",'type="time"')}
        ${C("Orden de compra","a-oc","",'class="pt-mono" autocomplete="off"')}
        ${C("Patente","a-pat","",'class="is-mono" autocomplete="off"')}
        ${C("Transportista","a-tra","",'autocomplete="off"',"full")}
        <label class="pt-f full"><span>Observación</span><textarea id="a-obs" rows="2"></textarea></label>
      </div>
    </div>
    <div class="sv-dr-f"><div></div><div style="display:flex;gap:6px">
      <button class="sv-btn" data-x>Cancelar</button><button class="sv-btn-p" id="a-save">Agregar a la agenda</button></div></div>`,e.querySelectorAll("[data-x]").forEach(a=>a.addEventListener("click",t));const s=a=>e.querySelector("#"+a)?.value?.trim()??"";e.querySelector("#a-save").addEventListener("click",async()=>{if(!s("a-prov"))return y("Indique el proveedor","error");const a={fecha:o.fecha,centro:U,proveedor:s("a-prov"),doc_compr:s("a-oc")||null,bloque:s("a-blo")?Number(s("a-blo")):null,hora_presentacion:s("a-blo")?null:s("a-hora")||null,patente:s("a-pat")?H(s("a-pat")):null,transportista:s("a-tra")||null,obs:s("a-obs")||null},{error:n}=await k.from("porteria_agenda_proveedor").insert(a);if(n)return y(D(n),"error");t(),y("Cita agregada a la agenda del día"),await Q(),o.tab="PROVEEDOR",N()}),e.querySelector("#a-prov")?.focus()}async function je(e){if(o.q=e||"",o.q.replace(/[^A-Za-z0-9]/g,"").length<2){o.busq=null,Ee();return}const{data:t,error:s}=await k.rpc("fn_porteria_buscar",{p_q:o.q,p_centro:U});if(s){y("Error en la búsqueda: "+s.message,"error");return}o.busq=t||null,Ee()}function Ee(){const e=S?.querySelector("#pt-busq");e&&(e.innerHTML=o.busq?ze():"",e.querySelectorAll("[data-irv]").forEach(t=>t.addEventListener("click",()=>wt(+t.dataset.irv))),e.querySelectorAll("[data-ire]").forEach(t=>t.addEventListener("click",()=>St(t.dataset.ire))),e.querySelector("#pt-bcerrar")?.addEventListener("click",()=>{o.busq=null,o.q="";const t=S.querySelector("#pt-q");t&&(t.value=""),Ee()}),e.querySelectorAll("[data-nuevo]").forEach(t=>t.addEventListener("click",()=>{o.tab=t.dataset.nuevo,o.busq=null,N(),t.dataset.nuevo==="RETIRO_CLIENTE"?Me():V(null,t.dataset.nuevo)})))}function ze(){const e=o.busq,t=w(e.esperados),s=w(e.visitas),a=w(e.historial),n=t.length||s.length,f=(r,v,u,h)=>`<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--sv-line)">
    <div style="min-width:0"><div style="font-size:15px;font-weight:700">${r}</div><div class="pt-sub">${v}</div>
      ${u?`<div class="pt-tags">${u}</div>`:""}</div>${h}</div>`;let l=`<div class="sv-card" style="margin-bottom:16px">
    <div class="pt-ch"><h2><span class="material-symbols-outlined">search</span>${d(e.q||"")}
      <small>${n?`${t.length} programado(s) · ${s.length} registrado(s)`:"sin coincidencias de hoy"}</small></h2>
      <button class="sv-btn is-icon" id="pt-bcerrar" title="Cerrar búsqueda"><span class="material-symbols-outlined">close</span></button></div>`;return t.forEach(r=>{const v=z(r);l+=f(`${d(r.patente||"— sin patente")} <span style="font-weight:600;font-size:13px">${d(r.contraparte||"")}</span>`,`${R[r.tipo]?.label||r.tipo}${W(r)?" · rampla a cliente":""} · ${v?"citación "+d(v.txt):"sin horario"}${r.chofer_nombre?" · "+d(r.chofer_nombre):""}`,`${r.consolida_retiro?'<span class="pt-tag miss">Viene con retiro de fábrica</span>':""}${w(r.retiros).map(u=>`<span class="pt-tag">OC ${d(u.doc_compr)}</span>`).join("")}`,r.visita_id?`<button class="sv-btn" data-irv="${r.visita_id}">Ver registro</button>`:`<button class="sv-btn-p" data-ire="${d(r.clave)}">Registrar llegada</button>`)}),s.forEach(r=>{const v=be(r);l+=f(`${d(r.patente||"")} <span style="font-weight:600;font-size:13px">${d(r.contraparte||"")}</span>`,`${R[r.tipo]?.label||r.tipo} · ${(te[r.estado]||[r.estado])[0]} · ${J(r.fecha)} · llegada ${M(r.t_presentacion)||"—"} · ingreso ${M(r.t_ingreso)||"—"} · salida ${M(r.t_salida)||"—"}${v.min!=null?` · ${d(v.que)} ${L(v.min)}`:""}`,`${r.pedido_venta?`<span class="pt-tag">NV ${d(r.pedido_venta)}</span>`:""}${w(r.documentos).slice(0,4).map(u=>`<span class="pt-tag">${d(u.tipo)} ${d(u.numero)}</span>`).join("")}`,`<button class="sv-btn" data-irv="${r.id}">Abrir</button>`)}),n||(l+=`<div style="padding:16px">
      <div style="font-size:15px;font-weight:700">No hay nada programado hoy para «${d(e.q||"")}»</div>
      <div class="pt-sub">No aparece en el plan de carga, ni en la agenda de proveedores, ni en retiros de fábrica. Regístralo según lo que venga a hacer: queda marcado fuera de agenda y avisa al monitor de Operaciones.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="sv-btn" data-nuevo="PROVEEDOR">Proveedor sin agenda</button>
        <button class="sv-btn" data-nuevo="RETIRO_CLIENTE">Cliente retira</button>
        <button class="sv-btn" data-nuevo="TRONCAL">Troncal sin plan</button>
        <button class="sv-btn" data-nuevo="DESPACHO_EBEMA">Despacho a cliente</button></div></div>`),a.length&&(l+=`<div class="pt-sect">Historial de esta patente<span>últimas ${a.length} visitas</span></div>
      <div class="sv-tablewrap"><table class="sv-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Contraparte</th><th class="r">Espera</th><th class="r">Permanencia</th><th class="r">Neto romana</th></tr></thead><tbody>
      ${a.map(r=>`<tr style="cursor:default"><td class="pt-mono">${J(r.fecha)}</td><td>${K(r.tipo)}</td><td>${d(r.contraparte||"")}</td>
        <td class="r pt-mono">${L(r.espera)}</td><td class="r pt-mono">${L(r.tipo==="DESPACHO_EBEMA"?r.ruta:r.permanencia)}</td>
        <td class="r pt-mono">${r.neto_kg!=null?E(r.neto_kg)+" kg":"—"}</td></tr>`).join("")}</tbody></table></div>`),l+"</div>"}async function St(e){o.fecha!==j()&&(o.fecha=j(),await Q());const t=o.esperados.find(s=>s.clave===e);if(!t)return y("Ese camión ya no está en los esperados de hoy.","error");o.tab=t.tipo,o.busq=null,o.q="",N(),t.visita_id||Ie(t)}async function wt(e){const t=o.visitas.find(n=>n.id===e);if(t)return o.tab=t.tipo,o.busq=null,o.q="",N(),V(t);const{data:s,error:a}=await k.from("porteria_visitas").select(F).eq("id",e).single();if(a)return y(D(a),"error");V(s)}async function V(e,t){await ce();const s=!e,a=e?JSON.parse(JSON.stringify(e)):{tipo:t||o.tab||"TRONCAL",subtipo:(t||o.tab)==="DESPACHO_EBEMA"?"GENERAL":null,documentos:[],retiros:[]};let n=null;const f=document.createElement("div");f.innerHTML='<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(600px,100vw)" role="dialog" aria-label="Registro portería"></aside>',document.body.appendChild(f);const l=f.querySelector(".sv-dr"),r=()=>{document.removeEventListener("keydown",v,!0),f.remove()},v=p=>{p.key==="Escape"&&!document.querySelector(".sv-cf-bg")&&(p.preventDefault(),r())};document.addEventListener("keydown",v,!0),f.querySelector(".sv-dr-bg").addEventListener("click",r);const u=(p,c,q,g="",A="")=>`<label class="pt-f ${A}"><span>${p}</span><input id="${c}" value="${d(q??"")}" ${g}></label>`,h=()=>{const p=R[a.tipo],c=a.tipo==="DESPACHO_EBEMA",q=a.tipo==="TRONCAL"?(o.centros||[]).map(g=>g.nombre):a.tipo==="PROVEEDOR"?o.proveedores||[]:[];l.innerHTML=`
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">${s?"Registrar camión":`Visita #${a.id} · ${J(a.fecha)}`}</div>
          <div class="sv-dr-t">${d(a.patente||"Nuevo registro")}</div>
          <div class="sv-dr-s">${s?"CD Quilicura (1003)":`${We(a.estado)} · ${d(a.origen||"MANUAL")}${a.updated_by?` · editado por ${d(a.updated_by)}`:""}`}</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div>
          <div class="sv-dr-sect">Tipo de movimiento</div>
          <div class="sv-seg" style="flex-wrap:wrap">${Object.entries(R).map(([g,A])=>`<button type="button" data-tipo="${g}" class="${a.tipo===g?"is-on":""}"><span class="material-symbols-outlined">${A.icon}</span>${A.label}</button>`).join("")}</div>
          ${c?`<div class="sv-seg" style="margin-top:8px;display:inline-flex">${["GENERAL","FIERRO"].map(g=>`<button type="button" data-sub="${g}" class="${(a.subtipo||"GENERAL")===g?"is-on":""}">${g==="GENERAL"?"Despacho general":"Fierro"}</button>`).join("")}</div>`:""}
          <div class="pt-sub" style="margin-top:6px">Hitos: ${p.hitos.map(g=>G[g]).join(" → ")}</div>
        </div>
        <div id="pt-match"></div>
        <div>
          <div class="sv-dr-sect">Camión y chofer</div>
          <div class="pt-grid">
            ${u("Patente camión *","f-patente",a.patente,'class="is-mono" autocomplete="off" placeholder="AA-BB-12"')}
            ${u("Patente carro","f-carro",a.patente_carro,'class="is-mono" autocomplete="off"')}
            ${u("Nombre chofer","f-chofer",a.chofer_nombre,'autocomplete="off"')}
            ${u("RUT chofer","f-rut",a.chofer_rut,'autocomplete="off"')}
            ${u("Teléfono","f-tel",a.chofer_telefono,'autocomplete="off"')}
            ${u("Transportista","f-transp",a.transportista,'autocomplete="off"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">${p.contra} y documentos</div>
          <div class="pt-grid">
            ${a.tipo==="TRONCAL"?`<label class="pt-f full"><span>${p.contra}</span><select id="f-ce"><option value="">— Seleccionar —</option>${(o.centros||[]).map(g=>`<option value="${d(g.id)}" ${a.ce===g.id?"selected":""}>${d(g.nombre)} (${d(g.id)})</option>`).join("")}</select></label>`:`${u(p.contra,"f-contra",a.contraparte,'list="pt-dl" autocomplete="off"',a.tipo==="PROVEEDOR"?"":"full")}<datalist id="pt-dl">${q.map(g=>`<option value="${d(g)}">`).join("")}</datalist>`}
            ${["PROVEEDOR","TRONCAL"].includes(a.tipo)?u(a.tipo==="TRONCAL"?"Hora citación (presentación)":"Hora agenda","f-agenda",a.hora_agenda?we(a.hora_agenda).slice(11):"",'type="time"'):""}
            ${a.tipo==="TRONCAL"&&z(a)?.hasta?`<div class="pt-f"><span>Bloque solicitado</span><div class="pt-calc" style="padding:8px 0"><b>${d(z(a).txt)}</b></div></div>`:""}
            <div class="pt-f full"><span>Guías / OC / NV / Entregas / DT</span>
              <div class="pt-docs" id="f-docs">${(a.documentos||[]).map((g,A)=>`<span class="pt-doc"><b>${d(g.tipo)}</b>${d(g.numero)}<button type="button" data-deldoc="${A}" title="Quitar"><span class="material-symbols-outlined">close</span></button></span>`).join("")||'<span class="pt-sub">Sin documentos.</span>'}</div>
              <div class="pt-docadd"><select id="f-doctipo">${Je.map(g=>`<option ${g===(c?"GUIA":a.tipo==="PROVEEDOR"?"OC":a.tipo==="RETIRO_CLIENTE"?"NV":"GUIA")?"selected":""}>${g}</option>`).join("")}</select>
                <input id="f-docnum" class="pt-mono" placeholder="N° (varios separados por coma)" autocomplete="off"><button type="button" class="sv-btn" id="f-docadd">Agregar</button></div>
            </div>
            ${(a.retiros||[]).length?`<div class="pt-f full"><span>Retiros de Fábrica vinculados</span><div class="sv-tags" style="margin:0">${a.retiros.map(g=>`<span class="sv-tag mute">OC ${d(g.doc_compr)} · ${d(g.proveedor||"")}</span>`).join("")}</div></div>`:""}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Romana (kg, digitado)</div>
          <div class="pt-grid">
            ${u(c?"Peso salida (cargado)":"Peso entrada",c?"f-bruto":"f-tara",c?a.bruto_kg:a.tara_kg,'inputmode="decimal" class="pt-mono"')}
            ${u(c?"Peso regreso":"Peso salida",c?"f-tara":"f-bruto",c?a.tara_kg:a.bruto_kg,'inputmode="decimal" class="pt-mono"')}
            ${u("Peso según guías","f-guias",a.peso_guias_kg,'inputmode="decimal" class="pt-mono"')}
            <div class="pt-f"><span>Neto / diferencia</span><div class="pt-calc" id="f-calc" style="padding:8px 0"></div></div>
          </div>
        </div>
        ${s?"":`<div>
          <div class="sv-dr-sect">Hitos (corrección manual)</div>
          <div class="pt-grid">${p.hitos.map(g=>u(G[g],"f-h-"+g,we(a["t_"+g]),'type="datetime-local"')).join("")}</div>
          <div class="pt-sub" style="margin-top:6px">Sólo para corregir errores: los hitos se registran con los botones del Reloj Control.</div>
        </div>`}
        <label class="pt-f"><span>Observaciones</span><textarea id="f-obs" rows="2">${d(a.obs||"")}</textarea></label>
      </div>
      <div class="sv-dr-f">
        <div style="display:flex;gap:6px;flex-wrap:wrap">${s?"":`
          ${c?"":'<button class="sv-btn" data-est="NO_SE_PRESENTA">No se presenta</button><button class="sv-btn" data-est="NO_CARGA">No carga</button>'}
          ${["NO_SE_PRESENTA","NO_CARGA","ANULADO"].includes(a.estado)?'<button class="sv-btn" data-est="REABRIR">Reabrir</button>':'<button class="sv-btn" data-est="ANULADO">Anular</button>'}`}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="sv-btn" data-x>Cancelar</button>
          ${s?`<button class="sv-btn" data-save="">Guardar sin hito</button>
            <button class="sv-btn-p" data-save="${c?"salida":"presentacion"}"><span class="material-symbols-outlined">${c?"logout":"login"}</span>Guardar y marcar ${c?"salida":"llegada"}</button>`:'<button class="sv-btn-p" data-save="edit">Guardar cambios</button>'}
        </div>
      </div>`,i(),O(),s&&a.patente&&_(!1)},b=p=>l.querySelector("#"+p)?.value?.trim()??"",$=()=>{if(a.patente=b("f-patente")?H(b("f-patente")):null,a.patente_carro=b("f-carro")?H(b("f-carro")):null,a.chofer_nombre=b("f-chofer")||null,a.chofer_rut=b("f-rut")||null,a.chofer_telefono=b("f-tel")||null,a.transportista=b("f-transp")||null,a.tipo==="TRONCAL"){const p=b("f-ce");a.ce=p||null,a.contraparte=se(a)?a.contraparte||null:p?o.centros.find(c=>c.id===p)?.nombre||p:a.contraparte||null}else l.querySelector("#f-contra")&&(a.contraparte=b("f-contra")||null);if(l.querySelector("#f-agenda")){const p=b("f-agenda");a.hora_agenda=p?Oe(`${a.fecha||o.fecha}T${p}`):null}a.tara_kg=T(b("f-tara")),a.bruto_kg=T(b("f-bruto")),a.peso_guias_kg=T(b("f-guias")),a.obs=b("f-obs")||null,s||R[a.tipo].hitos.forEach(p=>{const c=l.querySelector("#f-h-"+p);c&&(a["t_"+p]=Oe(c.value))})},O=()=>{const p=T(b("f-tara")),c=T(b("f-bruto")),q=T(b("f-guias")),g=l.querySelector("#f-calc");if(!g)return;if(p==null||c==null){g.innerHTML="Faltan pesajes";return}const A=Math.abs(c-p);let B=`Neto <b>${E(A)} kg</b>`;if(q>0){const I=(A-q)/q*100,P=Number(o.metas[a.tipo]?.tolerancia_peso_pct??3);B+=` · <b style="color:${Math.abs(I)>P?"#b5000b":"#15803d"}">${I>0?"+":""}${E(I,1)}%</b> vs guías (tol. ${E(P,1)}%)`}g.innerHTML=B},_=async(p=!0)=>{const c=H(b("f-patente")),q=l.querySelector("#f-patente");if(!c)return;if(q.value=c,q.classList.toggle("is-err",!de(c)),p&&!b("f-chofer")){const{data:I}=await k.from("abast_base_choferes").select("chofer_nombre,chofer_rut,chofer_telefono,transportista,id_transporte,patente_carro").eq("patente",c).order("ultimo_uso",{ascending:!1}).limit(1),P=I?.[0];if(P){const Y=(Ue,Ae)=>{const fe=l.querySelector("#"+Ue);fe&&!fe.value&&Ae&&(fe.value=Ae)};Y("f-chofer",P.chofer_nombre),Y("f-rut",P.chofer_rut),Y("f-tel",P.chofer_telefono),Y("f-transp",P.transportista),Y("f-carro",P.patente_carro),a.id_transporte=a.id_transporte||P.id_transporte||null}}if(!s)return;const g=l.querySelector("#pt-match"),A=o.esperados.find(I=>!I.visita_id&&I.patente===c),B=A&&o.fecha===j()?A.clave+(n===A?"|v":""):"";if(g.dataset.k!==B){if(g.dataset.k=B,!B){g.innerHTML="";return}g.innerHTML=`<div class="pt-match"><div><b>${c}</b> está esperado hoy: ${d(R[A.tipo].label)} ${A.tipo==="TRONCAL"?"a ":""}${d(A.contraparte||"")}
        ${A.consolida_retiro?`<div class="pt-sub">Consolida retiro de fábrica: ${(A.retiros||[]).map(I=>"OC "+d(I.doc_compr)).join(", ")}</div>`:""}</div>
      <button type="button" class="sv-btn" id="pt-vinc">${n===A?"Vinculado ✓":"Vincular"}</button></div>`,g.querySelector("#pt-vinc").addEventListener("click",()=>{$(),n=A;const I=xe(A);Object.keys(I).forEach(P=>{I[P]!=null&&(P!=="documentos"||!(a.documentos||[]).length)&&(a[P]=I[P])}),h()})}},i=()=>{l.querySelectorAll("[data-x]").forEach(c=>c.addEventListener("click",r)),l.querySelectorAll("[data-tipo]").forEach(c=>c.addEventListener("click",()=>{$(),a.tipo=c.dataset.tipo,a.tipo!=="DESPACHO_EBEMA"&&!(a.tipo==="TRONCAL"&&se(a))&&(a.subtipo=null),h()})),l.querySelectorAll("[data-sub]").forEach(c=>c.addEventListener("click",()=>{$(),a.subtipo=c.dataset.sub,h()})),l.querySelector("#f-patente").addEventListener("change",()=>_(!0)),["f-tara","f-bruto","f-guias"].forEach(c=>l.querySelector("#"+c)?.addEventListener("input",O));const p=()=>{const c=b("f-doctipo"),q=b("f-docnum").split(/[,;\s]+/).map(g=>g.trim()).filter(Boolean);q.length&&($(),a.documentos=a.documentos||[],q.forEach(g=>{a.documentos.some(A=>A.tipo===c&&A.numero===g)||a.documentos.push({tipo:c,numero:g})}),h(),l.querySelector("#f-docnum")?.focus())};l.querySelector("#f-docadd").addEventListener("click",p),l.querySelector("#f-docnum").addEventListener("keydown",c=>{c.key==="Enter"&&(c.preventDefault(),p())}),l.querySelectorAll("[data-deldoc]").forEach(c=>c.addEventListener("click",()=>{$(),a.documentos.splice(+c.dataset.deldoc,1),h()})),l.querySelectorAll("[data-save]").forEach(c=>c.addEventListener("click",()=>m(c.dataset.save,c))),l.querySelectorAll("[data-est]").forEach(c=>c.addEventListener("click",()=>x(c.dataset.est)))},m=async(p,c)=>{if($(),!a.patente){y("Ingrese la patente del camión","error"),l.querySelector("#f-patente").focus();return}if(!(!de(a.patente)&&!await ne(`¿Continuar con la patente ${a.patente}?

No tiene el formato AA-BB-12 / AA-12-34.`,{aceptar:"Continuar"}))){if(a.tipo==="TRONCAL"&&!a.contraparte){y("Seleccione la sucursal destino del troncal","error");return}if(c.disabled=!0,s){const q={tipo:a.tipo,subtipo:a.tipo==="DESPACHO_EBEMA"?a.subtipo||"GENERAL":a.tipo==="TRONCAL"&&se(a)?"CD_CLIENTE":null,fecha:o.fecha,patente:a.patente,patente_carro:a.patente_carro,chofer_nombre:a.chofer_nombre,chofer_rut:a.chofer_rut,chofer_telefono:a.chofer_telefono,id_transporte:a.id_transporte||null,transportista:a.transportista,contraparte:a.contraparte,ce:a.ce||null,documentos:a.documentos||[],hora_agenda:a.hora_agenda,tara_kg:a.tara_kg,bruto_kg:a.bruto_kg,peso_guias_kg:a.peso_guias_kg,obs:a.obs,clave_esperado:n?a.clave_esperado:null,plan_ref:n?a.plan_ref:null,retiros:n?a.retiros:[],consolida_retiro:n?!!a.consolida_retiro:!1,origen:n?a.origen:"MANUAL",fuera_agenda:!n,pedido_venta:a.pedido_venta||null,estado:p?"EN_COLA":"PROGRAMADO"},{data:g,error:A}=await k.rpc("fn_porteria_registrar",{p:q,p_hito:p||null});if(c.disabled=!1,A)return y(D(A),"error");o.visitas.push(g),n&&(n.visita_id=g.id),y(p?`${G[p]} registrada ${M(g["t_"+p])} · ${g.patente}`:"Camión registrado")}else{const q={tipo:a.tipo,subtipo:a.tipo==="DESPACHO_EBEMA"?a.subtipo||"GENERAL":a.tipo==="TRONCAL"&&se(a)?"CD_CLIENTE":null,patente:a.patente,patente_carro:a.patente_carro,chofer_nombre:a.chofer_nombre,chofer_rut:a.chofer_rut,chofer_telefono:a.chofer_telefono,transportista:a.transportista,contraparte:a.contraparte,ce:a.ce||null,documentos:a.documentos||[],hora_agenda:a.hora_agenda,tara_kg:a.tara_kg,bruto_kg:a.bruto_kg,peso_guias_kg:a.peso_guias_kg,obs:a.obs,t_presentacion:a.t_presentacion??null,t_ingreso:a.t_ingreso??null,t_salida:a.t_salida??null,t_regreso:a.t_regreso??null};Object.keys(G).forEach(B=>{R[a.tipo].hitos.includes(B)||(q["t_"+B]=null)});const{data:g,error:A}=await k.from("porteria_visitas").update(q).eq("id",a.id).select(F).single();if(c.disabled=!1,A)return y(D(A),"error");oe(g),y("Cambios guardados")}r(),N()}},x=async p=>{const c={NO_SE_PRESENTA:'Marcar "No se presenta"',NO_CARGA:'Marcar "No carga"',ANULADO:"Anular el registro",REABRIR:"Reabrir el registro"}[p];if(!await ne(`¿${c} de ${a.patente||"este camión"}?

${p==="ANULADO"?"No cuenta en los indicadores.":p==="REABRIR"?"El estado vuelve a calcularse desde los hitos.":"Queda registrado para el indicador de cumplimiento."}`,{aceptar:p==="REABRIR"?"Reabrir":"Confirmar",tono:p==="ANULADO"?"peligro":"normal"}))return;const{data:q,error:g}=await k.from("porteria_visitas").update({estado:p==="REABRIR"?"EN_COLA":p}).eq("id",a.id).select(F).single();if(g)return y(D(g),"error");oe(q);const A=o.esperados.find(B=>B.visita_id===a.id);A&&p==="ANULADO"&&(A.visita_id=null),r(),N()};h(),l.querySelector("#f-patente")?.focus()}async function ue(){S.innerHTML='<div class="sv-view pt"><div class="sv-desc">Calculando indicadores…</div></div>';const{data:e,error:t}=await k.rpc("fn_porteria_indicadores",{p_desde:o.desde,p_hasta:o.hasta,p_centro:U});if(t){S.innerHTML=`<div class="sv-view pt"><div class="sv-note-box">Error: ${d(t.message)}</div></div>`;return}o.ind=e||{};const s=o.ind,a=Object.fromEntries((s.por_tipo||[]).map(_=>[_.tipo,_])),n=(_,i)=>i?Math.round(_/i*100):null,f=_=>{const i=R[_],m=a[_]||{n:0},x=_==="DESPACHO_EBEMA",p=x?m.ruta_p50:m.perm_p50,c=x?m.ruta_p90:m.perm_p90,q=o.metas[_]?.meta_min,g=n(m.sobre_meta||0,m.con_metrica||0),A=q==null||p==null?"#9ca3af":p>q?"#b5000b":p>q*.8?"#ca8a04":"#15803d";return`<div class="pt-tile">
      <div class="pt-tile-h">${K(_)}<span class="pt-sub">${E(m.n)} visitas</span></div>
      <div><div class="pt-sub">${x?"Tiempo en ruta":"Permanencia en CD"} · mediana</div>
        <div class="pt-big" style="color:${A}">${L(p)}<small>${q?`meta ${q} min`:"sin meta"}</small></div></div>
      ${q&&m.con_metrica?`<div><div class="pt-bar"><i style="width:${100-g}%;background:#15803d"></i></div><div class="pt-sub">${100-g}% dentro de meta · ${g}% sobre meta</div></div>`:""}
      <div class="pt-kv">
        <span>P90 ${x?"ruta":"permanencia"}</span><span>${L(c)}</span>
        ${x?"":`<span>Espera en portería (p50 / p90)</span><span>${L(m.espera_p50)} / ${L(m.espera_p90)}</span>
        <span>Tiempo total (p50)</span><span>${L(m.total_p50)}</span>`}
        <span>Finalizados / en curso</span><span>${E(m.finalizados||0)} / ${E(m.en_curso||0)}</span>
        ${x?"":`<span>No se presenta / No carga</span><span>${E(m.no_se_presenta||0)} / ${E(m.no_carga||0)}</span>`}
        ${_==="TRONCAL"?`<span>Consolidan retiro de fábrica</span><span>${E(m.consolida||0)}</span>`:""}
        <span>Pesos fuera de tolerancia</span><span>${E(m.fuera_tol||0)} de ${E(m.con_peso||0)}</span>
      </div></div>`},l=Array.from({length:16},(_,i)=>i+6),r=s.por_hora||[],v=Math.max(1,...r.map(_=>_.n)),u=`<table class="pt-heat"><thead><tr><th></th>${l.map(_=>`<th>${_}</th>`).join("")}</tr></thead><tbody>
    ${Object.keys(R).map(_=>`<tr><th>${R[_].label}</th>${l.map(i=>{const m=r.find(p=>p.tipo===_&&p.hora===i)?.n||0,x=m?.12+.78*m/v:0;return`<td style="background:${m?`rgba(181,0,11,${x.toFixed(2)})`:"var(--sv-s1)"};color:${x>.5?"#fff":"var(--sv-ink)"}" title="${R[_].label} · ${i}:00 · ${m}">${m||""}</td>`}).join("")}</tr>`).join("")}</tbody></table>`,h=(s.por_contraparte||[]).slice().sort((_,i)=>i.n-_.n),b=`<table class="sv-table"><thead><tr><th>Tipo</th><th>Contraparte</th><th class="r">Visitas</th><th class="r">Espera p50</th><th class="r">Permanencia / ruta p50</th><th class="r">% sobre meta</th></tr></thead><tbody>
    ${h.length?h.map(_=>{const i=n(_.sobre_meta||0,_.con_metrica||0);return`<tr style="cursor:default"><td>${K(_.tipo)}</td><td>${d(_.contraparte)}</td><td class="r">${E(_.n)}</td>
        <td class="r pt-mono">${_.tipo==="DESPACHO_EBEMA"?'<span class="pt-na">·</span>':L(_.espera_p50)}</td><td class="r pt-mono">${L(_.metrica_p50)}</td>
        <td class="r">${i==null||o.metas[_.tipo]?.meta_min==null?'<span class="pt-na">—</span>':me(i+"%",i>50?"bad":i>20?"warn":"ok")}</td></tr>`}).join(""):'<tr class="sv-empty"><td colspan="6">Sin visitas en el período.</td></tr>'}</tbody></table>`;S.innerHTML=`<div class="sv-view pt">
    <div class="sv-vhead">
      <div><h1 class="sv-h1">Indicadores de Portería</h1>
        <div class="sv-desc">Tiempos de permanencia de camiones en CD Quilicura (1003): espera en portería (presentación → ingreso), permanencia (ingreso → salida) y ruta de despachos Ebema (salida → regreso). Medianas (p50) y percentil 90.</div></div>
      <div class="sv-actions">
        <label class="sv-inp"><span class="material-symbols-outlined">date_range</span><input type="date" id="pi-desde" value="${o.desde}"><span class="sv-sep">→</span><input type="date" id="pi-hasta" value="${o.hasta}"></label>
        <button class="sv-btn" id="pi-csv"><span class="material-symbols-outlined">download</span>Detalle CSV</button>
      </div>
    </div>
    <div class="pt-tiles">${Object.keys(R).map(f).join("")}</div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">schedule</span>Llegadas por hora <small>presentación en portería · salida en despachos</small></h2></div>
      <div style="padding:12px 16px;overflow-x:auto">${u}</div></div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">leaderboard</span>Por sucursal, proveedor o cliente</h2></div>
      <div class="sv-tablewrap" style="max-height:480px">${b}</div></div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">flag</span>Metas</h2><button class="sv-btn-p" id="pi-metas">Guardar metas</button></div>
      <div class="sv-tablewrap"><table class="sv-table"><thead><tr><th>Tipo</th><th>Métrica</th><th class="r">Meta (min)</th><th class="r">Tolerancia peso (%)</th></tr></thead><tbody>
      ${Object.keys(R).map(_=>`<tr style="cursor:default"><td>${K(_)}</td><td>${_==="DESPACHO_EBEMA"?"Salida → regreso":"Ingreso → salida"}</td>
        <td class="r"><input data-meta="${_}" value="${o.metas[_]?.meta_min??""}" inputmode="numeric" class="pt-mono" style="width:90px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 8px"></td>
        <td class="r"><input data-tol="${_}" value="${o.metas[_]?.tolerancia_peso_pct??3}" inputmode="decimal" class="pt-mono" style="width:90px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 8px"></td></tr>`).join("")}
      </tbody></table></div></div>
  </div>`;const $=_=>S.querySelector(_),O=()=>{o.desde=$("#pi-desde").value||o.desde,o.hasta=$("#pi-hasta").value||o.hasta,o.desde>o.hasta&&([o.desde,o.hasta]=[o.hasta,o.desde]),ue()};$("#pi-desde").addEventListener("change",O),$("#pi-hasta").addEventListener("change",O),$("#pi-csv").addEventListener("click",Be),$("#pi-metas").addEventListener("click",async()=>{const _=Object.keys(R).map(m=>({tipo:m,meta_min:T(S.querySelector(`[data-meta="${m}"]`).value),tolerancia_peso_pct:T(S.querySelector(`[data-tol="${m}"]`).value)??3,updated_at:new Date().toISOString()})),{error:i}=await k.from("porteria_metas").upsert(_,{onConflict:"tipo"});if(i)return y("No se pudieron guardar las metas: "+i.message,"error");await _e(),y("Metas guardadas"),ue()})}async function Be(){const{data:e,error:t}=await k.from("porteria_visitas").select(F).eq("centro",U).gte("fecha",o.desde).lte("fecha",o.hasta).order("fecha").order("created_at").limit(2e4);if(t)return y("Error al descargar: "+t.message,"error");const s=r=>r?new Date(r).toLocaleString("es-CL",{timeZone:ie}):"",a=(r,v)=>{const u=Z(r,v);return u==null?"":Math.round(u)},n=r=>r==null?"":String(r).replace(".",","),f=(e||[]).map(r=>[r.fecha,R[r.tipo]?.label||r.tipo,r.subtipo||"",(te[r.estado]||[r.estado])[0],r.patente||"",r.patente_carro||"",r.chofer_nombre||"",r.chofer_rut||"",r.transportista||"",r.contraparte||"",Xe(r.documentos),(r.retiros||[]).map(v=>v.doc_compr).join(" "),r.consolida_retiro?"SI":"",s(r.hora_agenda),z(r)?.txt||"",Ce(r)?.txt||"",s(r.t_presentacion),s(r.t_ingreso),s(r.t_salida),s(r.t_regreso),a(r.t_presentacion,r.t_ingreso),a(r.t_ingreso,r.t_salida),a(r.t_presentacion,r.t_salida),a(r.t_salida,r.t_regreso),n(r.tara_kg),n(r.bruto_kg),n(r.neto_kg),n(r.peso_guias_kg),r.pedido_venta||"",r.retira_nombre||"",r.retira_rut||"",r.retira_es_chofer?"SI":"",r.fuera_agenda?"SI":"",(Array.isArray(r.guias_proveedor)?r.guias_proveedor:[]).map(v=>v.numero).join(" "),n(r.bruto_ingreso_kg),n(r.bruto_ingreso_kg!=null&&r.tara_kg!=null?r.bruto_ingreso_kg-r.tara_kg:null),(Array.isArray(r.entregas_devueltas)?r.entregas_devueltas:[]).map(v=>v.n_entrega).join(" "),r.motivo_devolucion||"",r.anden||"",r.sin_romana_autorizado?"SI":"",r.origen||"",r.obs||""]),l=["Fecha","Tipo","Subtipo","Estado","Patente","Patente carro","Chofer","RUT chofer","Transportista","Contraparte","Documentos","OC retiro","Consolida retiro","Hora agenda","Horario solicitado","Cumplimiento citación","Presentación","Ingreso","Salida","Regreso","Espera (min)","Permanencia (min)","Total (min)","Ruta (min)","Peso entrada (kg)","Peso salida (kg)","Neto (kg)","Peso guías (kg)","Pedido de venta","Quien retira","RUT quien retira","Retira es chofer","Fuera de agenda","Guías proveedor","Bruto ingreso (kg)","Vuelve con (kg)","Entregas devueltas","Motivo devolución","Andén","Sin romana","Origen","Observaciones"];Ge(`reloj_control_${o.desde}_${o.hasta}.csv`,Ve(l,f))}const He={CRITICA:{k:"Críticas",bg:"#fbe7e8",fg:"#8e0009",dot:"#b5000b",icon:"error"},ALTA:{k:"Altas",bg:"#fbf0dc",fg:"#7a4f00",dot:"#ca8a04",icon:"schedule"},MEDIA:{k:"Medias",bg:"#e7eaef",fg:"#3c4049",dot:"#5b6070",icon:"info"}},Ot={SIN_ATENCION:"hourglass_top",PERMANENCIA:"timer",RUTA:"local_shipping",DEVOLUCION:"keyboard_return",SIN_ROMANA:"scale",NO_SE_PRESENTO:"event_busy",SOBRECUPO:"groups",FUERA_AGENDA:"factory",DATOS_DISTINTOS:"compare_arrows",PESAJE_INCOMPLETO:"scale",PESO_FUERA_TOL:"balance",ABIERTO_ANTIGUO:"history"};async function X(){S.innerHTML='<div class="sv-view pt"><div class="sv-desc">Leyendo alertas de portería…</div></div>';const{data:e,error:t}=await k.rpc("fn_porteria_alertas",{p_centro:U});if(t){S.innerHTML=`<div class="sv-view pt"><div class="sv-note-box">Error: ${d(t.message)}</div></div>`;return}o.alertas=e||{};const s=o.alertas,a=w(s.alertas),n=s.resumen||{},f=s.tiempos||{},l=w(s.metas),r=a.filter(i=>i.tipo==="SIN_ATENCION").reduce((i,m)=>Math.max(i,m.minutos||0),0),v=(i,m,x,p)=>`<div class="pt-tile" ${p==="crit"?'style="background:#b5000b;border-color:#b5000b;color:#fff"':""}>
    <div class="sv-kpi-l" style="${p==="crit"?"color:#ffd9db":""}"><i style="background:${p==="crit"?"#fff":"#9a9c99"}"></i>${i}</div>
    <div class="pt-big">${m}</div><div class="pt-sub" style="${p==="crit"?"color:#ffd9db":""};margin:0">${x}</div></div>`,u=a.length?a.map(i=>{const m=He[i.severidad]||He.MEDIA,x=i.tipo==="DEVOLUCION"?`${E(i.kg)} kg`:i.tipo==="PESO_FUERA_TOL"?`${i.pct>0?"+":""}${E(i.pct,1)}%`:i.minutos!=null?L(i.minutos):"",p=[];return i.tipo==="SIN_ATENCION"&&i.visita_id&&p.push(`<button class="sv-btn-p" data-anden="${i.visita_id}">Asignar andén</button>`),i.visita_id&&p.push(`<button class="sv-btn ${p.length?"":"sv-btn-p"}" data-al="${i.visita_id}">${i.tipo==="DEVOLUCION"?"Ver retorno":"Abrir camión"}</button>`),`<div class="pt-al ${i.severidad==="CRITICA"?"is-crit":""}">
      <div class="pt-al-i" style="background:${m.bg};color:${m.fg}"><span class="material-symbols-outlined">${Ot[i.tipo]||m.icon}</span></div>
      <div class="pt-al-b">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          <span class="pt-al-k" style="color:${m.fg}">${d(i.titulo||i.tipo)}</span>
          ${i.escalado?'<span class="pt-tag miss">Escalado al Jefe de Operaciones</span>':""}
          ${i.desde?`<span class="pt-sub pt-mono" style="margin:0">desde ${M(i.desde)}</span>`:""}</div>
        <p class="pt-al-h">${i.patente?`<b>${d(i.patente)}</b>`:""}${i.tipo_visita?K(i.tipo_visita):""}${d(i.contraparte||"")}</p>
        <div class="pt-al-d">${d(i.detalle||"")}${i.umbral?` <span class="pt-sub" style="margin:0">(umbral ${i.umbral}${i.tipo==="PESO_FUERA_TOL"?"%":i.tipo==="SOBRECUPO"?" camiones":" min"})</span>`:""}</div>
        <div class="pt-tags">${i.chofer?`<span class="pt-sub" style="margin:0">Chofer ${d(i.chofer)}</span>`:""}
          ${i.transportista?`<span class="pt-sub" style="margin:0">· ${d(i.transportista)}</span>`:""}
          ${i.anden?`<span class="pt-tag">Andén ${d(i.anden)}</span>`:i.tipo==="SIN_ATENCION"?'<span class="pt-tag miss">Andén sin asignar</span>':""}
          ${w(i.entregas).map(c=>`<span class="pt-tag miss">ENT ${d(c.n_entrega)}${c.kg?" · "+E(c.kg)+" kg":""}</span>`).join("")}</div>
      </div>
      <div class="pt-al-a">${x?`<div class="pt-big" style="color:${m.dot}">${x}</div>`:""}${p.join("")}</div>
    </div>`}).join(""):'<div class="sv-empty" style="padding:28px 16px;text-align:center">Sin alertas abiertas. Todos los camiones del día están dentro de los umbrales.</div>',h=Ze.includes(Fe()),b=(i,m,x=62)=>h?`<input id="${i}" value="${m??""}" inputmode="numeric" class="pt-mono" style="width:${x}px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 7px">`:`<span class="pt-mono" style="font-weight:700">${m??"—"}</span>`,$=w(s.bloques).map(i=>`<div style="padding:12px 16px;border-bottom:1px solid var(--sv-line)">
    <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;font-weight:700">Bloque ${i.bloque}<span class="pt-sub pt-mono" style="margin:0">${d(i.desde)}–${d(i.hasta)}</span></div>
    <div style="display:flex;gap:4px;margin-top:8px">${Array.from({length:Math.max(i.cupo,i.usados)},(m,x)=>`<i style="flex:1;height:8px;border-radius:4px;background:${x<i.usados?x<i.cupo?"#15161a":"#b5000b":"var(--sv-s2)"}"></i>`).join("")}</div>
    <div class="pt-sub">${i.usados} de ${i.cupo} cupos${i.usados>i.cupo?' · <span style="color:#b5000b;font-weight:700">sobrecupo</span>':i.usados===i.cupo?" · completo":" · queda "+(i.cupo-i.usados)}</div></div>`).join(""),O=(i,m,x,p=L)=>{if(m==null)return`<div style="padding:12px 16px;border-bottom:1px solid var(--sv-line)"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${i}</span><b class="pt-mono">—</b></div><div class="pt-sub">sin datos del día</div></div>`;const c=x?m>x?"#b5000b":m>x*.8?"#ca8a04":"#15803d":"#5b6070",q=x?Math.min(100,Math.round(m/(x*1.25)*100)):50;return`<div style="padding:12px 16px;border-bottom:1px solid var(--sv-line)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px"><span>${i}</span><b class="pt-mono" style="color:${c};font-size:15px">${p(m)}</b></div>
      <div class="pt-bar" style="height:8px;position:relative;margin-top:8px"><i style="width:${q}%;background:${c}"></i>${x?'<u style="position:absolute;top:-3px;bottom:-3px;left:80%;width:2px;background:var(--sv-ink);text-decoration:none"></u>':""}</div>
      <div class="pt-sub" style="display:flex;justify-content:space-between"><span>${x?"meta "+x+" min":"sin meta"}</span><span></span></div></div>`};S.innerHTML=`<div class="sv-view pt">
    <div class="sv-vhead">
      <div><h1 class="sv-h1">Alertas de portería · Operaciones</h1>
        <div class="sv-desc">Qué camión está detenido, desde cuándo y quién debe actuar. El reloj corre contra el umbral de cada tipo; a los ${s.escalamiento_min||30} minutos sobre el umbral la alerta escala al Jefe de Operaciones.</div></div>
      <div class="sv-actions">
        <div class="pt-mono" style="padding:9px 12px;border:1px solid var(--sv-line);border-radius:6px;background:#fff">CD Quilicura · ${M(s.ahora)}</div>
        <button class="sv-btn is-icon" id="al-ref" title="Actualizar"><span class="material-symbols-outlined">refresh</span></button>
      </div>
    </div>
    <div class="pt-tiles" style="margin-bottom:16px">
      ${v("Críticas",n.criticas||0,"detenidos sobre umbral o con devolución",(n.criticas||0)>0?"crit":"")}
      ${v("Altas",n.altas||0,"no se presentaron, sobrecupo, sin romana")}
      ${v("Medias",n.medias||0,"fuera de agenda, datos y pesaje")}
      ${v("Peor tiempo sin atención",r?L(r):"—","camión esperando ingreso")}
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1.95fr) minmax(0,1fr);gap:16px;align-items:start" id="al-cols">
      <div class="sv-card">
        <div class="pt-ch"><h2><span class="material-symbols-outlined">notifications_active</span>Alertas abiertas <small>${a.length} · ordenadas por severidad y tiempo sobre el umbral</small></h2></div>
        ${u}
      </div>
      <div>
        <div class="sv-card" style="margin-bottom:16px">
          <div class="pt-ch"><h2><span class="material-symbols-outlined">event_seat</span>Ocupación de bloques</h2></div>
          ${$||'<div class="pt-sub" style="padding:14px 16px">Sin bloques configurados.</div>'}
        </div>
        <div class="sv-card" style="margin-bottom:16px">
          <div class="pt-ch"><h2><span class="material-symbols-outlined">speed</span>Tiempos de hoy <small>mediana de ${f.n||0} camión(es)</small></h2></div>
          ${O("Espera en portería",f.espera_p50,o.metas.TRONCAL?.meta_espera_min)}
          ${O("Permanencia en patio",f.perm_p50,o.metas.TRONCAL?.meta_min)}
          ${O("Ruta de despachos",f.ruta_p50,o.metas.DESPACHO_EBEMA?.meta_min)}
          <div style="padding:12px 16px"><div class="pt-kv"><span>P90 espera</span><span>${L(f.espera_p90)}</span>
            <span>P90 permanencia</span><span>${L(f.perm_p90)}</span>
            <span>Finalizados hoy</span><span>${E(f.finalizados||0)} de ${E(f.n||0)}</span></div></div>
        </div>
        <div class="sv-card">
          <div class="pt-ch"><h2><span class="material-symbols-outlined">tune</span>Umbrales de alerta</h2>${h?'<button class="sv-btn-p" id="al-save">Guardar</button>':'<span class="pt-sub" style="margin:0">Los edita el Jefe de Operaciones</span>'}</div>
          <div class="sv-tablewrap"><table class="sv-table">
            <thead><tr><th>Tipo de visita</th><th class="r">Sin atención</th><th class="r">Permanencia / ruta</th><th class="r">Tol. peso</th></tr></thead>
            <tbody>${Object.keys(R).map(i=>{const m=l.find(x=>x.tipo===i)||{};return`<tr style="cursor:default"><td>${K(i)}</td>
                <td class="r">${i==="DESPACHO_EBEMA"?'<span class="pt-na">·</span>':b("u-e-"+i,m.meta_espera_min)+" min"}</td>
                <td class="r">${b("u-m-"+i,m.meta_min)+" min"}</td>
                <td class="r">${b("u-t-"+i,m.tolerancia_peso_pct,52)+" %"}</td></tr>`}).join("")}
            <tr style="cursor:default"><td colspan="3">Escalamiento al Jefe de Operaciones</td><td class="r">${b("u-esc",s.escalamiento_min)} min</td></tr>
            </tbody></table></div>
          <div class="pt-sub" style="padding:12px 16px">No se presentó, devolución de entrega e ingreso autorizado sin romana alertan de inmediato. La rampla a cliente usa los umbrales de Troncal.</div>
        </div>
      </div>
    </div>
  </div>`;const _=i=>S.querySelector(i);_("#al-ref").addEventListener("click",X),S.querySelectorAll("[data-al]").forEach(i=>i.addEventListener("click",async()=>{const{data:m,error:x}=await k.from("porteria_visitas").select(F).eq("id",+i.dataset.al).single();if(x)return y(D(x),"error");V(m)})),S.querySelectorAll("[data-anden]").forEach(i=>i.addEventListener("click",async()=>{const m=await ee(`Asignar andén

¿En qué andén se atiende este camión?`,{aceptar:"Asignar",placeholder:"Ej: 4",icono:"warehouse"});if(m===null)return;const{error:x}=await k.from("porteria_visitas").update({anden:m.trim()||null}).eq("id",+i.dataset.anden);if(x)return y(D(x),"error");y("Andén asignado"),X()})),_("#al-save")?.addEventListener("click",async()=>{const i=c=>T(_("#"+c)?.value),m=Object.keys(R).map(c=>({tipo:c,meta_min:i("u-m-"+c),meta_espera_min:c==="DESPACHO_EBEMA"?null:i("u-e-"+c),tolerancia_peso_pct:i("u-t-"+c)??3,updated_at:new Date().toISOString()})),[x,p]=await Promise.all([k.from("porteria_metas").upsert(m,{onConflict:"tipo"}),k.from("porteria_config").upsert({clave:"escalamiento_min",valor:i("u-esc")??30,updated_at:new Date().toISOString()},{onConflict:"clave"})]);if(x.error||p.error)return y("No se pudieron guardar los umbrales: "+(x.error||p.error).message,"error");await _e(),y("Umbrales guardados"),X()}),re(),le=setInterval(()=>{if(!$e())return re();document.querySelector(".sv-dr")||document.querySelector(".sv-cf-bg")||X()},6e4)}export{Nt as renderPorteria};
