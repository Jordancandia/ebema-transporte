-- =============================================================================
--  SIT EBEMA  |  Vista CLUSTER en plataforma  (APLICADO en PRD humhokvdowfqicjopbhf)
--  Tabla editable + cascada automatica comuna->sectores + recalculo con overrides.
--  Nomenclatura de cluster HOMOLOGABLE (NORTE/SUR/ESTE/OESTE/INTERREGIONAL).
--  NOTA: centro es TEXT (alineado a routes.origenId y app_centro()).
-- =============================================================================
create table if not exists public.cluster_rutas (
    id              bigint generated always as identity primary key,
    centro          text         not null,
    codigo_origen   text,
    destino         text         not null,
    tipo_destino    text         not null,               -- 'Comuna' | 'Sector'
    comuna_padre    text         not null,
    clasificacion   text,                                 -- 'Regional' | 'Interregional'
    region_destino  text,
    densidad        text,                                 -- input editable: C1..C4 / SPOT_LOCAL
    eje_vial        text         not null,                -- HOMOLOGABLE
    descripcion_eje text,                                 -- alias local por centro (solo lectura)
    cluster         text         not null,                -- HOMOLOGABLE: ej. SUR-C1, SPOT_LOCAL
    frecuencia      text,
    tipo_flota      text,
    editado_manual  boolean      not null default false,
    updated_by      text,
    updated_at      timestamptz  not null default now(),
    constraint uq_cluster_centro_destino unique (centro, destino)
);
create index if not exists ix_cluster_centro       on public.cluster_rutas (centro);
create index if not exists ix_cluster_comuna_padre on public.cluster_rutas (centro, comuna_padre);

-- Cascada: al editar una COMUNA, arrastra sus SECTORES (enlace por comuna_padre)
create or replace function public.fn_cascada_cluster_sectores()
returns trigger language plpgsql set search_path = public as $$
begin
    if lower(NEW.tipo_destino) = 'comuna'
       and ( NEW.cluster    is distinct from OLD.cluster
          or NEW.eje_vial   is distinct from OLD.eje_vial
          or NEW.densidad   is distinct from OLD.densidad
          or NEW.frecuencia is distinct from OLD.frecuencia
          or NEW.tipo_flota is distinct from OLD.tipo_flota ) then
        update public.cluster_rutas s
           set eje_vial=NEW.eje_vial, descripcion_eje=NEW.descripcion_eje, densidad=NEW.densidad,
               cluster=NEW.cluster, frecuencia=NEW.frecuencia, tipo_flota=NEW.tipo_flota,
               editado_manual=true, updated_by=NEW.updated_by, updated_at=now()
         where s.centro=NEW.centro and lower(s.tipo_destino)='sector'
           and s.comuna_padre=NEW.comuna_padre and s.id <> NEW.id;
    end if;
    return NEW;
end; $$;

drop trigger if exists trg_cascada_cluster on public.cluster_rutas;
create trigger trg_cascada_cluster after update on public.cluster_rutas
    for each row execute function public.fn_cascada_cluster_sectores();

-- Recalculo: upsert masivo que respeta filas editadas manualmente
create or replace function public.fn_upsert_cluster(p_rows jsonb)
returns integer language plpgsql set search_path = public as $$
declare v_count integer := 0;
begin
    insert into public.cluster_rutas
        (centro, codigo_origen, destino, tipo_destino, comuna_padre, clasificacion,
         region_destino, densidad, eje_vial, descripcion_eje, cluster, frecuencia, tipo_flota, editado_manual, updated_at)
    select r->>'centro', r->>'codigo_origen', r->>'destino', r->>'tipo_destino', r->>'comuna_padre',
           r->>'clasificacion', r->>'region_destino', r->>'densidad', r->>'eje_vial', r->>'descripcion_eje',
           r->>'cluster', r->>'frecuencia', r->>'tipo_flota', false, now()
      from jsonb_array_elements(p_rows) as r
    on conflict (centro, destino) do update
        set codigo_origen=excluded.codigo_origen, tipo_destino=excluded.tipo_destino,
            comuna_padre=excluded.comuna_padre, clasificacion=excluded.clasificacion, region_destino=excluded.region_destino,
            densidad        = case when public.cluster_rutas.editado_manual then public.cluster_rutas.densidad        else excluded.densidad end,
            eje_vial        = case when public.cluster_rutas.editado_manual then public.cluster_rutas.eje_vial        else excluded.eje_vial end,
            descripcion_eje = case when public.cluster_rutas.editado_manual then public.cluster_rutas.descripcion_eje else excluded.descripcion_eje end,
            cluster         = case when public.cluster_rutas.editado_manual then public.cluster_rutas.cluster         else excluded.cluster end,
            frecuencia      = case when public.cluster_rutas.editado_manual then public.cluster_rutas.frecuencia      else excluded.frecuencia end,
            tipo_flota      = case when public.cluster_rutas.editado_manual then public.cluster_rutas.tipo_flota      else excluded.tipo_flota end,
            updated_at=now();
    get diagnostics v_count = row_count; return v_count;
end; $$;

-- RLS
alter table public.cluster_rutas enable row level security;
drop policy if exists cluster_select on public.cluster_rutas;
create policy cluster_select on public.cluster_rutas for select
  using ( app_role() in ('OWNER','ADMIN') or centro = app_centro() );
drop policy if exists cluster_write on public.cluster_rutas;
create policy cluster_write on public.cluster_rutas for all
  using ( app_role() in ('OWNER','ADMIN','ADMINISTRADOR_DEPOSITO') and ( app_role() in ('OWNER','ADMIN') or centro = app_centro() ) )
  with check ( app_role() in ('OWNER','ADMIN','ADMINISTRADOR_DEPOSITO') and ( app_role() in ('OWNER','ADMIN') or centro = app_centro() ) );
