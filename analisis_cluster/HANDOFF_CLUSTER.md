# SIT EBEMA — Handoff para continuar en otro chat
Fecha: 2026-07-13 · Autor: Jordan Candia (jcandia@ebema.cl)

## 1. Qué es
SIT EBEMA es la app web interna de Ebema para gestión logística y cotización de fletes.
- Repo: https://github.com/jordancandia/ebema-transporte
- Producción (GitHub Pages): https://jordancandia.github.io/ebema-transporte/
- Supabase PRD: proyecto `humhokvdowfqicjopbhf` · https://humhokvdowfqicjopbhf.supabase.co
- Carpeta local: `C:\Users\Jordan\Desktop\ANTIGRAVITY\WEB TRANSPORTE`

## 2. Stack
Frontend HTML + JS ES Modules (sin framework), Tailwind CDN (rojo corporativo #b5000b), Leaflet. Backend Supabase (Postgres + Auth + Edge Functions + RLS). Hosting GitHub Pages (rama main). Cache-busting por `?v=YYYYMMDD[letra]` en los imports.

## 3. Trabajo reciente: vista CLUSTER OPERATIVO (foco de la sesión)
La funcionalidad se **complementó DENTRO** de la vista existente `renderCluster` en `js/tarifas-clientes.js`, accesible en el menú **Tarifas Clientes → Cluster**. NO es un módulo separado.

### Cómo funciona el cálculo (dos capas)
1. **Cluster de densidad** (ya existía): `asignarClustersCentro()` — algoritmo tipo k-means por centro. Densidad % de cada comuna = promedio de %clientes + %obras + %toneladas (del histórico `histData`). Asigna keys `1/2/3(/4)` y `spot`, guardados en `ccfg.comunaCluster`. Distancia mixta 60% geográfica (Haversine) + 40% densidad. Botones "Auto" (por centro) y "Asignar todos".
2. **Cluster operativo homologable** (agregado esta sesión): columnas nuevas en la misma tabla — **Eje Vial**, **Cluster Op.**, **Frecuencia**, **Flota**. Se calculan solas y se recalculan en vivo al cambiar el select de cluster.

### Reglas del motor operativo (función `clusterOpDe` en tarifas-clientes.js)
- **Eje Vial** = cardinal por azimut desde las coords del centro (repId) hacia la comuna. Config `EJES_OP` por centro (ej. `'1100'` Puerto Montt: NORTE / ESTE=Austral-Costa / SUR=Sur-Isla). Default genérico 4 cardinales. Nombres HOMOLOGABLES (aplicables a cualquier centro; los alias locales tipo "Sur-Isla" son solo descripción).
- **Cluster Op.** = `Eje-Cx` (ej. `SUR-C1`, `NORTE-C2`). Interregional → `SPOT_INTERREGIONAL` (esta vista filtra solo Regional+Comuna, así que en la práctica no aparecen).
- **Frecuencia/Flota** salen de la tabla `FREC_OP` (C1 diaria/propia, C2 L-Mi-V/propia, C3 Ma-Ju arrastre/hub, C4 a demanda/extra, SPOT a demanda SLA48/extra).
- **Regla "descolgada" (absorción):** una comuna **C3/C4** necesita un ancla **C1 o C2 en su MISMO eje** dentro de **`ABSORB_KM` (60 km)** para ser absorbida (`Eje-Cx`). Si no hay ninguna cerca → **`SPOT_LOCAL`**. Constante `ABSORB_KM = 60` (ajustable).
- **Sin densidad + sin eje** (sin lat/lon) → `SPOT_LOCAL`. Sin densidad pero con eje → pendiente `Eje-SD`.
- El recálculo es **cruzado**: al cambiar cualquier cluster se recomputa toda la tarjeta del centro (`refreshCardOp`), porque marcar una comuna C1/C2 cambia qué vecinas absorbe.

## 4. Base de datos (aplicado en PRD)
Tabla **`cluster_rutas`** (centro TEXT, editable, `editado_manual`). Enlace sector→comuna por `comuna_padre`. Objetos:
- Trigger `fn_cascada_cluster_sectores` — al editar una comuna, arrastra sus sectores (por `comuna_padre`).
- `fn_upsert_cluster(jsonb)` — recálculo masivo que respeta `editado_manual`.
- RLS con `app_role()` / `app_centro()`. Ambas funciones con `search_path=public`.
- Sembrado centro **1100** (Puerto Montt): 10 comunas + 2 sectores de Chiloé (eje SUR) + 2 interregionales (SPOT).

**IMPORTANTE:** hoy la vista `renderCluster` guarda en `ccfg` (config, vía `saveDatabase`), NO en `cluster_rutas`. La tabla existe pero **aún no está conectada** a la vista. Pendiente decidir si se persiste el resultado operativo ahí.

## 5. Estructura relevante (routes = maestro)
`routes`: `origenId`(centro, text), `destino`, `comuna`(=comuna padre), `tipo`(Comuna/Sector), `clasificRuta`(Regional/Interregional), `region`, `lat`, `lon`, `origen_grupo`.
`logistics_centres`: `id`, `nombre`, `lat`, `lon`, `region`, `origen_grupo`. Puerto Montt = id `1100`.
No existe tabla de densidad: la densidad se calcula en runtime desde el histórico.

## 6. Versiones actuales
- `index.html` → `app.js?v=20260713h`
- `app.js` importa `tarifas-clientes.js?v=20260713d`
- Archivo `js/cluster-rutas.js` quedó en el repo pero **SIN import** (fue un intento previo, reemplazado por la integración en tarifas-clientes.js). Se puede borrar.

## 7. Reglas de trabajo del proyecto
- **CIFS null bytes:** NUNCA editar con `sed -i` ni `python open('w')` directo sobre el mount. Editar en `/tmp` (copia única) y `cp` de vuelta. Verificar `count(b'\x00')==0` y `node --check`.
- **Git:** el sandbox no puede `git push`. Tras cada cambio el usuario corre manualmente en cmd Windows: `del .git\index.lock` (si existe), `git add ...`, `git commit`, `git push origin main`. GitHub Pages tarda ~1-2 min; Ctrl+F5 para forzar recarga.
- Siempre **bumpear versión** al modificar JS (en `app.js` el import y en `index.html` el `app.js?v=`).

## 8. Pendientes / próximos pasos
1. Decidir si conectar la vista al `cluster_rutas` de la BD (persistir resultado operativo + cascada real). Hoy solo guarda en `ccfg`.
2. Ajustar `ABSORB_KM` (60 km) según geografía real (Chiloé quizá 40-50).
3. Opcional: badge visual "descolgada"/SPOT en la tabla.
4. Sembrar/recalcular los demás centros (hoy solo 1100 en la tabla BD).
5. Pendientes históricos del sistema: verificar dominio Resend (MFA), invitar primer OWNER/ADMIN, flujo aprobación transportistas.

## 9. Archivos de referencia (carpeta analisis_cluster/)
- `motor_cluster.py` — motor de referencia en Python (versión standalone del algoritmo, con demo).
- `cluster_rutas.sql` — DDL aplicado (tabla + trigger + fn_upsert + RLS).
- `SIT_EBEMA_Vista_CLUSTER.xlsx` — salida demo.
