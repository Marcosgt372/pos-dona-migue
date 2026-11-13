import type { APIRoute } from 'astro';
import { supabaseAdminServer } from '../../../core/supabaseAdminServer';
import { obtenerContextoSesion } from '../../../core/sessionContext';
import { verificarUsuarioPOS } from '../../../core/verifiedPosUser';

export const prerender = false;

// POST: Crear producto / plato
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const usuario = await verificarUsuarioPOS(cookies);
    if (!usuario || (usuario.rol !== 'ADMIN' && usuario.rol !== 'SUPERVISOR')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No autorizado. Se requieren permisos de administrador.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const categoriaId = Number(body.categoria_id);
    const nombre = (body.nombre || '').trim();
    const descripcion = (body.descripcion || '').trim();
    const precioBase = Number(body.precio_base) || 0;
    const imagenUrl = body.imagen_url ? body.imagen_url.trim() : null;
    const activo = body.activo !== false;
    const stockInicial = body.stock_inicial === undefined ? 0 : body.stock_inicial;

    if (!Number.isInteger(stockInicial) || stockInicial < 0 || stockInicial > 2_147_483_647) {
      return new Response(
        JSON.stringify({ ok: false, error: 'El stock inicial debe ser un número entero entre 0 y 2.147.483.647.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!nombre) {
      return new Response(
        JSON.stringify({ ok: false, error: 'El nombre del plato es obligatorio.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!categoriaId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Debes seleccionar una categoría válida.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: producto, error } = await supabaseAdminServer.rpc('crear_producto_con_stock_pos', {
      p_usuario_id: usuario.id,
      p_sucursal_id: usuario.sucursalId,
      p_categoria_id: categoriaId,
      p_nombre: nombre,
      p_descripcion: descripcion || null,
      p_precio_base: precioBase,
      p_imagen_url: imagenUrl,
      p_activo: activo,
      p_stock_inicial: stockInicial,
    });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, data: producto }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || 'Error al guardar plato.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// PUT: Actualizar producto / plato
export const PUT: APIRoute = async ({ request, cookies }) => {
  try {
    const sesion = await obtenerContextoSesion(cookies);
    if (!sesion.autenticado || !sesion.esAdminOSupervisor) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No autorizado. Se requieren permisos de administrador.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const id = Number(body.id);
    if (!id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'ID de producto inválido.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updateData: Record<string, any> = {};
    if (body.categoria_id !== undefined) updateData.categoria_id = Number(body.categoria_id);
    if (body.nombre !== undefined) updateData.nombre = body.nombre.trim();
    if (body.descripcion !== undefined) updateData.descripcion = body.descripcion ? body.descripcion.trim() : null;
    if (body.precio_base !== undefined) updateData.precio_base = Number(body.precio_base);
    if (body.imagen_url !== undefined) updateData.imagen_url = body.imagen_url ? body.imagen_url.trim() : null;
    if (body.activo !== undefined) updateData.activo = Boolean(body.activo);

    const { data: producto, error } = await supabaseAdminServer
      .from('productos')
      .update(updateData)
      .eq('id', id)
      .select('*, categorias ( nombre )')
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, data: producto }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || 'Error al actualizar plato.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// DELETE: Eliminar producto / plato
export const DELETE: APIRoute = async ({ request, cookies }) => {
  try {
    const sesion = await obtenerContextoSesion(cookies);
    if (!sesion.autenticado || !sesion.esAdminOSupervisor) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No autorizado. Se requieren permisos de administrador.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const id = Number(body.id);
    if (!id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'ID de plato inválido.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Verificar si tiene ventas registradas en detalle_pedidos
    const { data: pedidosConProducto, error: checkError } = await supabaseAdminServer
      .from('detalle_pedidos')
      .select('id')
      .eq('producto_id', id)
      .limit(1);

    if (checkError) throw checkError;

    if (pedidosConProducto && pedidosConProducto.length > 0) {
      // Para preservar la integridad contable de los pedidos ya emitidos, lo desactivamos
      await supabaseAdminServer
        .from('productos')
        .update({ activo: false })
        .eq('id', id);

      return new Response(
        JSON.stringify({
          ok: true,
          desactivado: true,
          message: 'El plato tiene comandas registradas en historial. Ha sido desactivado y ocultado del menú para proteger los reportes contables.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Si no tiene pedidos registrados, eliminar de inventario primero y luego de productos
    await supabaseAdminServer
      .from('inventario')
      .delete()
      .eq('producto_id', id);

    const { error: delError } = await supabaseAdminServer
      .from('productos')
      .delete()
      .eq('id', id);

    if (delError) throw delError;

    return new Response(
      JSON.stringify({ ok: true, message: 'Plato eliminado permanentemente del catálogo.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || 'Error al eliminar plato.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
