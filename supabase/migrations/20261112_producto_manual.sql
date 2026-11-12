-- Party House · Reserva manual con productos escritos a mano (nombre y precio libres)
create or replace function public.admin_crear_reserva(p jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_fecha date := (p->>'fecha')::date;
  v_aj public.ajustes;
  v_it jsonb; v_prod public.productos;
  v_lineas jsonb := '[]'; v_sub int := 0; v_qty int; v_precio int;
  v_solo_sin_flete boolean := true;
  v_flete int; v_desc int := greatest(coalesce((p->>'descuento')::int, 0), 0);
  v_total int; v_abono int; v_pagado int := greatest(coalesce((p->>'abono_pagado')::int, 0), 0);
  v_codigo text; v_conflicto text; v_actor text;
  abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  if v_fecha is null then raise exception 'Falta la fecha del evento'; end if;
  if coalesce(trim(p->'cliente'->>'nombre'), '') = '' then raise exception 'Falta el nombre del cliente'; end if;
  if coalesce(trim(p->'cliente'->>'telefono'), '') = '' then raise exception 'Falta el teléfono del cliente'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Agrega al menos un producto'; end if;
  select * into v_aj from public.ajustes where id = 1;
  select email into v_actor from auth.users where id = auth.uid();

  if not coalesce((p->>'forzar')::boolean, false) then
    if exists (select 1 from public.bloqueos where fecha = v_fecha and producto_id is null) then
      raise exception 'Ese día está marcado como cerrado';
    end if;
  end if;

  for v_it in select * from jsonb_array_elements(p->'items') loop
    -- Producto escrito a mano (no está en el catálogo): nombre y precio libres, no bloquea fechas
    if coalesce((v_it->>'manual')::boolean, false) then
      if coalesce(trim(v_it->>'nombre'), '') = '' then raise exception 'Falta el nombre del producto manual'; end if;
      v_qty := greatest(coalesce((v_it->>'qty')::int, 1), 1);
      v_precio := coalesce((v_it->>'precio')::int, -1);
      if v_precio < 0 then raise exception 'Falta el precio de %', trim(v_it->>'nombre'); end if;
      v_solo_sin_flete := false;
      v_lineas := v_lineas || jsonb_build_object('id', 'manual-' || substr(md5(random()::text), 1, 8), 'nombre', left(trim(v_it->>'nombre'), 120),
                                                 'qty', v_qty, 'fecha', v_fecha, 'precio', v_precio, 'manual', true);
      v_sub := v_sub + v_precio * v_qty;
      continue;
    end if;
    select * into v_prod from public.productos where id = v_it->>'id';
    if v_prod.id is null then raise exception 'Producto no encontrado: %', v_it->>'id'; end if;
    v_qty := greatest(coalesce((v_it->>'qty')::int, 1), 1);
    v_precio := coalesce((v_it->>'precio')::int, v_prod.precio);
    if v_precio < 0 then raise exception 'Precio inválido para %', v_prod.nombre; end if;
    if not v_prod.sin_flete then v_solo_sin_flete := false; end if;

    -- Disponibilidad: bloqueos manuales y reservas confirmadas del mismo equipo físico
    if not coalesce((p->>'forzar')::boolean, false) and (v_prod.bloqueo_automatico or v_prod.equipo is not null) then
      select string_agg(distinct x.nombre, ', ') into v_conflicto from (
        select pr.nombre from public.bloqueos b join public.productos pr on pr.id = b.producto_id
         where b.fecha = v_fecha and (pr.id = v_prod.id or (v_prod.equipo is not null and pr.equipo = v_prod.equipo))
        union all
        select r.codigo from public.reservas r, jsonb_array_elements(r.items) li
         where r.estado = 'pagado' and v_fecha = any(r.fechas) and (li->>'fecha')::date = v_fecha
           and (li->>'id' = v_prod.id or (v_prod.equipo is not null and li->>'id' in
                (select id from public.productos where equipo = v_prod.equipo)))
      ) x;
      if v_conflicto is not null then
        raise exception '% ya está ocupado ese día (%)', v_prod.nombre, v_conflicto;
      end if;
    end if;

    v_lineas := v_lineas || jsonb_build_object('id', v_prod.id, 'nombre', v_prod.nombre, 'qty', v_qty,
                                               'fecha', v_fecha, 'precio', v_precio);
    v_sub := v_sub + v_precio * v_qty;
  end loop;

  if p ? 'flete' and nullif(p->>'flete', '') is not null then
    v_flete := greatest((p->>'flete')::int, 0);
  elsif v_solo_sin_flete then
    v_flete := 0;
  else
    select valor into v_flete from public.comunas where nombre = p->>'comuna';
    if v_flete is null then raise exception 'La comuna "%" no tiene flete: indícalo a mano', coalesce(p->>'comuna', ''); end if;
  end if;

  v_total := greatest(v_sub + v_flete - v_desc, 0);
  v_abono := round(v_total * v_aj.abono_pct / 100.0);

  loop
    v_codigo := 'PH-' || (select string_agg(substr(abc, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 8));
    exit when not exists (select 1 from public.reservas where codigo = v_codigo);
  end loop;

  insert into public.reservas (codigo, estado, origen, items, fechas, total, abono, flete, descuento, monto_pagado,
    abono_medio, cliente_nombre, cliente_telefono, cliente_email, cliente_rut, comuna, direccion, horario, notas, notas_internas, pagada_en,
    garantia_monto, garantia_estado, aviso_enviado_en, historial)
  values (v_codigo, 'pagado', 'manual', v_lineas, array[v_fecha], greatest(v_total, 1), greatest(v_abono, 1), v_flete, v_desc, v_pagado,
    coalesce(nullif(p->>'abono_medio', ''), 'transferencia'),
    trim(p->'cliente'->>'nombre'), trim(p->'cliente'->>'telefono'), nullif(lower(trim(p->'cliente'->>'email')), ''), nullif(upper(trim(p->'cliente'->>'rut')), ''),
    coalesce(nullif(p->>'comuna', ''), 'Sin comuna'), nullif(trim(p->>'direccion'), ''), nullif(trim(p->>'horario'), ''),
    nullif(p->>'notas', ''), nullif(p->>'notas_internas', ''), now(),
    case when coalesce((p->>'garantia')::boolean, true) then v_aj.garantia_monto else 0 end,
    case when coalesce((p->>'garantia')::boolean, true) then 'pendiente' else 'no_aplica' end,
    now(),  -- reserva manual: no se envía el aviso de "abono pagado" al dueño
    jsonb_build_array(jsonb_build_object('t', now(), 'por', v_actor, 'txt',
      'Reserva manual creada' || case when v_pagado > 0 then ' · abono ' || v_pagado || ' (' || coalesce(nullif(p->>'abono_medio', ''), 'transferencia') || ')' else '' end)));
  return v_codigo;
end; $$;
