# -*- coding: utf-8 -*-
"""
=============================================================================
 SIT EBEMA  |  MOTOR DE ASIGNACION DE CLUSTER OPERATIVO  (v4)
=============================================================================
Consolida RUTAS DE TRANSPORTE (maestro), DENSIDAD LOGISTICA y FRECUENCIAS,
y genera la vista "CLUSTER" lista para persistir/editar en la plataforma.

Principios:
  * Procesamiento POR CENTRO (ID real, ej. Puerto Montt = 1100 / PMO).
  * El MOTOR (azimut/eje + densidad) corre SOLO sobre rutas tipo COMUNA.
  * Las rutas tipo SECTOR NO entran al motor: HEREDAN el cluster de su
    comuna padre (cascada). En plataforma, editar la comuna arrastra sus sectores.
  * NOMENCLATURA HOMOLOGABLE: el Eje Vial y el Cluster usan codigos cardinales
    universales (NORTE/SUR/ESTE/OESTE...) validos en CUALQUIER centro.
    La descripcion geografica local (ej. "Sur-Isla") es solo un alias de lectura
    por centro y NO forma parte del codigo homologable.
  * Rutas INTERREGIONALES (definidas por el maestro) -> SPOT automatico.

Dependencias exclusivas: pandas, numpy.
=============================================================================
"""

import numpy as np
import pandas as pd


# =============================================================================
# 0. CONFIGURACION DE CENTROS Y REGLAS DE NEGOCIO
# =============================================================================

CENTROS_META = {
    1100: {"codigo": "PMO", "region": "Los Lagos", "lat": -41.4689, "lon": -72.9411, "nombre": "Puerto Montt"},
    # 1200: {"codigo": "TAL", "region": "Maule",     "lat": -35.4264, "lon": -71.6554, "nombre": "Talca"},
    # 1300: {"codigo": "CST", "region": "Los Lagos", "lat": -42.4820, "lon": -73.7650, "nombre": "Castro"},
}

GRUPOS_HOMOLOGACION = [
    # [1100, 1101, 1102],
]

# --- Cartas de Eje Vial por centro. La CLAVE es el codigo HOMOLOGABLE (cardinal,
#     valido en todo centro); 'alias' es la descripcion local (solo lectura).
#     rangos = sectores de azimut [min, max) en grados (0=N, 90=E).
EJES_PUERTO_MONTT = {
    "NORTE": {"alias": "Norte (Ruta 5 Norte)",                "rangos": [(310.0, 360.0), (0.0, 50.0)]},
    "ESTE":  {"alias": "Austral-Costa (Cordillera oriental)", "rangos": [(50.0, 160.0)]},
    "SUR":   {"alias": "Sur-Isla (Insular / Canales)",        "rangos": [(160.0, 310.0)]},
}
# Ejemplo de otro centro: Talca (mismos codigos homologables, alias distintos)
EJES_TALCA = {
    "NORTE": {"alias": "Norte (Ruta 5 a Curico)",  "rangos": [(300.0, 360.0), (0.0, 60.0)]},
    "ESTE":  {"alias": "Precordillera (Vilches)",  "rangos": [(60.0, 160.0)]},
    "OESTE": {"alias": "Costa (Constitucion)",     "rangos": [(200.0, 300.0)]},
    "SUR":   {"alias": "Sur (Linares/Longavi)",    "rangos": [(160.0, 200.0)]},
}
EJES_POR_CENTRO = {1100: EJES_PUERTO_MONTT}
EJES_DEFAULT = EJES_PUERTO_MONTT

# --- Vista FRECUENCIAS: salida y flota segun clase de cluster
FRECUENCIAS = {
    "C1":                 {"frecuencia": "Diaria (Fija)",                          "flota": "Flota Propia"},
    "C2":                 {"frecuencia": "Lunes-Miercoles-Viernes (Frecuencial)",  "flota": "Flota Propia"},
    "C3":                 {"frecuencia": "Martes-Jueves (Acoplado por Arrastre)",  "flota": "Flota Propia (Consolida en Hub)"},
    "C4":                 {"frecuencia": "A Demanda / Servicio Extra",             "flota": "Servicio Extra (Contratado por viaje)"},
    "SPOT_LOCAL":         {"frecuencia": "A Demanda (SLA 48 Hrs)",                 "flota": "Servicio Extra (Tercerizado FTL)"},
    "SPOT_INTERREGIONAL": {"frecuencia": "A Demanda (SLA 48 Hrs)",                 "flota": "Servicio Extra"},
}

MAPA_DENSIDAD = {
    "cluster 1": "C1", "clúster 1": "C1", "c1": "C1", "1": "C1",
    "cluster 2": "C2", "clúster 2": "C2", "c2": "C2", "2": "C2",
    "cluster 3": "C3", "clúster 3": "C3", "c3": "C3", "3": "C3",
    "cluster 4": "C4", "clúster 4": "C4", "c4": "C4", "4": "C4",
    "spot": "SPOT_LOCAL", "spot local": "SPOT_LOCAL", "aislada": "SPOT_LOCAL",
    "desconectada": "SPOT_LOCAL",
}
ORDEN_DENSIDAD = {"C1": 1, "C2": 2, "C3": 3, "C4": 4, "SPOT_LOCAL": 5}
_INV_DENSIDAD = {v: k for k, v in ORDEN_DENSIDAD.items()}


# =============================================================================
# 1. HOMOLOGACION DE CENTROS  (Regla A)
# =============================================================================

def normalizar_densidad(etiqueta):
    if pd.isna(etiqueta):
        return "SPOT_LOCAL"
    return MAPA_DENSIDAD.get(str(etiqueta).strip().lower(), "SPOT_LOCAL")


def homologar_centros(df_densidad, grupos=GRUPOS_HOMOLOGACION):
    """Regla A: centros de un grupo comparten densidad por comuna (mayor densidad)."""
    df = df_densidad.copy()
    df["densidad_norm"] = df["densidad"].apply(normalizar_densidad)
    df["_rank"] = df["densidad_norm"].map(ORDEN_DENSIDAD)
    df["densidad_homologada"] = df["densidad_norm"]
    centro_a_grupo = {c: gid for gid, g in enumerate(grupos) for c in g}
    df["_grupo"] = df["centro"].map(centro_a_grupo)
    mask = df["_grupo"].notna()
    if mask.any():
        best = df[mask].groupby(["_grupo", "comuna"])["_rank"].transform("min")
        df.loc[mask, "_rank"] = best.values
        df.loc[mask, "densidad_homologada"] = df.loc[mask, "_rank"].map(_INV_DENSIDAD)
    return df.drop(columns=["_rank", "_grupo"])


# =============================================================================
# 2. VECTORIZACION GEOGRAFICA  (Regla C)  -- solo COMUNAS regionales
# =============================================================================

def calcular_azimut(lat_o, lon_o, lat_d, lon_d):
    """Rumbo inicial origen->destino en grados 0..360 (0=N, 90=E)."""
    lat1, lat2 = np.radians(lat_o), np.radians(lat_d)
    dlon = np.radians(lon_d - lon_o)
    x = np.sin(dlon) * np.cos(lat2)
    y = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(dlon)
    return (np.degrees(np.arctan2(x, y)) + 360.0) % 360.0


def asignar_eje(azimut, carta_ejes=EJES_DEFAULT):
    """
    Retorna (codigo_homologable, alias_local).
    codigo_homologable: cardinal universal (NORTE/SUR/ESTE/OESTE...).
    """
    if pd.isna(azimut):
        return ("SIN-EJE", "Sin eje asignado")
    for codigo, cfg in carta_ejes.items():
        for lo, hi in cfg["rangos"]:
            if lo <= azimut < hi:
                return (codigo, cfg["alias"])
    return ("SIN-EJE", "Sin eje asignado")


# =============================================================================
# 3. CLASIFICADOR DE UNA COMUNA (jerarquia de reglas)
# =============================================================================

def _es_interregional(row):
    """Regla B: la interregionalidad la define el maestro ('clasificacion')."""
    clasif = str(row.get("clasificacion", "")).strip().lower()
    if clasif in ("interregional", "inter", "interreg"):
        return True
    if clasif in ("regional", "intra", "intraregional"):
        return False
    meta = CENTROS_META.get(row["centro"], {})
    return str(meta.get("region", "")).strip().lower() != str(row.get("region_destino", "")).strip().lower()


def clasificar_comuna(row):
    """
    Clasifica UNA comuna y devuelve dict homologable:
      eje_vial (cardinal), descripcion_eje (alias local), cluster_asignado,
      frecuencia, flota.
    """
    if _es_interregional(row):
        r = FRECUENCIAS["SPOT_INTERREGIONAL"]
        return {"eje_vial": "INTERREGIONAL", "descripcion_eje": "Interregional (SLA 48h)",
                "cluster_asignado": "SPOT_INTERREGIONAL",
                "frecuencia": r["frecuencia"], "flota": r["flota"]}

    meta = CENTROS_META.get(row["centro"], {})
    carta = EJES_POR_CENTRO.get(row["centro"], EJES_DEFAULT)
    az = calcular_azimut(meta.get("lat"), meta.get("lon"), row["latitud"], row["longitud"])
    eje, alias = asignar_eje(az, carta)

    dens = row["densidad_homologada"]
    if dens == "SPOT_LOCAL":
        r = FRECUENCIAS["SPOT_LOCAL"]
        return {"eje_vial": eje, "descripcion_eje": alias,
                "cluster_asignado": "SPOT_LOCAL",
                "frecuencia": r["frecuencia"], "flota": r["flota"]}

    r = FRECUENCIAS[dens]
    # Cluster HOMOLOGABLE: {CARDINAL}-{Cx}  ->  ej. SUR-C1, NORTE-C2, ESTE-C4
    return {"eje_vial": eje, "descripcion_eje": alias,
            "cluster_asignado": f"{eje}-{dens}",
            "frecuencia": r["frecuencia"], "flota": r["flota"]}


# =============================================================================
# 4. ORQUESTADOR  (motor sobre comunas; sectores heredan por cascada)
# =============================================================================

CLAS_COLS = ["eje_vial", "descripcion_eje", "cluster_asignado", "frecuencia", "flota"]
COLS_SALIDA = ["Centro", "Codigo Origen", "Destino", "Tipo Destino", "Comuna Padre",
               "Eje Vial", "Descripcion Eje", "Cluster de la Ruta Asignado",
               "Frecuencia Asignada", "Tipo de Flota Requerido"]


def _procesar_centro(df_rutas_c, dens_hom):
    codigo = CENTROS_META.get(df_rutas_c["centro"].iloc[0], {}).get("codigo", "")

    # (1) MOTOR: solo COMUNAS -> cruzan densidad y se clasifican
    comunas = df_rutas_c[df_rutas_c["tipo_destino"].str.upper() == "COMUNA"].copy()
    comunas = comunas.merge(
        dens_hom[["centro", "comuna", "densidad_homologada"]],
        left_on=["centro", "destino"], right_on=["centro", "comuna"], how="left",
    )
    comunas["densidad_homologada"] = comunas["densidad_homologada"].fillna("SPOT_LOCAL")
    clasif = comunas.apply(clasificar_comuna, axis=1, result_type="expand")
    comunas = pd.concat([comunas, clasif], axis=1)

    ref = comunas[["destino"] + CLAS_COLS].rename(columns={"destino": "comuna_padre"})

    # (2) TODAS las rutas heredan de su comuna padre (cascada comuna->sector)
    full = df_rutas_c.merge(ref, on="comuna_padre", how="left")

    # Respaldo: sector con comuna padre sin clasificar -> se clasifica solo
    huerf = full[full["eje_vial"].isna()]
    if len(huerf):
        h = huerf.copy().merge(
            dens_hom[["centro", "comuna", "densidad_homologada"]],
            left_on=["centro", "comuna_padre"], right_on=["centro", "comuna"], how="left")
        h["densidad_homologada"] = h["densidad_homologada"].fillna("SPOT_LOCAL")
        hc = h.apply(clasificar_comuna, axis=1, result_type="expand")
        for col in CLAS_COLS:
            full.loc[huerf.index, col] = hc[col].values

    full["codigo_origen"] = codigo
    out = full.rename(columns={
        "centro": "Centro", "codigo_origen": "Codigo Origen", "destino": "Destino",
        "tipo_destino": "Tipo Destino", "comuna_padre": "Comuna Padre",
        "eje_vial": "Eje Vial", "descripcion_eje": "Descripcion Eje",
        "cluster_asignado": "Cluster de la Ruta Asignado",
        "frecuencia": "Frecuencia Asignada", "flota": "Tipo de Flota Requerido",
    })[COLS_SALIDA]
    return out


def generar_vista_cluster(df_rutas, df_densidad):
    """
    df_rutas (maestro): centro, destino, tipo_destino(COMUNA|SECTOR), comuna_padre,
                        clasificacion(REGIONAL|INTERREGIONAL), region_destino, km, latitud, longitud
    df_densidad        : centro, comuna, densidad   (solo COMUNAS)
    """
    dens_hom = homologar_centros(df_densidad)
    partes = [_procesar_centro(df_rutas[df_rutas["centro"] == cid].copy(), dens_hom)
              for cid in df_rutas["centro"].unique()]
    salida = pd.concat(partes, ignore_index=True)
    salida["_ir"] = (salida["Eje Vial"] == "INTERREGIONAL").astype(int)
    salida = (salida.sort_values(["Centro", "_ir", "Eje Vial",
                                  "Cluster de la Ruta Asignado", "Comuna Padre", "Tipo Destino"])
                    .drop(columns="_ir").reset_index(drop=True))
    return salida


def a_registros_supabase(cluster_df):
    """Convierte la vista CLUSTER a registros para upsert en la tabla cluster_rutas."""
    ren = {
        "Centro": "centro", "Codigo Origen": "codigo_origen", "Destino": "destino",
        "Tipo Destino": "tipo_destino", "Comuna Padre": "comuna_padre",
        "Eje Vial": "eje_vial", "Descripcion Eje": "descripcion_eje",
        "Cluster de la Ruta Asignado": "cluster", "Frecuencia Asignada": "frecuencia",
        "Tipo de Flota Requerido": "tipo_flota",
    }
    df = cluster_df.rename(columns=ren)
    df["editado_manual"] = False
    return df.to_dict(orient="records")


# =============================================================================
# 5. DATOS SIMULADOS -- SOLO PUERTO MONTT (1100 / PMO)
# =============================================================================

def _demo_puerto_montt():
    rutas = pd.DataFrame([
        # centro, destino, tipo, comuna_padre, clasificacion, region_destino, km, lat, lon
        (1100, "Puerto Varas", "COMUNA", "Puerto Varas", "REGIONAL", "Los Lagos", 20,  -41.3195, -72.9854),
        (1100, "Llanquihue",   "COMUNA", "Llanquihue",   "REGIONAL", "Los Lagos", 28,  -41.2560, -73.0090),
        (1100, "Frutillar",    "COMUNA", "Frutillar",    "REGIONAL", "Los Lagos", 47,  -41.1250, -73.0570),
        (1100, "Cochamo",      "COMUNA", "Cochamo",      "REGIONAL", "Los Lagos", 98,  -41.4970, -72.3130),
        (1100, "Hualaihue",    "COMUNA", "Hualaihue",    "REGIONAL", "Los Lagos", 178, -42.0500, -72.6500),
        (1100, "Calbuco",      "COMUNA", "Calbuco",      "REGIONAL", "Los Lagos", 55,  -41.7710, -73.1330),
        (1100, "Maullin",      "COMUNA", "Maullin",      "REGIONAL", "Los Lagos", 65,  -41.6180, -73.6050),
        (1100, "Los Muermos",  "COMUNA", "Los Muermos",  "REGIONAL", "Los Lagos", 58,  -41.3990, -73.4700),
        (1100, "Ancud",        "COMUNA", "Ancud",        "REGIONAL", "Los Lagos", 88,  -41.8690, -73.8300),
        (1100, "Castro",       "COMUNA", "Castro",       "REGIONAL", "Los Lagos", 180, -42.4820, -73.7650),
        # SECTORES (heredan de su comuna padre por cascada)
        (1100, "Ensenada",     "SECTOR", "Puerto Varas", "REGIONAL", "Los Lagos", 47,  -41.2010, -72.5720),
        (1100, "Ralun",        "SECTOR", "Cochamo",      "REGIONAL", "Los Lagos", 78,  -41.3900, -72.2900),
        (1100, "Pargua",       "SECTOR", "Calbuco",      "REGIONAL", "Los Lagos", 60,  -41.8080, -73.4870),
        (1100, "Dalcahue",     "SECTOR", "Castro",       "REGIONAL", "Los Lagos", 200, -42.3780, -73.6520),
        # INTERREGIONALES (maestro -> SPOT automatico)
        (1100, "Valdivia",     "COMUNA", "Valdivia",     "INTERREGIONAL", "Los Rios",     215, -39.8140, -73.2450),
        (1100, "Coyhaique",    "COMUNA", "Coyhaique",    "INTERREGIONAL", "Aysen",        900, -45.5710, -72.0680),
        (1100, "Santiago",     "COMUNA", "Santiago",     "INTERREGIONAL", "Metropolitana",1020,-33.4489, -70.6693),
    ], columns=["centro", "destino", "tipo_destino", "comuna_padre",
                "clasificacion", "region_destino", "km", "latitud", "longitud"])

    densidad = pd.DataFrame([
        (1100, "Puerto Varas", "Cluster 1"), (1100, "Llanquihue", "Cluster 2"),
        (1100, "Frutillar", "Cluster 2"),    (1100, "Cochamo", "Cluster 4"),
        (1100, "Hualaihue", "Spot"),         (1100, "Calbuco", "Cluster 2"),
        (1100, "Maullin", "Cluster 3"),      (1100, "Los Muermos", "Cluster 4"),
        (1100, "Ancud", "Cluster 2"),        (1100, "Castro", "Cluster 1"),
    ], columns=["centro", "comuna", "densidad"])
    return rutas, densidad


# =============================================================================
# 6. EJECUCION DEMO
# =============================================================================

if __name__ == "__main__":
    pd.set_option("display.max_rows", None)
    pd.set_option("display.width", 240)

    df_rutas, df_densidad = _demo_puerto_montt()
    cluster = generar_vista_cluster(df_rutas, df_densidad)

    print("=" * 120)
    print("VISTA CLUSTER (nomenclatura homologable)  --  PUERTO MONTT (1100 / PMO)")
    print("=" * 120)
    print(cluster.to_string(index=False))

    print("\n--- Codigos de cluster generados (todos homologables, aplicables a cualquier centro) ---")
    print(sorted(cluster["Cluster de la Ruta Asignado"].unique()))

    out = "/tmp/SIT_EBEMA_Vista_CLUSTER.xlsx"
    with pd.ExcelWriter(out, engine="openpyxl") as xw:
        cluster.to_excel(xw, sheet_name="CLUSTER_PMO", index=False)
    print(f"\n[OK] Exportado: {out}  ({len(cluster)} rutas)")
