import type { APIRoute } from 'astro';
import { supabaseAdminServer } from '../../../core/supabaseAdminServer';
import { verificarUsuarioPOS } from '../../../core/verifiedPosUser';
import { existeColumnaTipoCorte } from '../../../core/columnaTipoCorte';
import { formatearCortes } from '../../../core/tiposCorte';

export const prerender = false;

const METODOS_VALIDOS = new Set(['EFECTIVO', 'QR', 'TARJETA', 'TRANSFERENCIA']);

const responder = (payload: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const usuario = await verificarUsuarioPOS(cookies);
    if (!usuario) return responder({ ok: false, error: 'Sesión vencida. Inicia sesión otra vez.' }, 401);

    const body = await request.json();
    const pedidoId = Number(body?.pedido_id);
    const clienteNombre = String(body?.cliente_nombre || 'Cliente Mostrador').trim();
    const descuentoGlobal = Number(body?.descuento ?? 0);
    const metodoPago = body?.metodo_pago || null;
    const items = body?.items;

    if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) {
      return responder({ ok: false, error: 'ID de pedido inválido.' }, 400);
    }
    if (!Number.isFinite(descuentoGlobal) || descuentoGlobal < 0) {
      return responder({ ok: false, error: 'El descuento no es válido.' }, 400);
    }
    if (metodoPago && !METODOS_VALIDOS.has(metodoPago)) {
      return responder({ ok: false, error: 'El método de pago no es válido.' }, 400);
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      return responder({ ok: false, error: 'El pedido debe contener entre 1 y 100 productos.' }, 400);
    }

    const detalles = [];
    for (const item of items) {
      if (
        !item ||
        !Number.isSafeInteger(item.producto_id) || item.producto_id <= 0 ||
        !Number.isSafeInteger(item.cantidad) || item.cantidad <= 0 ||
        !Number.isFinite(item.precio_unitario) || item.precio_unitario < 0 ||
        !Number.isFinite(item.descuento_item) || item.descuento_item < 0 ||
        (item.notas != null && typeof item.notas !== 'string') ||
        (item.tipos_corte != null && !Array.isArray(item.tipos_corte))
      ) {
        return responder({ ok: false, error: 'Hay un producto con datos inválidos en el pedido.' }, 400);
      }
      detalles.push({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        descuento_item: item.descuento_item,
        notas: item.notas || '',
        tipo_corte: formatearCortes(item.tipos_corte),
      });
    }

    const { error } = await supabaseAdminServer.rpc('editar_pedido_pos', {
      p_pedido_id: pedidoId,
      p_usuario_id: usuario.id,
      p_cliente_nombre: clienteNombre,
      p_numero_mesa: null,
      p_descuento_global: descuentoGlobal,
      p_items: detalles,
      p_metodo_pago: metodoPago,
    });

    if (error) {
      if (error.code !== 'P0001' && error.code !== '42501') {
        console.error('Error editando pedido POS:', error);
      }
      return responder({ ok: false, error: error.message }, error.code === '42501' ? 403 : 400);
    }

    const conCorte = await existeColumnaTipoCorte();
    const { data: pedido, error: lecturaError } = await supabaseAdminServer
      .from('pedidos')
      .select(`
        *,
        detalle_pedidos (
          id, producto_id, cantidad, precio_unitario, descuento_item, subtotal, notas,${
            conCorte ? ' tipo_corte,' : ''
          }
          productos ( id, nombre, precio_base, categoria_id, imagen_url )
        ),
        pagos (*),
        usuarios:usuarios!pedidos_usuario_id_fkey ( id, nombre_completo, rol )
      `)
      .eq('id', pedidoId)
      .single();

    if (lecturaError) throw lecturaError;
    return responder({ ok: true, pedido, mensaje: `Pedido #${pedidoId} actualizado correctamente.` }, 200);
  } catch (error) {
    console.error('Error en /api/pedidos/editar:', error);
    return responder({ ok: false, error: 'Error interno al editar el pedido.' }, 500);
  }
};
