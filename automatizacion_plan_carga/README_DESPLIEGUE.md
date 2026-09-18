# Correo Plan de Carga → Gmail

Automatización en **Google Apps Script**: envía 3 correos diarios (días hábiles lunes a viernes) a los usuarios **OWNER** y **ADMINISTRADOR_DEPOSITO**, con **un solo correo por destinatario y por corrida**, asunto siempre `PLAN DE CARGA – [FECHA]` (sin centro ni cantidad — es igual para todos), que trae:

- Una **tabla HTML con TODOS sus centros**, tengan o no carga programada ese día (columnas: Centro, CD Origen, %, Estado, REVEX, Venta Directa, Retiro Fábrica, Crossdocking, Quiebre, Abastecimiento). Las filas en **PROGRAMAR** (≥80%) se resaltan.
- Un **CSV adjunto independiente SOLO por cada centro en PROGRAMAR** de esa tabla, con el detalle de líneas de ese centro (mismo contenido que la vista de detalle del Plan de Carga en la plataforma). Los centros sin carga suficiente aparecen en la tabla pero no generan adjunto.

El correo solo se envía si el destinatario tiene **al menos un centro en PROGRAMAR** ese día — si no, no recibe nada en esa corrida (aunque su tabla, de haberse enviado, hubiera mostrado también los centros sin carga).

Qué centros le corresponden a cada destinatario:
- Si tiene centro(s) en su **Centro de Preferencia** (`app_users.centrosPreferencia`) → solo esos (en la tabla, tengan o no carga; en los adjuntos, solo si están en PROGRAMAR).
- Si `centrosPreferencia` es `null` (= "Todos los centros", igual que en toda la plataforma) → **todos** los centros de ambos CDs, en la misma tabla.

Spec funcional completa: `spec_correo_plan_carga_2026-09-17` (memoria del proyecto SIT EBEMA en Claude).

## De dónde vienen los datos

Todo el cálculo (tonelajes, % de camión, estado PROGRAMAR/REVISAR/CARGA INSUFICIENTE) ya está resuelto en **vistas de Supabase** — este script NO reimplementa la lógica de negocio del Plan de Carga, solo la consulta:

- `v_trc_plan_carga_1003` / `v_trc_plan_carga_1003_detalle` — CD Quilicura (motor completo: Quiebre, Abastecimiento, REVEX, Crossdocking, Retiro CD, Fábrica-Cliente, Fábrica-Sucursal, Venta Directa, CD-Cliente).
- `v_trc_plan_carga_1081` / `v_trc_plan_carga_1081_detalle` — CD Concepción (mismas categorías **excepto Crossdocking y Venta Directa/CD-Cliente**, que hoy no tienen fuente de datos para ese CD — ver spec).

## Pasos para dejarlo corriendo (una sola vez)

1. **Crea el proyecto Apps Script**
   - Entra a https://script.google.com → **Nuevo proyecto**.
   - Borra el contenido de `Código.gs` y pega TODO el contenido de **`Code.gs`** (este mismo folder).
   - Nómbralo, por ejemplo, `Correo Plan de Carga SIT EBEMA`.

2. **Zona horaria del proyecto**
   - **Configuración del proyecto** (ícono engranaje) → **Zona horaria** = `(GMT-04:00) Santiago`.

3. **Carga la llave de Supabase (secreta)**
   - **Configuración del proyecto** → **Propiedades de la secuencia de comandos** → **Agregar propiedad**.
   - Nombre: `SUPABASE_SERVICE_KEY` → Valor: la **service_role key** de Supabase PRD (`Project Settings → API`).
   - Puedes reutilizar la misma llave ya cargada en el proyecto Apps Script de troncales, o crear este como un proyecto nuevo con su propia propiedad — cualquiera de las dos funciona igual.

4. **Autoriza y prueba**
   - Selecciona la función **`probar_inicial`** (o `probar_actualizacion` / `probar_cierre`) y pulsa **Ejecutar**.
   - Google pedirá permisos (Gmail, conexión externa) → acepta con `jcandia@ebema.cl`.
   - Revisa **Registros de ejecución**. Si no hay ningún centro en PROGRAMAR hoy, no se envía nada (es normal).
   - En Supabase, tabla **`correo_plan_carga_log`**, verás el detalle de cada intento (`ok` / `sin_destinatarios` / `error`).

5. **Programa las 3 corridas automáticas**
   - Selecciona la función **`crearTriggersCorreoPlanCarga`** y pulsa **Ejecutar** (una sola vez).
   - Crea los 3 disparadores: **08:30, 12:00 y 15:30** (hora Chile). El propio script se salta sábados y domingos.

## Requisito para que un usuario reciba el correo

En **Roles y Perfiles** de la plataforma, el usuario debe tener rol **Owner** o **Admin. Depósito** y estar activo. El **Centro de Preferencia** es opcional:
- Sin centro asignado (`null`) → recibe el correo de **todos** los centros en PROGRAMAR (comportamiento por defecto de la mayoría de los usuarios actuales).
- Con uno o más centros asignados → recibe el correo solo de esos centros puntuales (como ya usa `rgutierrez@ebema.cl`, acotado a 1040).

## Verificar / diagnosticar

- Tabla `correo_plan_carga_log` en Supabase: una fila por (corrida, centro, destinatario), con `pct`, `status`, cantidad de líneas del CSV y `estado` del envío.
- `sin_destinatarios` significa que ningún usuario tiene ese centro en su Centro de Preferencia — no es un error, pero conviene revisar si ese centro debería tener a alguien asignado.

## Feriados de Chile

Hoy el gate de días hábiles es lunes a viernes simple (no excluye feriados). Existe la tabla `public.feriados_chile` en Supabase, creada para activar ese filtro más adelante sin rediseñar el script.
