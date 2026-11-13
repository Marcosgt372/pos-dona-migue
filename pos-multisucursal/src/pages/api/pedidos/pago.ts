import type { APIRoute } from 'astro';
import { supabaseAdminServer } from '../../../core/supabaseAdminServer';
import { verificarUsuarioPOS } from '../../../core/verifiedPosUser';

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
    const pedidoId = Number(body.pedido_id);
    const aperturaCajaId = Number(body.apertura_caja_id);
    const descuento = Number(body.descuento ?? 0);
    const metodo = typeof body.metodo === 'string' ? body.metodo.toUpperCase() : '';
    const referencia =
      typeof body.referencia_pago === 'string' ? body.referencia_pago.trim() : '';

    if (
      !Number.isSafeInteger(pedidoId) ||
      pedidoId <= 0 ||
      !Number.isSafeInteger(aperturaCajaId) ||
      aperturaCajaId <= 0
    ) {
      return responder({ ok: false, error: 'El pedido o la caja no son válidos.' }, 400);
    }
    if (!Number.isFinite(descuento) || descuento < 0) {
      return responder({ ok: false, error: 'El descuento no es válido.' }, 400);
    }
    if (!METODOS_VALIDOS.has(metodo)) {
      return responder({ ok: false, error: 'El método de pago no es válido.' }, 400);
    }

    const { data: pedido, error: pedidoError } = await supabaseAdminServer
      .from('pedidos')
      .select('id, apertura_caja_id, sucursal_id, subtotal, estado')
      .eq('id', pedidoId)
      .eq('apertura_caja_id', aperturaCajaId)
      .eq('sucursal_id', usuario.sucursalId)
      .maybeSingle();

    if (pedidoError) throw new Error(`No se pudo validar el pedido: ${pedidoError.message}`);
    if (!pedido) return responder({ ok: false, error: 'El pedido no existe en tu sucursal o caja.' }, 404);
    if (pedido.estado !== 'PENDIENTE' && pedido.estado !== 'PAGADO') {
      return responder({ ok: false, error: `No se puede cobrar un pedido con estado ${pedido.estado}.` }, 400);
    }

    const subtotal = Number(pedido.subtotal);
    if (!Number.isFinite(subtotal) || descuento > subtotal) {
      return responder({ ok: false, error: 'El descuento supera el subtotal del pedido.' }, 400);
    }

    const total = Math.max(0, subtotal - descuento);
    const { data, error } = await supabaseAdminServer.rpc('registrar_pago_pos', {
      p_pedido_id: pedidoId,
      p_apertura_caja_id: aperturaCajaId,
      p_usuario_id: usuario.id,
      p_metodo: metodo,
      p_monto: total,
      p_referencia_pago: referencia || null,
      p_descuento: descuento,
    });

    if (error) {
      console.error(`Error registrando pago del pedido ${pedidoId}:`, error);
      return responder(
        { ok: false, pedido_id: pedidoId, error: error.message || 'No se pudo registrar el pago.' },
        400
      );
    }

    return responder({ ok: true, pedido_id: pedidoId, resultado: data }, 200);
  } catch (error) {
    console.error('Error en /api/pedidos/pago:', error);
    return responder(
      { ok: false, error: error instanceof Error ? error.message : 'Error interno al registrar el pago.' },
      500
    );
  }
};
