-- Ejecutar en el SQL Editor de Supabase antes de desplegar la aplicación web.
-- El Kardex previo y los saldos existentes se conservan. No se reprocesan ventas.
begin;

-- El catálogo actual tiene gaseosas y otras bebidas en la misma categoría.
-- La categoría Snacks se controla completa. Las gaseosas se identifican por nombre.
create or replace function public.producto_controla_stock_pos(p_producto_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select lower(trim(c.nombre)) in ('snack', 'snacks')
      or (lower(trim(c.nombre)) in ('bebidas frías', 'bebidas frias', 'gaseosas')
          and (lower(trim(c.nombre)) = 'gaseosas'
               or p.nombre ~* '^(gaseosa|simba)([[:space:]]|$)'))
    from public.productos p
    join public.categorias c on c.id = p.categoria_id
    where p.id = p_producto_id
  ), false);
$$;

create or replace function public.verificar_operador_inventario_pos(
  p_usuario_id uuid, p_sucursal_id bigint
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (auth.uid() is not null and auth.uid() is distinct from p_usuario_id)
     or not exists (
       select 1 from public.usuarios u
       where u.id = p_usuario_id and u.activo
         and (u.rol = 'ADMIN' or coalesce(u.sucursal_id, 1) = p_sucursal_id
              or exists (
                select 1 from public.usuarios_sucursales us
                where us.usuario_id = u.id and us.sucursal_id = p_sucursal_id
              ))
     ) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = '42501';
  end if;
end;
$$;

-- p_delta es la diferencia de unidades vendidas. Un valor negativo devuelve
-- como máximo las unidades de este pedido que todavía constan como descontadas.
create or replace function public.mover_stock_pedido_pos(
  p_pedido public.pedidos, p_usuario_id uuid, p_producto_id bigint,
  p_delta bigint, p_motivo text, p_tipo_devolucion public.tipo_movimiento_inv
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_inventario public.inventario%rowtype;
  v_delta bigint := p_delta;
  v_saldo bigint;
begin
  if v_delta < 0 then
    select coalesce(sum(m.stock_anterior::bigint - m.stock_resultante), 0)
      into v_saldo
    from public.movimientos_inventario m
    where m.pedido_id = p_pedido.id
      and m.sucursal_id = p_pedido.sucursal_id
      and m.producto_id = p_producto_id;
    v_delta := greatest(v_delta, -greatest(v_saldo, 0));
  end if;

  if v_delta = 0 then
    return;
  end if;

  select * into v_inventario
  from public.inventario
  where sucursal_id = p_pedido.sucursal_id and producto_id = p_producto_id
  for update;

  if not found or v_inventario.stock_actual < v_delta then
    raise exception 'Stock insuficiente para %. Disponible: %, solicitado: %.',
      (select nombre from public.productos where id = p_producto_id),
      coalesce(v_inventario.stock_actual, 0), v_delta;
  end if;

  update public.inventario
  set stock_actual = stock_actual - v_delta, updated_at = now()
  where id = v_inventario.id;

  insert into public.movimientos_inventario (
    inventario_id, sucursal_id, producto_id, usuario_id, pedido_id,
    tipo, cantidad, stock_anterior, stock_resultante, motivo
  ) values (
    v_inventario.id, p_pedido.sucursal_id, p_producto_id, p_usuario_id, p_pedido.id,
    case when v_delta > 0 then 'SALIDA_VENTA'::public.tipo_movimiento_inv else p_tipo_devolucion end,
    abs(v_delta), v_inventario.stock_actual, v_inventario.stock_actual - v_delta, p_motivo
  );
end;
$$;

-- Las RPC anteriores se conservan para delegar la creación, la numeración,
-- la anulación administrativa y la reversión del pago.
do $$
begin
  if to_regprocedure('public.crear_pedido_pos_original(bigint,uuid,text,integer,numeric,jsonb,text)') is null then
    alter function public.crear_pedido_pos(bigint,uuid,text,integer,numeric,jsonb,text)
      rename to crear_pedido_pos_original;
  end if;
  if to_regprocedure('public.anular_pedido_pos_original(bigint,uuid,text,boolean)') is null then
    alter function public.anular_pedido_pos(bigint,uuid,text,boolean)
      rename to anular_pedido_pos_original;
  end if;
end;
$$;

alter function public.crear_pedido_pos_original(bigint,uuid,text,integer,numeric,jsonb,text)
  set search_path = public;
alter function public.anular_pedido_pos_original(bigint,uuid,text,boolean)
  set search_path = public;

create or replace function public.crear_pedido_pos(
  p_apertura_caja_id bigint, p_usuario_id uuid, p_cliente_nombre text,
  p_numero_mesa integer, p_descuento_global numeric, p_items jsonb,
  p_tipo_servicio text default 'mesa'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sucursal_id bigint;
  v_pedido_id bigint;
  v_pedido public.pedidos%rowtype;
  v_producto record;
begin
  select sucursal_id into v_sucursal_id
  from public.apertura_cajas
  where id = p_apertura_caja_id and estado = 'ABIERTA';

  if not found then
    raise exception 'La caja no está abierta.';
  end if;
  perform public.verificar_operador_inventario_pos(p_usuario_id, v_sucursal_id);

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'El pedido debe contener productos.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 or exists (
    select 1 from jsonb_array_elements(p_items) i
    where coalesce(i->>'producto_id', '') !~ '^[1-9][0-9]*$'
       or coalesce(i->>'cantidad', '') !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Hay un producto con datos inválidos en el pedido.';
  end if;

  v_pedido_id := public.crear_pedido_pos_original(
    p_apertura_caja_id, p_usuario_id, p_cliente_nombre, p_numero_mesa,
    p_descuento_global, p_items, p_tipo_servicio
  );
  select * into strict v_pedido from public.pedidos where id = v_pedido_id;

  for v_producto in
    select d.producto_id, (sum(d.cantidad) - coalesce((
      select sum(m.stock_anterior::bigint - m.stock_resultante)
      from public.movimientos_inventario m
      where m.pedido_id = v_pedido.id and m.sucursal_id = v_pedido.sucursal_id
        and m.producto_id = d.producto_id
    ), 0))::bigint as diferencia
    from public.detalle_pedidos d
    where d.pedido_id = v_pedido.id and public.producto_controla_stock_pos(d.producto_id)
    group by d.producto_id
    order by d.producto_id
  loop
    perform public.mover_stock_pedido_pos(
      v_pedido, p_usuario_id, v_producto.producto_id,
      v_producto.diferencia, 'Salida por comanda', 'AJUSTE_POSITIVO'
    );
  end loop;
  return v_pedido.id;
end;
$$;

create or replace function public.editar_pedido_pos(
  p_pedido_id bigint, p_usuario_id uuid, p_cliente_nombre text,
  p_numero_mesa integer, p_descuento_global numeric, p_items jsonb,
  p_metodo_pago text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_producto record;
  v_detalles_previos jsonb;
  v_subtotal numeric;
  v_total numeric;
  v_descuento numeric := greatest(0, coalesce(p_descuento_global, 0));
  v_metodo public.metodo_pago := nullif(p_metodo_pago, '')::public.metodo_pago;
begin
  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'Pedido no encontrado.';
  end if;
  perform public.verificar_operador_inventario_pos(p_usuario_id, v_pedido.sucursal_id);
  if exists (select 1 from public.usuarios where id = p_usuario_id and rol = 'MESERO') then
    raise exception 'No tienes permiso para editar pedidos.' using errcode = '42501';
  end if;
  if v_pedido.estado = 'ANULADO' then
    raise exception 'No se puede editar un pedido anulado.';
  end if;
  if exists (
    select 1 from public.pagos p
    join public.apertura_cajas c on c.id = p.apertura_caja_id
    where p.pedido_id = p_pedido_id and c.estado = 'CERRADA'
  ) then
    raise exception 'No se puede editar un pedido con pagos en una caja cerrada.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'El pedido debe contener productos.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 or exists (
    select 1
    from jsonb_array_elements(p_items) i
    left join public.productos p on p.id = (i->>'producto_id')::bigint
    where coalesce(i->>'cantidad', '') !~ '^[1-9][0-9]*$'
       or p.id is null
       or (not p.activo and not exists (
         select 1 from public.detalle_pedidos d
         where d.pedido_id = p_pedido_id and d.producto_id = p.id
       ))
  ) then
    raise exception 'Hay un producto con datos inválidos en el pedido.';
  end if;

  for v_producto in
    select producto_id, sum(cantidad)::bigint as diferencia
    from (
      select producto_id, -cantidad::bigint as cantidad
      from public.detalle_pedidos where pedido_id = p_pedido_id
      union all
      select (i->>'producto_id')::bigint, (i->>'cantidad')::bigint
      from jsonb_array_elements(p_items) i
    ) cantidades
    group by producto_id
    having sum(cantidad) <> 0
    order by producto_id
  loop
    if v_producto.diferencia < 0 or public.producto_controla_stock_pos(v_producto.producto_id) then
      perform public.mover_stock_pedido_pos(
        v_pedido, p_usuario_id, v_producto.producto_id,
        v_producto.diferencia, 'Edición de comanda', 'AJUSTE_POSITIVO'
      );
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb)
    into v_detalles_previos
  from public.detalle_pedidos d where d.pedido_id = p_pedido_id;

  delete from public.detalle_pedidos where pedido_id = p_pedido_id;

  -- Android omite el corte y envía cero como descuento de una línea existente.
  -- La web envía explícitamente el corte (incluso nulo) y el descuento elegido.
  with nuevos as (
    select i, row_number() over (partition by i->>'producto_id' order by posicion) as numero
    from jsonb_array_elements(p_items) with ordinality as items(i, posicion)
  ), anteriores as (
    select i, row_number() over (partition by i->>'producto_id' order by posicion) as numero
    from jsonb_array_elements(v_detalles_previos) with ordinality as items(i, posicion)
  ), detalle as (
    select p.id as producto_id, (n.i->>'cantidad')::integer as cantidad,
      coalesce(nullif((n.i->>'precio_unitario')::numeric, 0), p.precio_base) as precio,
      case when n.i ? 'tipo_corte' then coalesce((n.i->>'descuento_item')::numeric, 0)
           else coalesce(nullif((n.i->>'descuento_item')::numeric, 0),
                         (a.i->>'descuento_item')::numeric, 0) end as descuento,
      coalesce(n.i->>'notas', '') as notas,
      case when n.i ? 'tipo_corte' then n.i->>'tipo_corte'
           when coalesce(n.i->>'notas', '') ~ '~corte=[A-Z]+(,[A-Z]+)*~' then null
           else a.i->>'tipo_corte' end as corte
    from nuevos n
    join public.productos p on p.id = (n.i->>'producto_id')::bigint
    left join anteriores a on a.i->>'producto_id' = n.i->>'producto_id' and a.numero = n.numero
  )
  insert into public.detalle_pedidos (
    pedido_id, producto_id, cantidad, precio_unitario, descuento_item, notas, tipo_corte
  )
  select p_pedido_id, producto_id, cantidad, precio,
    least(precio * cantidad, greatest(0, descuento)), notas, corte
  from detalle;

  select coalesce(sum(subtotal), 0) into v_subtotal
  from public.detalle_pedidos where pedido_id = p_pedido_id;
  v_descuento := least(v_descuento, v_subtotal);

  update public.pedidos
  set cliente_nombre = coalesce(nullif(trim(p_cliente_nombre), ''), 'Cliente Mostrador'),
      numero_mesa = coalesce(p_numero_mesa, numero_mesa),
      subtotal = v_subtotal, descuento = v_descuento, updated_at = now()
  where id = p_pedido_id returning total into v_total;

  -- Si hay pagos fraccionados, el cambio se distribuye conservando el total.
  with anteriores as (
    select id, monto, sum(monto) over () as total,
      sum(monto) over (order by id) as acumulado, count(*) over () as cantidad,
      row_number() over (order by id) as posicion
    from public.pagos where pedido_id = p_pedido_id
  )
  update public.pagos p
  set monto = case when a.total > 0
      then round(v_total * a.acumulado / a.total, 2)
         - round(v_total * (a.acumulado - a.monto) / a.total, 2)
      else round(v_total * a.posicion / a.cantidad, 2)
         - round(v_total * (a.posicion - 1) / a.cantidad, 2)
      end,
    metodo = coalesce(v_metodo, p.metodo)
  from anteriores a where a.id = p.id;

  return jsonb_build_object(
    'pedido_id', p_pedido_id, 'subtotal', v_subtotal, 'descuento', v_descuento,
    'total', v_total, 'items', jsonb_array_length(p_items)
  );
end;
$$;

-- Mantiene el tipo de respuesta de la RPC instalada.
do $migration$
declare
  v_retorno text := pg_get_function_result(
    'public.anular_pedido_pos_original(bigint,uuid,text,boolean)'::regprocedure
  );
begin
  execute format($def$
    create or replace function public.anular_pedido_pos(
      p_pedido_id bigint, p_usuario_id uuid, p_motivo text,
      p_devolver_stock boolean default true
    )
    returns %s
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_pedido public.pedidos%%rowtype;
      v_producto record;
      v_resultado %s;
      v_cantidades jsonb;
    begin
      select * into v_pedido from public.pedidos where id = p_pedido_id for update;
      if not found then
        raise exception 'Pedido no encontrado.';
      end if;
      perform public.verificar_operador_inventario_pos(p_usuario_id, v_pedido.sucursal_id);

      if v_pedido.estado <> 'ANULADO' and p_devolver_stock then
        select jsonb_agg(to_jsonb(d)) into v_cantidades
        from (
          select producto_id, sum(cantidad)::bigint as cantidad
          from public.detalle_pedidos where pedido_id = p_pedido_id
          group by producto_id
        ) d;
      end if;

      v_resultado := public.anular_pedido_pos_original(p_pedido_id, p_usuario_id, p_motivo, false);

      if v_cantidades is not null and exists (
        select 1 from public.pedidos where id = p_pedido_id and estado = 'ANULADO'
      ) then
        for v_producto in
          select producto_id, cantidad
          from jsonb_to_recordset(v_cantidades) as d(producto_id bigint, cantidad bigint)
          order by producto_id
        loop
          perform public.mover_stock_pedido_pos(
            v_pedido, p_usuario_id, v_producto.producto_id,
            -v_producto.cantidad, p_motivo, 'ENTRADA_ANULACION'
          );
        end loop;
      end if;
      return v_resultado;
    end;
    $body$;
  $def$, v_retorno, v_retorno);
end;
$migration$;

revoke all on function public.verificar_operador_inventario_pos(uuid,bigint),
  public.mover_stock_pedido_pos(public.pedidos,uuid,bigint,bigint,text,public.tipo_movimiento_inv),
  public.crear_pedido_pos_original(bigint,uuid,text,integer,numeric,jsonb,text),
  public.anular_pedido_pos_original(bigint,uuid,text,boolean)
  from public, anon, authenticated, service_role;

revoke all on function public.crear_pedido_pos(bigint,uuid,text,integer,numeric,jsonb,text),
  public.editar_pedido_pos(bigint,uuid,text,integer,numeric,jsonb,text),
  public.anular_pedido_pos(bigint,uuid,text,boolean) from public, anon;
grant execute on function public.crear_pedido_pos(bigint,uuid,text,integer,numeric,jsonb,text),
  public.editar_pedido_pos(bigint,uuid,text,integer,numeric,jsonb,text),
  public.anular_pedido_pos(bigint,uuid,text,boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
