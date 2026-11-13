-- Ejecutar en el SQL Editor de Supabase antes de publicar el formulario.
begin;

create or replace function public.crear_producto_con_stock_pos(
  p_usuario_id uuid,
  p_sucursal_id bigint,
  p_categoria_id bigint,
  p_nombre text,
  p_descripcion text,
  p_precio_base numeric,
  p_imagen_url text,
  p_activo boolean,
  p_stock_inicial integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_producto public.productos%rowtype;
begin
  if not exists (
    select 1 from public.usuarios u
    where u.id = p_usuario_id and u.activo and u.rol in ('ADMIN', 'SUPERVISOR')
      and coalesce(u.sucursal_id, 1) = p_sucursal_id
  ) then
    raise exception 'No tienes permiso para crear productos en esta sucursal.'
      using errcode = '42501';
  end if;

  if p_stock_inicial is null or p_stock_inicial < 0 then
    raise exception 'El stock inicial debe ser un entero mayor o igual a cero.'
      using errcode = '22023';
  end if;

  insert into public.productos (categoria_id, nombre, descripcion, precio_base, imagen_url, activo)
  values (p_categoria_id, p_nombre, p_descripcion, p_precio_base, p_imagen_url, p_activo)
  returning * into v_producto;

  insert into public.inventario (sucursal_id, producto_id, stock_actual, stock_minimo)
  select s.id, v_producto.id, 0, 5 from public.sucursales s
  on conflict (sucursal_id, producto_id) do nothing;

  if p_stock_inicial > 0 then
    perform public.ajustar_inventario_pos(
      p_sucursal_id, v_producto.id, p_usuario_id, 'ENTRADA_ABASTECIMIENTO',
      p_stock_inicial, 'Stock inicial al crear el producto'
    );
  end if;

  return to_jsonb(v_producto) || jsonb_build_object(
    'categorias', (select jsonb_build_object('nombre', c.nombre)
                   from public.categorias c where c.id = v_producto.categoria_id),
    'stock_actual', (select i.stock_actual from public.inventario i
                     where i.sucursal_id = p_sucursal_id and i.producto_id = v_producto.id)
  );
end;
$$;

revoke all on function public.crear_producto_con_stock_pos(uuid,bigint,bigint,text,text,numeric,text,boolean,integer)
  from public, anon, authenticated;
grant execute on function public.crear_producto_con_stock_pos(uuid,bigint,bigint,text,text,numeric,text,boolean,integer)
  to service_role;

notify pgrst, 'reload schema';
commit;
