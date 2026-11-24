import{getDatabase as E,saveDatabase as A,deleteRow as Bt}from"./data.js?v=99b844b255";import{generateSapCode as _t,parseCSV as Nt,showAlert as v,geocodeAddress as _e,escapeHtml as c,toCSV as Ot,downloadFile as jt}from"./utils.js";import{renderLogisticsView as Gt}from"./logistics.js?v=da831b9730";import{renderZonasView as zt,getField as I,normalizeRegionName as Pt,standardizeComuna as qt}from"./zonas-transporte.js?v=ae3cbe6686";import{REGIONES as rt,COMUNAS_POR_REGION as Kt,TIPOS_ZONA as st,GRUPOS_ORIGEN as ge,findRegionByComuna as dt}from"./chile-geo.js";import{confirmar as it}from"./confirmar.js?v=84d7f13f40";const Ft={NORMAL:"bg-surface-container-high text-secondary border border-outline-variant",EXTREMA:"bg-amber-100 text-amber-800 border border-amber-300",ISLA:"bg-blue-100 text-blue-800 border border-blue-300"};async function Ne(s,g){const t=await _e(g);if(!t||!t.lat)throw new Error("No se pudo geolocalizar el destino");const m=`https://router.project-osrm.org/route/v1/driving/${s.lon},${s.lat};${t.lon},${t.lat}?overview=false`,w=await fetch(m);if(!w.ok)throw new Error("Servicio de rutas no disponible");const p=await w.json();if(!p.routes||!p.routes[0])throw new Error("No se encontró ruta por carretera");return{km:Math.round(p.routes[0].distance/1e3),lat:t.lat,lon:t.lon}}function fe(s,g){if(!g)return s.logisticsCentres[0]&&s.logisticsCentres[0].id||null;const t=(s.logisticsCentres||[]).find(m=>String(m.origen_grupo||"").toUpperCase()===String(g).toUpperCase());return t?t.id:s.logisticsCentres[0]&&s.logisticsCentres[0].id||null}function Ht(s){return!s.id_zona_transporte||!s.comuna||!s.region||!s.km||!s.georef_estado}function ae(s,g){s.innerHTML='<option value="">— Sin definir —</option>'+rt.map(t=>`<option value="${c(t)}" ${t===g?"selected":""}>${c(t)}</option>`).join("")}function U(s,g,t){const m=Kt[g]||[];let w='<option value="">— Sin definir —</option>';t&&!m.includes(t)&&(w+=`<option value="${c(t)}" selected>${c(t)} (no estándar)</option>`),w+=m.map(p=>`<option value="${c(p)}" ${p===t?"selected":""}>${c(p)}</option>`).join(""),s.innerHTML=w}let X=null,q="rutas";function to(s){q=s}let xe=!1,ve="";function ye(s){s.innerHTML=`
    <!-- Page Header -->
    <div class="mb-lg">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Rutas de Transporte</h1>
      <p class="font-body-lg text-body-lg text-secondary">Administre las zonas de transporte (destinos), las rutas de despacho y los centros logísticos (CD) de origen.</p>
    </div>

    <!-- Sub-pestañas -->
    <div class="flex gap-sm mb-lg border-b border-outline-variant">
      <button class="rutas-subtab-btn px-md py-sm font-bold text-xs uppercase tracking-wider cursor-pointer border-b-2 transition-all flex items-center gap-xs ${q==="rutas"?"border-primary text-primary":"border-transparent text-secondary hover:text-primary"}" data-subtab="rutas">
        <span class="material-symbols-outlined text-[18px]">route</span> Rutas
      </button>
      <button class="rutas-subtab-btn px-md py-sm font-bold text-xs uppercase tracking-wider cursor-pointer border-b-2 transition-all flex items-center gap-xs ${q==="zonas"?"border-primary text-primary":"border-transparent text-secondary hover:text-primary"}" data-subtab="zonas">
        <span class="material-symbols-outlined text-[18px]">map</span> Zonas de Transporte
      </button>
      <button class="rutas-subtab-btn px-md py-sm font-bold text-xs uppercase tracking-wider cursor-pointer border-b-2 transition-all flex items-center gap-xs ${q==="centros"?"border-primary text-primary":"border-transparent text-secondary hover:text-primary"}" data-subtab="centros">
        <span class="material-symbols-outlined text-[18px]">location_on</span> Centros Logísticos
      </button>
    </div>

    <div id="rutas-subview-content"></div>
  `,s.querySelectorAll(".rutas-subtab-btn").forEach(t=>{t.addEventListener("click",()=>{q=t.getAttribute("data-subtab"),ye(s)})});const g=document.getElementById("rutas-subview-content");q==="centros"?Gt(g):q==="zonas"?zt(g):he(g)}function he(s){const g=E(),t=g.routes,m=g.transportZones||[],w=t.length,p=t.filter(e=>e.activo).length,x=t.filter(e=>e.estado_erp).length,y=t.filter(e=>!e.georef_estado).length;s.innerHTML=`
    <!-- Tarjetas de Estadísticas KPI -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-lg mb-xl">
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Rutas</h4>
          <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${w}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-secondary">route</span>
      </div>
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Rutas Activas</h4>
          <div class="font-headline-md text-headline-md font-bold text-green-700 mt-1">${p}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-green-600">check_circle</span>
      </div>
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Creadas en ERP</h4>
          <div class="font-headline-md text-headline-md font-bold text-primary mt-1">${x}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-primary">inventory</span>
      </div>
      <button type="button" id="kpi-sin-georef" class="bg-surface border ${xe?"border-amber-500 ring-2 ring-amber-300":"border-outline-variant"} p-md shadow-sm rounded border-l-4 border-amber-400 flex items-center justify-between cursor-pointer text-left transition-all hover:shadow-md" title="Click para filtrar las rutas sin georreferencia">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Sin Georreferenciar</h4>
          <div class="font-headline-md text-headline-md font-bold text-amber-600 mt-1">${y}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-amber-500">my_location</span>
      </button>
    </div>

    <!-- Tabla de Rutas -->
    <div class="bg-surface border border-outline-variant rounded shadow-sm overflow-hidden">
      <!-- Barra superior de filtros -->
      <div class="p-md border-b border-outline-variant flex flex-col md:flex-row justify-between items-center gap-md bg-white">
        <div class="flex flex-col md:flex-row gap-sm w-full md:w-auto items-stretch md:items-center">
          <div class="relative w-full md:w-80 focus-within:ring-2 focus-within:ring-primary rounded overflow-hidden">
            <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary">search</span>
            <input type="text" id="route-search" class="w-full bg-surface-container-low border-none pl-10 pr-md py-xs font-body-md text-body-md focus:outline-none" placeholder="Buscar por ID Ruta, Origen, Destino, Comuna, Región...">
          </div>
          <select id="route-filter-origen" class="w-full md:w-48 bg-surface-container-low border-none px-md py-xs font-body-md text-body-md focus:outline-none rounded">
            <option value="">Todos los orígenes</option>
            ${ge.map(e=>`<option value="${c(e)}">${c(e)}</option>`).join("")}
          </select>
        </div>

        <div class="flex gap-sm w-full md:w-auto">
          <button id="btn-export-routes-csv" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">download</span>
            Exportar CSV
          </button>
          <button id="btn-geo-routes" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">my_location</span>
            Georreferenciar Rutas
          </button>
          <button id="btn-geo-pendientes" class="flex-1 md:flex-none border border-amber-500 text-amber-700 hover:bg-amber-50 font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">auto_fix_high</span>
            Georreferenciar Pendientes
          </button>
          <button id="btn-calcular-km-rutas" class="flex-1 md:flex-none border border-sky-500 text-sky-700 hover:bg-sky-50 font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">straighten</span>
            Calcular KM
          </button>
          <button id="btn-bulk-upload-routes" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">upload_file</span>
            Carga Masiva (CSV)
          </button>
          <button id="btn-create-route" class="flex-1 md:flex-none bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider shadow">
            <span class="material-symbols-outlined text-[18px]">add</span>
            Nueva Ruta
          </button>
        </div>
      </div>

      <!-- Tabla Responsiva -->
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-surface-container-high border-b border-outline-variant text-[11px] font-bold text-secondary uppercase tracking-wider">
              <th class="p-md">ID Ruta</th>
              <th class="p-md">Denominación</th>
              <th class="p-md">Origen</th>
              <th class="p-md">ID Zona</th>
              <th class="p-md">Destino</th>
              <th class="p-md">Comuna</th>
              <th class="p-md">Región</th>
              <th class="p-md">Tipo</th>
              <th class="p-md">Clasificación</th>
              <th class="p-md">Factor</th>
              <th class="p-md">KM</th>
              <th class="p-md">Estado ERP</th>
              <th class="p-md">Latitud</th>
              <th class="p-md">Longitud</th>
              <th class="p-md">Georref.</th>
              <th class="p-md">Vigencia</th>
              <th class="p-md text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="routes-table-body" class="font-body-md text-body-md">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Formulario (Crear/Editar) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="route-modal">
      <div class="modal-window w-[640px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300 max-h-[90vh] overflow-y-auto">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low sticky top-0 z-10">
          <h4 id="route-modal-title" class="font-headline-sm text-headline-sm font-bold text-on-surface">Nueva Ruta</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-route-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="route-form">
          <div class="p-lg space-y-md">

            ${m.length===0?`
            <div class="p-sm bg-amber-50 border border-amber-300 rounded text-xs text-amber-800 flex items-center gap-xs">
              <span class="material-symbols-outlined text-[18px]">warning</span>
              Aún no hay Zonas de Transporte registradas. Vaya a la pestaña "Zonas de Transporte" para crear al menos una antes de registrar rutas.
            </div>`:""}

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-codigo" class="font-label-caps text-label-caps text-secondary block">ID RUTA</label>
                <input type="text" id="r-codigo" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: RUT-SAP-001">
              </div>
              <div class="space-y-xs">
                <label for="r-origen" class="font-label-caps text-label-caps text-secondary block">ORIGEN</label>
                <select id="r-origen" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <option value="">— Seleccione —</option>
                  ${ge.map(e=>`<option value="${c(e)}">${c(e)}</option>`).join("")}
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-zona" class="font-label-caps text-label-caps text-secondary block">ID ZONA DE TRANSPORTE</label>
                <select id="r-zona" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <option value="">— Seleccione —</option>
                  ${m.map(e=>`<option value="${c(e.zona)}">${c(e.zona)} — ${c(e.denominacion)}</option>`).join("")}
                </select>
              </div>
              <div class="space-y-xs">
                <label for="r-destino" class="font-label-caps text-label-caps text-secondary block">DESTINO</label>
                <input type="text" id="r-destino" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-surface-container-low" readonly placeholder="Se completa según la Zona seleccionada">
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-region" class="font-label-caps text-label-caps text-secondary block">REGIÓN</label>
                <select id="r-region" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <!-- Cargado dinámicamente -->
                </select>
              </div>
              <div class="space-y-xs">
                <label for="r-comuna" class="font-label-caps text-label-caps text-secondary block">COMUNA</label>
                <select id="r-comuna" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <!-- Cargado dinámicamente según región -->
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-tipo-ruta" class="font-label-caps text-label-caps text-secondary block">TIPO</label>
                <select id="r-tipo-ruta" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <option value="Regional">Regional</option>
                  <option value="Interregional">Interregional</option>
                </select>
              </div>
              <div class="space-y-xs">
                <label for="r-clasificacion" class="font-label-caps text-label-caps text-secondary block">CLASIFICACIÓN</label>
                <select id="r-clasificacion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  ${st.map(e=>`<option value="${e}">${e}</option>`).join("")}
                </select>
              </div>
            </div>

            <div class="space-y-xs">
              <label for="r-denominacion" class="font-label-caps text-label-caps text-secondary block">DENOMINACIÓN (ORIGEN - DESTINO)</label>
              <input type="text" id="r-denominacion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" placeholder="Se genera automáticamente desde el origen y destino" required>
            </div>

            <div class="space-y-xs">
              <label for="r-km" class="font-label-caps text-label-caps text-secondary block">KM (DISTANCIA ORIGEN-DESTINO)</label>
              <div class="flex gap-sm">
                <input type="number" id="r-km" class="flex-1 border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" min="0" placeholder="Ej: 45">
                <button type="button" id="btn-auto-km" class="bg-surface-container-high hover:bg-primary hover:text-white border border-outline-variant text-secondary font-bold px-md py-sm rounded cursor-pointer text-xs flex items-center gap-xs transition-all whitespace-nowrap">
                  <span class="material-symbols-outlined text-[16px]">travel_explore</span>
                  Calcular KM automático
                </button>
              </div>
              <p class="text-[11px] text-secondary" id="auto-km-status">Calcula la distancia real por carretera y las coordenadas del destino (Georreferencia).</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-estado-erp" class="font-label-caps text-label-caps text-secondary block">ESTADO (ERP)</label>
                <select id="r-estado-erp" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <option value="false">Pendiente de creación en ERP</option>
                  <option value="true">Creada en ERP</option>
                </select>
              </div>
              <div class="space-y-xs">
                <label for="r-caracteristica" class="font-label-caps text-label-caps text-secondary block">CARACTERÍSTICA ESPECIAL (TARIFAS)</label>
                <select id="r-caracteristica" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <option value="NORMAL">1 — NORMAL</option>
                  <option value="EXTREMA">3 — EXTREMA</option>
                  <option value="ISLA">2 — ISLA</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-lat" class="font-label-caps text-label-caps text-secondary block">GEORREFERENCIA — LATITUD</label>
                <input type="number" step="any" id="r-lat" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" placeholder="Se completa con 'Calcular KM automático'">
              </div>
              <div class="space-y-xs">
                <label for="r-lon" class="font-label-caps text-label-caps text-secondary block">GEORREFERENCIA — LONGITUD</label>
                <input type="number" step="any" id="r-lon" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" placeholder="Se completa con 'Calcular KM automático'">
              </div>
            </div>
            <p class="text-[11px] text-secondary" id="georef-status">Estado de Georreferencia: <span class="font-bold">Pendiente</span></p>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm sticky bottom-0">
            <button type="button" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-route-modal">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer">Guardar Ruta</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Carga Masiva (CSV) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="bulk-upload-routes-modal">
      <div class="modal-window w-[760px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva de Rutas</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-route-bulk-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Sube un archivo delimitado por punto y coma (<code>;</code>) o comas (<code>,</code>). Los encabezados exactos deben ser, en este orden:
            <code class="block p-sm bg-background border border-outline-variant rounded font-data-mono text-primary text-xs mt-xs">
              id_ruta;denominacion;origen;id_zona_transporte;destino;comuna;region;tipo;clasificacion;km;estado;latitud;longitud;estado_georreferencia
            </code>
            Son obligatorias las columnas: <code class="font-data-mono text-xs">id_ruta, denominacion, origen, id_zona_transporte, destino, comuna, region, tipo, clasificacion, estado</code>.
            Las columnas <code class="font-data-mono text-xs">km, latitud, longitud, estado_georreferencia</code> son opcionales; si faltan, la ruta quedará marcada como "Completar Datos".
            <br>El campo <code class="font-data-mono text-xs">origen</code> debe ser uno de: ${ge.join(", ")}.
            <br>El campo <code class="font-data-mono text-xs">estado</code> indica si la ruta ya está creada en SAP/ERP: <code class="font-data-mono text-xs">1</code> = Creada en ERP, <code class="font-data-mono text-xs">0</code> = Pendiente de creación en ERP.
            <br>Los campos <code class="font-data-mono text-xs">latitud</code> y <code class="font-data-mono text-xs">longitud</code> corresponden a las coordenadas del destino. Si faltan, puede completarlas luego con el botón "Georreferenciar Rutas".
            <br>Si el <code class="font-data-mono text-xs">id_zona_transporte</code> no existe aún, se creará automáticamente una nueva Zona de Transporte con los datos de destino/comuna/región/clasificación indicados.
          </p>

          <div class="border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-container/[0.03] rounded-lg p-xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-sm" id="csv-route-dropzone">
            <span class="material-symbols-outlined text-[48px] text-secondary">cloud_upload</span>
            <span class="font-body-md text-secondary font-bold">Arrastra tu archivo CSV de rutas aquí o haz clic para buscar</span>
            <input type="file" id="csv-route-input" accept=".csv" class="hidden">
          </div>

          <div id="csv-route-preview-container" class="hidden space-y-sm">
            <h5 class="font-label-caps text-label-caps text-on-surface">Vista Previa de Rutas Detectadas (<span id="csv-route-count">0</span>):</h5>
            <div class="max-h-48 overflow-y-auto border border-outline-variant rounded">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-surface-container-high border-b border-outline-variant font-bold text-secondary uppercase">
                    <th class="p-sm">ID Ruta</th>
                    <th class="p-sm">Origen</th>
                    <th class="p-sm">Zona / Destino</th>
                    <th class="p-sm">KM</th>
                    <th class="p-sm">Característica</th>
                    <th class="p-sm">Estado</th>
                  </tr>
                </thead>
                <tbody id="csv-route-preview-body">
                  <!-- Dinámico -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-route-bulk">Cancelar</button>
          <button class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" id="btn-confirm-route-bulk" disabled>Importar registros</button>
        </div>
      </div>
    </div>

    <!-- Modal Georreferenciación Masiva -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="geo-routes-modal">
      <div class="modal-window w-[560px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300 max-h-[90vh] overflow-y-auto">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low sticky top-0 z-10">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Georreferenciar Rutas</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-geo-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Se obtendrá automáticamente la Latitud y Longitud del destino (usando Destino, Comuna y Región) para las rutas pendientes. Las rutas que no puedan ubicarse con precisión quedarán marcadas como <span class="font-bold text-amber-700">REVISAR</span> para ajuste manual de coordenadas en el formulario de edición.
          </p>
          <div class="bg-surface-container-low border border-outline-variant rounded p-md text-sm">
            <span class="font-bold text-headline-sm" id="geo-pending-count">0</span> rutas pendientes de georreferenciar.
          </div>
          <div id="geo-progress-wrap" class="hidden space-y-xs">
            <div class="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
              <div id="geo-progress-bar" class="bg-primary h-2 rounded-full transition-all" style="width:0%"></div>
            </div>
            <p class="text-xs text-secondary" id="geo-progress-text">0 / 0</p>
            <div class="max-h-40 overflow-y-auto border border-outline-variant rounded text-xs font-data-mono" id="geo-log"></div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm sticky bottom-0">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-geo">Cerrar</button>
          <button class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" id="btn-start-geo">Iniciar Georreferenciación</button>
        </div>
      </div>
    </div>

    <!-- Modal Calcular KM Masivo -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="km-routes-modal">
      <div class="modal-window w-[560px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300 max-h-[90vh] overflow-y-auto">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low sticky top-0 z-10">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Calcular KM entre Puntos</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-km-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Se calculará la distancia por carretera (OSRM) entre cada Centro de Distribución origen y el destino de la ruta. Las rutas ya georreferenciadas se procesan directamente (~0.5 s c/u); las restantes geocodifican primero (~1.5 s c/u).
          </p>
          <div class="bg-surface-container-low border border-outline-variant rounded p-md text-sm space-y-xs">
            <p><span class="font-bold text-headline-sm" id="km-pending-count">0</span> rutas sin KM calculado.</p>
            <p class="text-xs text-secondary" id="km-pending-detail"></p>
          </div>
          <div id="km-progress-wrap" class="hidden space-y-xs">
            <div class="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
              <div id="km-progress-bar" class="bg-sky-500 h-2 rounded-full transition-all" style="width:0%"></div>
            </div>
            <p class="text-xs text-secondary" id="km-progress-text">0 / 0</p>
            <div class="max-h-40 overflow-y-auto border border-outline-variant rounded text-xs font-mono" id="km-log"></div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm sticky bottom-0">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-km">Cerrar</button>
          <button class="bg-sky-600 hover:bg-sky-700 text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" id="btn-start-km">Iniciar Cálculo KM</button>
        </div>
      </div>
    </div>
  `;const h=document.getElementById("r-origen"),D=document.getElementById("r-zona"),f=document.getElementById("r-destino"),k=document.getElementById("r-region"),T=document.getElementById("r-comuna"),J=document.getElementById("r-clasificacion"),we=document.getElementById("r-denominacion"),W=document.getElementById("r-lat"),Y=document.getElementById("r-lon"),lt=document.getElementById("georef-status");ae(k,""),U(T,"","");const ke=()=>{const e=h.value||"",a=f.value.trim();we.value=`${e}${a?" - "+a:""}`},Q=()=>{const e=W.value!==""&&Y.value!=="";lt.innerHTML=`Estado de Georreferencia: <span class="font-bold ${e?"text-green-700":"text-amber-600"}">${e?"Georreferenciado":"Pendiente"}</span>`};D.addEventListener("change",()=>{const e=m.find(a=>a.zona===D.value);e?(f.value=e.denominacion||"",ae(k,e.region||""),U(T,e.region||"",e.comuna||""),e.tipo&&(J.value=e.tipo)):f.value="",ke()}),h.addEventListener("change",ke),k.addEventListener("change",()=>{U(T,k.value,"")}),T.addEventListener("change",()=>{if(!k.value&&T.value){const e=dt(T.value);e&&(ae(k,e),U(T,e,T.value))}}),W.addEventListener("input",Q),Y.addEventListener("input",Q);const Oe=document.getElementById("route-search"),Ce=document.getElementById("route-filter-origen");Ce.value=ve;let ct=t;const ne=()=>{const e=Oe.value.toLowerCase();let a=t.filter(o=>(o.codigo||"").toLowerCase().includes(e)||(o.origen_grupo||"").toLowerCase().includes(e)||(o.destino||"").toLowerCase().includes(e)||(o.comuna||"").toLowerCase().includes(e)||(o.region||"").toLowerCase().includes(e)||(o.id_zona_transporte||"").toLowerCase().includes(e));return ve&&(a=a.filter(o=>o.origen_grupo===ve)),xe&&(a=a.filter(o=>!o.georef_estado)),ct=a,Ee(a),a};Oe.addEventListener("input",ne),Ce.addEventListener("change",()=>{ve=Ce.value,ne()});const je=document.getElementById("kpi-sin-georef");je&&je.addEventListener("click",()=>{xe=!xe,he(s)}),document.getElementById("btn-export-routes-csv").addEventListener("click",()=>{const e=ne();if(e.length===0){v("No hay rutas para exportar con los filtros actuales.","error");return}const a=["ID Ruta","Denominación","Origen","ID Zona","Destino","Comuna","Región","Tipo","Clasificación","KM","Estado ERP","Latitud","Longitud","Georreferencia","Vigencia"],o=e.map(n=>{const l=n.lat!==null&&n.lat!==void 0&&n.lon!==null&&n.lon!==void 0;let r="PENDIENTE";return n.georef_estado?r="OK":l&&(r="REVISAR"),[n.codigo||"",n.denominacion||"",n.origen_grupo||"",n.id_zona_transporte||"",n.destino||"",n.comuna||"",n.region||"",n.clasificRuta||"",n.tipo||"",n.km||"",n.estado_erp?"EN ERP":"PENDIENTE",n.lat!==null&&n.lat!==void 0?n.lat:"",n.lon!==null&&n.lon!==void 0?n.lon:"",r,n.activo?"ACTIVO":"DE BAJA"]}),b=Ot(a,o);jt(`rutas_transporte_${new Date().toISOString().slice(0,10)}.csv`,b)}),ne();const re=document.getElementById("route-modal"),ut=document.getElementById("btn-create-route"),mt=document.getElementById("btn-close-route-modal"),pt=document.getElementById("btn-cancel-route-modal"),Ge=document.getElementById("route-form");ut.addEventListener("click",()=>{X=null,Ge.reset(),document.getElementById("route-modal-title").innerText="Nueva Ruta";const e=E();document.getElementById("r-codigo").value=_t("RUT-SAP-",e.routes,"codigo"),ae(k,""),U(T,"",""),document.getElementById("r-estado-erp").value="false",document.getElementById("r-caracteristica").value="NORMAL",f.value="",ke(),Q(),re.classList.remove("pointer-events-none","opacity-0"),re.querySelector(".modal-window").classList.remove("scale-95")});const Ie=()=>{re.classList.add("pointer-events-none","opacity-0"),re.querySelector(".modal-window").classList.add("scale-95")};mt.addEventListener("click",Ie),pt.addEventListener("click",Ie),document.getElementById("btn-auto-km").addEventListener("click",async()=>{const e=document.getElementById("btn-auto-km"),a=document.getElementById("auto-km-status"),o=h.value,b=f.value.trim(),n=k.value;if(!o)return v("Seleccione primero el Origen.","error");if(!b)return v("Seleccione primero la Zona de Transporte (Destino).","error");const l=E(),r=fe(l,o),i=l.logisticsCentres.find(d=>d.id===r);if(!i||!i.lat||!i.lon)return v("El centro de origen no tiene coordenadas GPS.","error");e.disabled=!0,e.innerHTML='<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Calculando...',a.textContent="Geolocalizando destino y calculando ruta por carretera...";try{const{km:d,lat:L,lon:R}=await Ne(i,`${b}, ${n}`);document.getElementById("r-km").value=d,W.value=L,Y.value=R,Q(),a.textContent=`✓ Distancia calculada: ${d} km por carretera desde ${i.nombre}.`,a.style.color="#16a34a"}catch(d){a.textContent="✗ "+(d.message||"No se pudo calcular la distancia. Ingrésela manualmente."),a.style.color="#b5000b"}finally{e.disabled=!1,e.innerHTML='<span class="material-symbols-outlined text-[16px]">travel_explore</span> Calcular KM automático'}}),Ge.addEventListener("submit",e=>{e.preventDefault();const a=E(),o=W.value,b=Y.value,n=o!==""&&b!=="",l=h.value,r=fe(a,l),i={codigo:document.getElementById("r-codigo").value.toUpperCase().replace(/\s+/g,""),denominacion:we.value.trim(),origenId:r,origen_grupo:l,id_zona_transporte:D.value||null,destino:f.value.trim(),comuna:T.value||"",region:k.value||"",clasificRuta:document.getElementById("r-tipo-ruta").value,tipo:J.value,km:document.getElementById("r-km").value!==""?Number(document.getElementById("r-km").value):0,estado_erp:document.getElementById("r-estado-erp").value==="true",caracteristica:document.getElementById("r-caracteristica").value,lat:n?Number(o):null,lon:n?Number(b):null,georef_estado:n,activo:X?a.routes.find(d=>d.id===X).activo:!0};if(!i.id_zona_transporte){v("Debe seleccionar la Zona de Transporte (Destino).","error");return}if(X){const d=a.routes.findIndex(L=>L.id===X);d!==-1&&(a.routes[d]={...a.routes[d],...i},A(a),v("Ruta actualizada correctamente"))}else{if(a.routes.some(d=>d.codigo===i.codigo)){v("El ID de Ruta ingresado ya está registrado.","error");return}i.id="r"+new Date().getTime(),i.idZonaTrans=i.id_zona_transporte||"",a.routes.push(i),A(a),v("Ruta registrada con éxito")}Ie(),he(s)});const se=document.getElementById("bulk-upload-routes-modal"),bt=document.getElementById("btn-bulk-upload-routes"),gt=document.getElementById("btn-close-route-bulk-modal"),ft=document.getElementById("btn-cancel-route-bulk"),Le=document.getElementById("btn-confirm-route-bulk"),z=document.getElementById("csv-route-dropzone"),ze=document.getElementById("csv-route-input");let K=[],F=[];bt.addEventListener("click",()=>{K=[],F=[],Le.disabled=!0,document.getElementById("csv-route-preview-container").classList.add("hidden"),document.getElementById("csv-route-preview-body").innerHTML="",se.classList.remove("pointer-events-none","opacity-0"),se.querySelector(".modal-window").classList.remove("scale-95")});const Re=()=>{se.classList.add("pointer-events-none","opacity-0"),se.querySelector(".modal-window").classList.add("scale-95")};gt.addEventListener("click",Re),ft.addEventListener("click",Re),z.addEventListener("click",()=>ze.click()),z.addEventListener("dragover",e=>{e.preventDefault(),z.classList.add("border-primary","bg-primary-container/[0.04]")}),z.addEventListener("dragleave",()=>{z.classList.remove("border-primary","bg-primary-container/[0.04]")}),z.addEventListener("drop",e=>{e.preventDefault(),z.classList.remove("border-primary","bg-primary-container/[0.04]"),e.dataTransfer.files.length>0&&Pe(e.dataTransfer.files[0])}),ze.addEventListener("change",e=>{e.target.files.length>0&&Pe(e.target.files[0])});function Pe(e){const a=new FileReader;a.onload=function(o){const b=o.target.result;let n=new TextDecoder("utf-8").decode(b);n.includes("�")&&(n=new TextDecoder("windows-1252").decode(b));const l=Nt(n);if(l.length===0){v("El archivo CSV está vacío o no tiene el formato correcto.","error");return}const r=E();K=[],F=[];const i=document.getElementById("csv-route-preview-body");i.innerHTML="";const d=new Set,L=new Map((r.transportZones||[]).map(u=>[u.zona.toUpperCase(),u])),R=new Map;l.forEach(u=>{const S=(I(u,"id_ruta","codigo")||"").toUpperCase().replace(/\s+/g,""),Ye=(I(u,"denominacion","denominación")||"").trim(),Qe=(I(u,"origen")||"").trim().toUpperCase(),N=(I(u,"id_zona_transporte")||"").trim().toUpperCase(),pe=(I(u,"destino")||"").trim();let O=(I(u,"comuna")||"").trim(),j=Pt((I(u,"region","región")||"").trim());const Lt=(I(u,"tipo")||"").trim(),Rt=(I(u,"clasificacion","clasificación")||"").trim(),$e=I(u,"km"),G=$e!==""&&$e!==void 0?Number($e):null,ee=I(u,"factor_ruta","factorruta"),$t=ee!==""&&ee!==void 0?Number(ee):0,Tt={1:"NORMAL",2:"ISLA",3:"EXTREMA"}[$t]||(["NORMAL","ISLA","EXTREMA"].includes(ee?.toUpperCase())?ee.toUpperCase():""),te=I(u,"caracteristica","característica"),Dt=te!==""&&te!==void 0?Number(te):0,oe={1:"NORMAL",2:"ISLA",3:"EXTREMA"}[Dt]||(["NORMAL","ISLA","EXTREMA"].includes(te?.toUpperCase())?te.toUpperCase():"")||Tt||"",Te=I(u,"latitud","lat"),De=I(u,"longitud","lon"),Se=Te!==""&&Te!==void 0?Number(Te):null,Ae=De!==""&&De!==void 0?Number(De):null,Z=Se!==null&&!isNaN(Se)&&Ae!==null&&!isNaN(Ae)?{lat:Se,lon:Ae}:null,et=(I(u,"estado_georreferencia","estado georreferenciacion","estado georreferenciación")||"").trim().toLowerCase();if(O){const $=qt(O);O=$.comuna,!j&&$.region&&(j=$.region)}!j&&O&&(j=dt(O));const tt=(I(u,"estado","estado_erp","estadoerp")||"").trim().toLowerCase(),St=["1","si","sí","true","creada","erp"].includes(tt),ot=["Regional","Interregional"].find($=>$.toLowerCase()===Lt.toLowerCase())||"",Me=st.find($=>$.toLowerCase()===Rt.toLowerCase())||"",At=rt.find($=>$.toLowerCase()===j.toLowerCase())||j,be=ge.find($=>$===Qe)||"";let C="";S?Ye?be?N?pe?O?j?ot?Me?tt?(d.has(S)||r.routes.some($=>$.codigo===S))&&(C="ID Ruta Duplicado"):C="Falta Estado (ERP)":C="Clasificación inválida (Comuna/Sector)":C="Tipo inválido (Regional/Interregional)":C="Falta Región":C="Falta Comuna":C="Falta Destino":C="Falta ID Zona":C="Origen inválido":C="Falta Denominación":C="Falta ID Ruta";const at=!C&&(G===null||isNaN(G)||!Z),Be=document.createElement("tr");if(Be.className="border-b border-outline-variant",Be.innerHTML=`
          <td class="p-sm font-data-mono">${c(S)}</td>
          <td class="p-sm">${c(be||Qe)}</td>
          <td class="p-sm">${c(N)} / ${c(pe)}</td>
          <td class="p-sm font-bold">${G!==null&&!isNaN(G)?G+" KM":"—"}</td>
          <td class="p-sm">${oe?`<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${oe==="NORMAL"?"bg-gray-100 text-gray-700":oe==="ISLA"?"bg-blue-100 text-blue-700":"bg-amber-100 text-amber-700"}">${oe}</span>`:'<span class="text-secondary">—</span>'}</td>
          <td class="p-sm">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${C?"bg-red-100 text-red-800":at?"bg-amber-100 text-amber-800":"bg-green-100 text-green-800"}">
              ${C||(at?"Completar Datos":"Listo")}
            </span>
          </td>
        `,i.appendChild(Be),!C){d.add(S);const $=fe(r,be);if(!L.has(N)&&!R.has(N)){const nt={zona:N,pais:"CL",denominacion:pe,comuna:O||null,region:j||null,tipo:Me||null,estado_erp:!1,created_at:new Date().toISOString()};R.set(N,nt),F.push(nt)}const Mt=et?["si","sí","true","1","georreferenciado"].includes(et):!!Z;K.push({codigo:S,denominacion:Ye,origenId:$,origen_grupo:be,id_zona_transporte:N,idZonaTrans:N,destino:pe,comuna:O,region:At,clasificRuta:ot,tipo:Me,km:G!==null&&!isNaN(G)?G:0,estado_erp:St,caracteristica:oe||"NORMAL",lat:Z?Z.lat:null,lon:Z?Z.lon:null,georef_estado:Mt,activo:!0})}}),document.getElementById("csv-route-count").innerText=l.length,document.getElementById("csv-route-preview-container").classList.remove("hidden"),K.length>0?Le.disabled=!1:v("No se encontraron registros de rutas válidos.","error")},a.readAsArrayBuffer(e)}Le.addEventListener("click",()=>{const e=E();e.transportZones||(e.transportZones=[]),F.forEach(o=>e.transportZones.push(o)),K.forEach(o=>{o.id="r"+(new Date().getTime()+Math.random().toString(36).substr(2,5)),e.routes.push(o)}),A(e);let a=`Se importaron ${K.length} rutas correctamente.`;F.length>0&&(a+=` Se crearon ${F.length} nuevas Zonas de Transporte.`),v(a),Re(),he(s)});const de=document.getElementById("geo-routes-modal"),xt=document.getElementById("btn-geo-routes"),vt=document.getElementById("btn-close-geo-modal"),yt=document.getElementById("btn-cancel-geo"),M=document.getElementById("btn-start-geo"),qe=document.getElementById("geo-pending-count"),Ke=document.getElementById("geo-progress-wrap"),Fe=document.getElementById("geo-progress-bar"),He=document.getElementById("geo-progress-text"),H=document.getElementById("geo-log");let ie=!1,P=!1;const le=()=>E().routes.filter(e=>!e.georef_estado),ht=()=>{qe.innerText=le().length,Ke.classList.add("hidden"),H.innerHTML="",Fe.style.width="0%",He.innerText="",M.disabled=le().length===0,M.innerText="Iniciar Georreferenciación",de.classList.remove("pointer-events-none","opacity-0"),de.querySelector(".modal-window").classList.remove("scale-95")};xt.addEventListener("click",ht);const Ve=()=>{ie&&(P=!0),de.classList.add("pointer-events-none","opacity-0"),de.querySelector(".modal-window").classList.add("scale-95")};vt.addEventListener("click",Ve),yt.addEventListener("click",Ve),M.addEventListener("click",async()=>{if(ie){P=!0,M.innerText="Deteniendo...",M.disabled=!0;return}const e=E(),a=e.routes.filter(l=>!l.georef_estado);if(a.length===0)return;ie=!0,P=!1,M.innerText="Detener",Ke.classList.remove("hidden"),H.innerHTML="";let o=0,b=0,n=0;for(const l of a){if(P)break;const r=[l.destino,l.comuna,l.region].filter(Boolean).join(", ");try{const i=await _e(r,l.comuna);l.lat=i.lat,l.lon=i.lon,l.georef_estado=!!i.found,i.found?b++:n++;const d=i.displayName&&i.displayName.includes("tabla local");H.insertAdjacentHTML("beforeend",`<div class="px-sm py-1 border-b border-outline-variant ${i.found?"text-green-700":"text-amber-700"}">${i.found?"✓":"⚠"} ${c(l.codigo)} — ${c(l.comuna||r)}${d?" (local)":""}</div>`),!d&&!P&&await new Promise(L=>setTimeout(L,1100))}catch{n++,H.insertAdjacentHTML("beforeend",`<div class="px-sm py-1 border-b border-outline-variant text-red-700">✗ ${c(l.codigo)} — error de geolocalización</div>`)}H.scrollTop=H.scrollHeight,o++,Fe.style.width=`${Math.round(o/a.length*100)}%`,He.innerText=`${o} / ${a.length} — Georreferenciadas: ${b}, Por revisar: ${n}`}A(e,{syncOnly:["routes"]}),ie=!1,qe.innerText=le().length,M.disabled=le().length===0,M.innerText=P?"Detenido":"Completado",Ee(e.routes),o>0&&v(`Georreferenciación ${P?"detenida":"finalizada"}: ${b} ubicadas automáticamente, ${n} requieren revisión manual.`)}),document.getElementById("btn-geo-pendientes")?.addEventListener("click",async()=>{const e=E(),a=e.routes.filter(r=>!r.georef_estado);if(a.length===0){v("No hay rutas pendientes de georreferenciación.","error");return}if(!await it(`¿Georreferenciar ${a.length} rutas pendientes? Las comunas conocidas se resuelven al instante desde tabla local.`))return;let o=0,b=0,n=0;v(`Procesando ${a.length} rutas...`,"info");for(const r of a){const i=[r.destino,r.comuna,r.region].filter(Boolean).join(", ");try{const d=await _e(i,r.comuna);r.lat=d.lat,r.lon=d.lon,r.georef_estado=!!d.found,d.found?b++:n++,d.displayName&&d.displayName.includes("tabla local")||await new Promise(R=>setTimeout(R,1100))}catch{n++}o++}A(e,{syncOnly:["routes"]});const l=E();Ee(l.routes),v(`Finalizado: ${b} ubicadas automáticamente, ${n} requieren revisión manual.`)});const ce=document.getElementById("km-routes-modal"),Et=document.getElementById("btn-calcular-km-rutas"),wt=document.getElementById("btn-close-km-modal"),kt=document.getElementById("btn-cancel-km"),B=document.getElementById("btn-start-km"),Ze=document.getElementById("km-pending-count"),Ct=document.getElementById("km-pending-detail"),Ue=document.getElementById("km-progress-wrap"),Xe=document.getElementById("km-progress-bar"),Je=document.getElementById("km-progress-text"),_=document.getElementById("km-log");let ue=!1,V=!1;const me=()=>E().routes.filter(e=>!e.km||e.km===0),It=()=>{const e=me(),a=e.filter(o=>o.lat&&o.lon).length;Ze.innerText=e.length,Ct.innerText=`${a} ya georreferenciadas (~0.5 s c/u) · ${e.length-a} sin coordenadas (~1.5 s c/u)`,Ue.classList.add("hidden"),Xe.style.width="0%",Je.innerText="",_.innerHTML="",B.disabled=e.length===0,B.innerText="Iniciar Cálculo KM",ce.classList.remove("pointer-events-none","opacity-0"),ce.querySelector(".modal-window").classList.remove("scale-95")};Et?.addEventListener("click",It);const We=()=>{ue&&(V=!0),ce.classList.add("pointer-events-none","opacity-0"),ce.querySelector(".modal-window").classList.add("scale-95")};wt?.addEventListener("click",We),kt?.addEventListener("click",We),B?.addEventListener("click",async()=>{if(ue){V=!0,B.innerText="Deteniendo...",B.disabled=!0;return}const e=E(),a=me();if(a.length===0)return;ue=!0,V=!1,B.innerText="Detener",Ue.classList.remove("hidden"),_.innerHTML="";let o=0,b=0,n=0;const l=a.length;for(const r of a){if(V)break;try{const L=(r.origen_grupo?(e.logisticsCentres||[]).find(R=>R.origen_grupo===r.origen_grupo&&R.lat!=null):null)||(e.logisticsCentres||[]).find(R=>R.id===r.origenId);if(!L||!L.lat||!L.lon)n++,_.insertAdjacentHTML("beforeend",`<div class="px-2 py-1 border-b text-red-700">✗ ${r.codigo} — sin CD de origen con coordenadas</div>`);else if(r.lat&&r.lon){const R=`https://router.project-osrm.org/route/v1/driving/${L.lon},${L.lat};${r.lon},${r.lat}?overview=false`,u=await fetch(R);if(!u.ok)throw new Error("OSRM no disponible");const S=await u.json();if(!S.routes||!S.routes[0])throw new Error("Sin ruta OSRM");r.km=Math.round(S.routes[0].distance/1e3),b++,_.insertAdjacentHTML("beforeend",`<div class="px-2 py-1 border-b text-green-700">✓ ${r.codigo} — ${r.comuna||""} → ${r.km} km</div>`)}else{const R=[r.destino,r.comuna,r.region].filter(Boolean).join(", "),u=await Ne(L,R);r.km=u.km,r.lat=u.lat,r.lon=u.lon,r.georef_estado=!0,b++,_.insertAdjacentHTML("beforeend",`<div class="px-2 py-1 border-b text-green-700">✓ ${r.codigo} — ${r.comuna||""} → ${r.km} km (geocodificado)</div>`)}}catch(d){n++,_.insertAdjacentHTML("beforeend",`<div class="px-2 py-1 border-b text-red-700">✗ ${r.codigo} — ${d.message}</div>`)}o++;const i=Math.round(o/l*100);Xe.style.width=`${i}%`,Je.innerText=`${o} / ${l} — ${b} OK · ${n} errores`,_.scrollTop=_.scrollHeight,await new Promise(d=>setTimeout(d,500))}A(e,{syncOnly:["routes"]}),ue=!1,Ze.innerText=me().length,B.disabled=me().length===0,B.innerText=V?"Detenido":"Completado",Ee(E().routes),v(`KM ${V?"detenido":"finalizado"}: ${b} calculados, ${n} con errores.`)}),window.__openRouteEditModal=e=>{const o=E().routes.find(n=>n.id===e);if(!o)return;X=e,document.getElementById("r-codigo").value=o.codigo,h.value=o.origen_grupo||"",D.value=o.id_zona_transporte||"",f.value=o.destino||"",ae(k,o.region||""),U(T,o.region||"",o.comuna||""),document.getElementById("r-tipo-ruta").value=o.clasificRuta||"Regional",J.value=o.tipo||"Comuna",we.value=o.denominacion||"",document.getElementById("r-km").value=o.km!==null&&o.km!==void 0?o.km:"",document.getElementById("r-estado-erp").value=o.estado_erp?"true":"false",document.getElementById("r-caracteristica").value=o.caracteristica||"NORMAL",W.value=o.lat!==null&&o.lat!==void 0?o.lat:"",Y.value=o.lon!==null&&o.lon!==void 0?o.lon:"",Q(),document.getElementById("route-modal-title").innerText="Editar Ruta";const b=document.getElementById("route-modal");b.classList.remove("pointer-events-none","opacity-0"),b.querySelector(".modal-window").classList.remove("scale-95")}}function Ee(s){const g=document.getElementById("routes-table-body");if(g){if(s.length===0){g.innerHTML=`
      <tr>
        <td colspan="17" class="p-xl text-center text-secondary">
          No se encontraron rutas registradas.
        </td>
      </tr>
    `;return}g.innerHTML="",s.forEach(t=>{const m=document.createElement("tr"),w=Ht(t);m.className=`border-b border-outline-variant hover:bg-surface-container-low transition-colors ${w?"bg-amber-50/60":""}`;const p=t.activo?"bg-green-100 text-green-800":"bg-red-100 text-red-800",x=t.estado_erp?"bg-green-100 text-green-800":"bg-red-100 text-red-800",y=t.lat!==null&&t.lat!==void 0&&t.lon!==null&&t.lon!==void 0;let h="PENDIENTE",D="bg-red-100 text-red-800";t.georef_estado?(h="OK",D="bg-green-100 text-green-800"):y&&(h="REVISAR",D="bg-amber-100 text-amber-800");const f=k=>k?c(k):'<span class="inline-flex items-center gap-1 text-amber-700 font-bold text-[10px] uppercase whitespace-nowrap"><span class="material-symbols-outlined text-[14px]">warning</span> Completar</span>';m.innerHTML=`
      <td class="p-md font-bold text-primary font-data-mono">${c(t.codigo)}</td>
      <td class="p-md text-xs">${c(t.denominacion)}</td>
      <td class="p-md font-bold text-xs">${c(t.origen_grupo)||"—"}</td>
      <td class="p-md text-xs font-data-mono">${f(t.id_zona_transporte)}</td>
      <td class="p-md text-xs">${c(t.destino)}</td>
      <td class="p-md text-xs">${f(t.comuna)}</td>
      <td class="p-md text-xs">${f(t.region)}</td>
      <td class="p-md text-xs"><span class="bg-surface-container-high px-sm py-1 border border-outline-variant rounded text-xs">${c(t.clasificRuta)||"—"}</span></td>
      <td class="p-md text-xs"><span class="bg-surface-container-high px-sm py-1 border border-outline-variant rounded text-xs">${c(t.tipo)||"—"}</span></td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${Ft[t.caracteristica||"NORMAL"]}">
          ${t.caracteristica==="NORMAL"?"1":t.caracteristica==="ISLA"?"2":t.caracteristica==="EXTREMA"?"3":"—"}
        </span>
      </td>
      <td class="p-md font-bold font-data-mono text-xs">${t.km?t.km+" KM":f("")}</td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${x}">
          ${t.estado_erp?"EN ERP":"PENDIENTE"}
        </span>
      </td>
      <td class="p-md text-xs font-data-mono">${t.lat!==null&&t.lat!==void 0?t.lat:f("")}</td>
      <td class="p-md text-xs font-data-mono">${t.lon!==null&&t.lon!==void 0?t.lon:f("")}</td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${D}">
          ${h}
        </span>
      </td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${p}">
          ${t.activo?"ACTIVO":"DE BAJA"}
        </span>
      </td>
      <td class="p-md text-center">
        <div class="flex items-center justify-center gap-xs">
          <button class="btn-edit text-secondary hover:text-primary p-xs cursor-pointer" data-id="${t.id}" title="Editar ruta">
            <span class="material-symbols-outlined text-[20px]">edit</span>
          </button>
          <button class="btn-refresh-geo text-secondary hover:text-primary p-xs cursor-pointer" data-id="${t.id}" title="Recalcular KM y Georreferencia">
            <span class="material-symbols-outlined text-[20px]">my_location</span>
          </button>
          <button class="btn-toggle text-secondary hover:text-primary p-xs cursor-pointer" data-id="${t.id}" title="${t.activo?"Dar de baja":"Activar"}">
            <span class="material-symbols-outlined text-[20px] ${t.activo?"text-red-600 hover:text-red-800":"text-green-600 hover:text-green-800"}">
              ${t.activo?"block":"check_circle"}
            </span>
          </button>
          <button class="btn-delete-route text-secondary hover:text-red-700 p-xs cursor-pointer" data-id="${t.id}" title="Eliminar ruta">
            <span class="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </div>
      </td>
    `,g.appendChild(m)}),g.querySelectorAll(".btn-edit").forEach(t=>{t.addEventListener("click",m=>window.__openRouteEditModal(m.currentTarget.getAttribute("data-id")))}),g.querySelectorAll(".btn-refresh-geo").forEach(t=>{t.addEventListener("click",async m=>{const w=m.currentTarget.getAttribute("data-id"),p=E(),x=p.routes.find(f=>f.id===w);if(!x)return;const y=fe(p,x.origen_grupo),h=(p.logisticsCentres||[]).find(f=>f.id===y);if(!h||!h.lat||!h.lon){v("El centro logístico de origen no tiene coordenadas GPS.","error");return}const D=m.currentTarget.querySelector(".material-symbols-outlined");D.classList.add("animate-spin"),m.currentTarget.disabled=!0;try{const f=[x.destino,x.comuna,x.region].filter(Boolean).join(", "),{km:k,lat:T,lon:J}=await Ne(h,f);x.km=k,x.lat=T,x.lon=J,x.georef_estado=!0,A(p),v(`Ruta ${x.codigo} actualizada: ${k} km.`),ye(document.getElementById("stage-area"))}catch(f){v("✗ "+(f.message||"No se pudo recalcular la ruta."),"error"),D.classList.remove("animate-spin"),m.currentTarget.disabled=!1}})}),g.querySelectorAll(".btn-toggle").forEach(t=>{t.addEventListener("click",m=>{const w=m.currentTarget.getAttribute("data-id"),p=E(),x=p.routes.findIndex(y=>y.id===w);if(x!==-1){const y=p.routes[x];y.activo=!y.activo,A(p),v(`La ruta ${y.codigo} ha sido ${y.activo?"activada":"dada de baja"}.`),ye(document.getElementById("stage-area"))}})}),g.querySelectorAll(".btn-delete-route").forEach(t=>{t.addEventListener("click",async m=>{const w=m.currentTarget.getAttribute("data-id"),p=E(),x=p.routes.findIndex(y=>y.id===w);if(x!==-1){const y=p.routes[x];if(!await it(`¿Eliminar la ruta ${y.codigo} (${y.denominacion||y.destino})? Esta acción no se puede deshacer.`))return;p.routes.splice(x,1),A(p,{syncOnly:["routes"]}),Bt("routes",y.id).catch(h=>console.error("Error al borrar ruta en Supabase:",h.message||h)),v(`La ruta ${y.codigo} ha sido eliminada.`),ye(document.getElementById("stage-area"))}})})}}export{ye as renderRoutesView,fe as resolveOrigenIdFromGrupo,to as setRoutesSubTab};
