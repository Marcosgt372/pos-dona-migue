-- Aplicar después de migracion-inventario-ventas.sql.
begin;

-- Android omite p_tipo_servicio. Una sola firma con valor por defecto
-- evita que PostgreSQL y PostgREST tengan que elegir entre dos RPC.
drop function if exists public.crear_pedido_pos(bigint,uuid,text,integer,numeric,jsonb);

do $$
begin
  if to_regprocedure('public.crear_pedido_con_inventario_pos(bigint,uuid,text,integer,numeric,jsonb,text)') is null then
    alter function public.crear_pedido_pos(bigint,uuid,text,integer,numeric,jsonb,text)
      rename to crear_pedido_con_inventario_pos;
  end if;
end;
$$;

create or replace function public.crear_pedido_pos(
  p_apertura_caja_id bigint, p_usuario_id uuid, p_cliente_nombre text,
  p_numero_mesa integer, p_descuento_global numeric, p_items jsonb,
  p_tipo_servicio text default 'mesa'
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
  v_descuento numeric := coalesce(p_descuento_global, 0);
begin
  -- Coordina la apertura de una comanda con el cierre de caja.
  perform 1 from public.apertura_cajas
  where id = p_apertura_caja_id and estado = 'ABIERTA' for share;
  if not found then
    raise exception 'La caja no está abierta.';
  end if;

  v_id := public.crear_pedido_con_inventario_pos(
    p_apertura_caja_id, p_usuario_id, p_cliente_nombre, p_numero_mesa,
    v_descuento, p_items, p_tipo_servicio
  );
  update public.pedidos
  set estado = 'PENDIENTE', descuento = v_descuento
  where id = v_id and v_descuento between 0 and subtotal;
  if not found then
    raise exception 'El descuento debe estar entre cero y el subtotal de la comanda.';
  end if;
  return v_id;
end;
$$;

drop function if exists public.registrar_pago_pos(bigint,bigint,uuid,text,numeric,text);

create or replace function public.registrar_pago_pos(
  p_pedido_id bigint, p_apertura_caja_id bigint, p_usuario_id uuid,
  p_metodo text, p_monto numeric, p_referencia_pago text default null,
  p_descuento numeric default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_metodo public.metodo_pago := p_metodo::public.metodo_pago;
  v_descuento numeric;
  v_total numeric;
begin
  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found or v_pedido.apertura_caja_id is distinct from p_apertura_caja_id then
    raise exception 'El pedido no pertenece a la caja indicada.';
  end if;
  perform public.verificar_operador_inventario_pos(p_usuario_id, v_pedido.sucursal_id);
  if v_pedido.estado not in ('PENDIENTE', 'PAGADO') then
    raise exception 'No se puede cobrar un pedido con estado %.', v_pedido.estado;
  end if;

  select sum(monto) into v_total from public.pagos where pedido_id = p_pedido_id;
  if v_total is not null then
    return jsonb_build_object('pedido_id', p_pedido_id, 'total_pedido', v_pedido.total,
      'total_pagado', v_total, 'saldo_pendiente', greatest(v_pedido.total - v_total, 0),
      'estado_pedido', v_pedido.estado);
  end if;

  perform 1 from public.apertura_cajas
  where id = p_apertura_caja_id and estado = 'ABIERTA' for share;
  if not found then
    raise exception 'La caja está cerrada. No se puede registrar el pago.';
  end if;

  v_descuento := coalesce(p_descuento, v_pedido.descuento);
  if v_descuento not between 0 and v_pedido.subtotal then
    raise exception 'El descuento supera el subtotal del pedido.';
  end if;

  update public.pedidos
  set descuento = v_descuento, descuento_global = v_descuento, updated_at = now()
  where id = p_pedido_id returning total into v_total;
  if p_descuento is null and round(p_monto, 2) is distinct from round(v_total, 2) then
    raise exception 'El monto no coincide con el total de la comanda.';
  end if;

  insert into public.pagos (pedido_id, apertura_caja_id, usuario_id, metodo, monto, referencia_pago)
  values (p_pedido_id, p_apertura_caja_id, p_usuario_id, v_metodo, v_total, p_referencia_pago);

  update public.pedidos set estado = 'PAGADO' where id = p_pedido_id;
  return jsonb_build_object('pedido_id', p_pedido_id, 'total_pedido', v_total,
    'total_pagado', v_total, 'saldo_pendiente', 0, 'estado_pedido', 'PAGADO');
end;
$$;

revoke all on function public.crear_pedido_con_inventario_pos(bigint,uuid,text,integer,numeric,jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function public.crear_pedido_pos(bigint,uuid,text,integer,numeric,jsonb,text),
  public.registrar_pago_pos(bigint,bigint,uuid,text,numeric,text,numeric) from public, anon;
grant execute on function public.crear_pedido_pos(bigint,uuid,text,integer,numeric,jsonb,text),
  public.registrar_pago_pos(bigint,bigint,uuid,text,numeric,text,numeric) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
