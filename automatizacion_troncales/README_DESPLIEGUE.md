# Automatización Correos Troncales → Supabase

Automatización nativa en **Google Apps Script**: lee tu Gmail 3 veces al día, procesa los correos **no leídos** de dos etiquetas, extrae y parsea los adjuntos (Excel del SLIM y HTM de SQVI), y carga los datos a Supabase. La corrida de las **13:35** guarda además la foto del día (histórico de 7 días). Los correos procesados quedan **leídos**.

## Qué quedó creado en Supabase

Tablas de almacenamiento (modelo eficiente JSONB):

- **`trc_live`** — datos vigentes. En cada corrida se **pisa** por fuente.
- **`trc_hist`** — foto diaria (solo corrida 13:35). Se conservan **7 días**.
- **`trc_log`** — bitácora de cada corrida (para verificar qué cargó y si hubo error).

Vistas tipadas (cada fuente se consulta como una tabla con columnas):

| Vista | Fuente | Contenido |
|-------|--------|-----------|
| `v_trc_slim_stock` | slim_stock | SLIM: centro, código, descripción, stock_days, clase ABC (filtrado B=0 y 15 centros) |
| `v_trc_sqvi_retiros_fabrica` | Step 1 | Retiros de fábrica |
| `v_trc_sqvi_pedidos_venta_1003` | Step 2 | Pedidos de venta 1003 |
| `v_trc_sqvi_stock_almacen_4000` | Step 3 | Stock almacén 4000 |
| `v_trc_sqvi_pedidos_traslados` | Step 4 | Pedidos de traslados |
| `v_trc_sqvi_pedidos_traslados_4000` | Step 5 | Pedidos traslados 4000 |

## Pasos para dejarlo corriendo (una sola vez)

1. **Crea el proyecto Apps Script**
   - Entra a https://script.google.com → **Nuevo proyecto**.
   - Borra el contenido de `Código.gs` y pega TODO el contenido de **`Code.gs`** (este mismo folder).
   - Ponle nombre al proyecto, por ejemplo `Troncales SIT EBEMA`.

2. **Zona horaria del proyecto**
   - Menú **Configuración del proyecto** (ícono engranaje) → **Zona horaria** = `(GMT-04:00) Santiago` (America/Santiago).

3. **Habilita el servicio avanzado de Drive** (para convertir el Excel)
   - En el editor, panel izquierdo → **Servicios** (＋) → busca **Drive API** → **Agregar**.
   - (Debe quedar con el identificador `Drive`.)

4. **Carga la llave de Supabase (secreta)**
   - Menú **Configuración del proyecto** → **Propiedades de la secuencia de comandos** → **Agregar propiedad**.
   - Nombre: `SUPABASE_SERVICE_KEY`
   - Valor: la **service_role key** de Supabase → la copias en tu panel de Supabase en
     **Project Settings → API → `service_role` (secret)**.
   - Guardar. (Esta llave queda solo en el servidor de Google, nunca se expone en la web.)

5. **Autoriza y prueba**
   - Arriba, selecciona la función **`probar_ahora`** y pulsa **Ejecutar**.
   - Google pedirá permisos (Gmail, Drive, conexión externa) → acepta con tu cuenta `jcandia@ebema.cl`.
   - Revisa **Registros de ejecución**: debe decir `ok` y el número de filas por fuente.
   - En Supabase, verifica que `v_trc_slim_stock` y las `v_trc_sqvi_*` tengan datos.

6. **Programa las 3 corridas automáticas**
   - Selecciona la función **`crearTriggers`** y pulsa **Ejecutar** (una sola vez).
   - Esto crea los 3 disparadores: **07:35, 11:35 y 13:35** (hora Chile).
   - *(Nota: Apps Script dispara dentro de una ventana de ~15 min alrededor de esa hora; como los correos llegan ~07:31/11:31/13:31, siempre alcanza a procesarlos.)*

## Cómo funciona cada corrida

- Busca correos **no leídos** en las etiquetas *Plan Troncales (SLIM)* y *SQVI Troncales*.
- Si hay varios sin leer del mismo tipo (p. ej. se saltó una corrida), toma **el más reciente**.
- Parsea, **filtra** (SLIM: `Artículo Stock = 0` + los 15 centros) y **pisa** la base vigente de esa fuente.
- Marca los correos como **leídos**.
- Solo a las **13:35**: guarda la foto del día en `trc_hist` y poda lo que supere 7 días.

## Verificar / diagnosticar

- Consulta la bitácora: en Supabase, tabla **`trc_log`** (ordena por `cargado_en` desc). Verás por cada fuente: filas cargadas, estado (`ok` / `sin_correo` / `error`) y mensaje.
- Para reprocesar manualmente: marca el correo como **no leído** en Gmail y ejecuta `probar_ahora` (o `probar_ahora_snapshot` para simular la de las 13:35).

## Si SAP cambia las columnas de un reporte

El parser SQVI arma las columnas a partir de la **fila de encabezado** del HTM. Si SAP agrega/renombra columnas, avísame para actualizar la vista correspondiente en Supabase (los datos igual se cargan en `trc_live`).
