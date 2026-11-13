import type { APIRoute } from 'astro';
import { supabaseAdminServer } from '../../../core/supabaseAdminServer';
import { verificarUsuarioPOS } from '../../../core/verifiedPosUser';

export const prerender = false;

const responder = (payload: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const usuario = await verificarUsuarioPOS(cookies);
    if (!usuario) return responder({ ok: false, error: 'Sesión vencida.' }, 401);

    const incluirKardex = url.searchParams.get('kardex') === '1';
    if (incluirKardex && usuario.rol !== 'ADMIN' && usuario.rol !== 'SUPERVISOR') {
      return responder({ ok: false, error: 'No tienes permiso para consultar el Kardex.' }, 403);
    }

    const consultaStock = supabaseAdminServer
      .from('inventario')
      .select('producto_id, stock_actual, stock_minimo')
      .eq('sucursal_id', usuario.sucursalId);

    const consultaKardex = incluirKardex
      ? supabaseAdminServer
          .from('movimientos_inventario')
          .select('id, tipo, cantidad, stock_anterior, stock_resultante, motivo, created_at, productos ( nombre )')
          .eq('sucursal_id', usuario.sucursalId)
          .order('id', { ascending: false })
          .limit(20)
      : null;

    const [{ data, error }, kardex] = await Promise.all([consultaStock, consultaKardex]);
    if (error) throw error;
    if (kardex?.error) throw kardex.error;
    return responder({ ok: true, stock: data, kardex: kardex?.data }, 200);
  } catch (error) {
    console.error('Error consultando el stock de la sucursal:', error);
    return responder({ ok: false, error: 'No se pudo consultar el stock.' }, 500);
  }
};
