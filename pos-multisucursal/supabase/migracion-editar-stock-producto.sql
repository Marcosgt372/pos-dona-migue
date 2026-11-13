-- Ejecutar en Supabase antes de publicar la edición de stock en el catálogo.
begin;

create or replace function public.editar_producto_con_stock_pos(
  p_usuario_id uuid,
  p_sucursal_id bigint,
  p_producto_id bigint,
  p_cambios jsonb,
  p_stock_anterior integer,
  p_stock_actual integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_producto public.productos%rowtype;
  v_cambios public.productos%rowtype;
  v_stock integer;
  v_diferencia integer;
  v_tipo public.tipo_movimiento_inv;
begin
  if not exists (
    select 1 from public.usuarios u
    where u.id = p_usuario_id and u.activo and u.rol in ('ADMIN', 'SUPERVISOR')
      and coalesce(u.sucursal_id, 1) = p_sucursal_id
  ) then
    raise exception 'No tienes permiso para editar el stock de esta sucursal.'
      using errcode = '42501';
  end if;

  if p_stock_actual is null or p_stock_actual < 0
     or p_stock_anterior is null or p_stock_anterior < 0 then
    raise exception 'El stock debe ser un entero mayor o igual a cero.'
      using errcode = '22023';
  end if;

  select * into strict v_producto
  from public.productos where id = p_producto_id for no key update;
  v_cambios := jsonb_populate_record(v_producto, p_cambios);

  insert into public.inventario (sucursal_id, producto_id, stock_actual, stock_minimo)
  values (p_sucursal_id, p_producto_id, 0, 5)
  on conflict (sucursal_id, producto_id) do nothing;

  select stock_actual into strict v_stock
  from public.inventario
  where sucursal_id = p_sucursal_id and producto_id = p_producto_id
  for update;

  if v_stock <> p_stock_anterior and v_stock <> p_stock_actual then
    raise exception 'El stock cambió a % unidades. Recarga el catálogo antes de ajustar el saldo.', v_stock
      using errcode = 'PT409';
  end if;

  v_diferencia := p_stock_actual - v_stock;
  if v_diferencia <> 0 then
    v_tipo := case when v_diferencia > 0 then 'AJUSTE_POSITIVO' else 'AJUSTE_MERMA' end;
    perform public.ajustar_inventario_pos(
      p_sucursal_id, p_producto_id, p_usuario_id, v_tipo,
      abs(v_diferencia), 'Corrección de stock desde el catálogo'
    );
  end if;

  update public.productos
  set categoria_id = v_cambios.categoria_id,
      nombre = v_cambios.nombre,
      descripcion = v_cambios.descripcion,
      precio_base = v_cambios.precio_base,
      imagen_url = v_cambios.imagen_url,
      activo = v_cambios.activo
  where id = p_producto_id
  returning * into v_producto;

  return to_jsonb(v_producto) || jsonb_build_object(
    'categorias', (select jsonb_build_object('nombre', c.nombre)
                   from public.categorias c where c.id = v_producto.categoria_id),
    'stock_actual', p_stock_actual
  );
end;
$$;

revoke all on function public.editar_producto_con_stock_pos(uuid,bigint,bigint,jsonb,integer,integer)
  from public, anon, authenticated;
grant execute on function public.editar_producto_con_stock_pos(uuid,bigint,bigint,jsonb,integer,integer)
  to service_role;

notify pgrst, 'reload schema';
commit;
