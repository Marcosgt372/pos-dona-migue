import { supabase } from '../core/supabaseClient';

export type MetodoPago = 'EFECTIVO' | 'QR' | 'TARJETA' | 'TRANSFERENCIA';
export type TipoMovimientoInv = 'ENTRADA_ABASTECIMIENTO' | 'AJUSTE_POSITIVO' | 'AJUSTE_MERMA';
export type RolUsuario = 'ADMIN' | 'SUPERVISOR' | 'CAJERO' | 'MESERO';

export interface ItemCarritoDTO {
    producto_id: number;
    cantidad: number;
    descuento_item: number;
    notas?: string;
}

/**
 * Ítem del editable de pedidos. `tipos_corte` es opcional: solo lo usan los
 * platos "mixto" (completo, costilla, matahambre, chuleta) y admite varios
 * cortes a la vez.
 */
export interface ItemEdicionDTO {
    producto_id: number;
    cantidad: number;
    precio_unitario: number;
    descuento_item?: number;
    notas?: string;
    tipos_corte?: string[];
}

/** Flag `Secure` solo cuando se navega por HTTPS (en local por http no aplica). */
function secureFlag(): string {
    return typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
}

/** Persiste la sesión en cookie (legible por el SSR) y en localStorage. */
export function guardarSesionCliente(sesionData: Record<string, unknown>) {
    if (typeof document === 'undefined') return;
    const serializado = encodeURIComponent(JSON.stringify(sesionData));
    document.cookie = `dona_migue_user=${serializado}; path=/; max-age=604800; SameSite=Lax${secureFlag()}`;
    try {
        localStorage.setItem('dona_migue_user', JSON.stringify(sesionData));
    } catch {}
}

export const PosService = {
    // ==========================================================================
    // 1. AUTENTICACIÓN Y SESIÓN (auth.users.id -> usuarios)
    // ==========================================================================
    async iniciarSesion(email: string, password: string) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);

        // Guardar el JWT en cookie para que Astro SSR pueda leer las tablas protegidas por RLS
        if (data.session) {
            document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=604800; SameSite=Lax${secureFlag()}`;
        }
        return data;
    },

    async cerrarSesion() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch {}
        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.error('Error cerrando sesión en Supabase:', e);
        }
        if (typeof document !== 'undefined') {
            document.cookie = `sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag()}`;
            document.cookie = `dona_migue_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag()}`;
            try {
                localStorage.removeItem('dona_migue_user');
            } catch {}
        }
    },

    // ==========================================================================
    // 2. FUNCIONES TRANSACCIONALES RPC (PEDIDOS, PAGOS, CAJA Y KARDEX)
    // ==========================================================================
    async abrirCaja(params: { sucursal_id: number; usuario_id: string; monto_inicial: number }) {
        const res = await fetch('/api/caja/abrir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo abrir la caja.');
        }
        return {
            caja: data.caja,
            yaAbierta: Boolean(data.yaAbierta),
        };
    },

    async obtenerEstadoCaja(sucursalId: number) {
        const res = await fetch(`/api/caja/estado?sucursalId=${sucursalId}`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo consultar el estado de la caja.');
        }
        return data;
    },

    async crearPedido(params: {
        apertura_caja_id: number;
        usuario_id: string;
        cliente_nombre: string;
        items: ItemCarritoDTO[];
        tipo_servicio?: 'mesa' | 'llevar';
        onPedidoCreado?: (pedidoId: number) => void;
    }) {
        const response = await fetch('/api/pedidos/crear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apertura_caja_id: params.apertura_caja_id,
                cliente_nombre: params.cliente_nombre,
                items: params.items,
                tipo_servicio: params.tipo_servicio || 'mesa',
            }),
        });
        const result = await response.json();
        const pedidoId = Number(result.pedido_id);

        if (!response.ok || !result.ok || !Number.isSafeInteger(pedidoId) || pedidoId <= 0) {
            if (Number.isSafeInteger(pedidoId) && pedidoId > 0) {
                params.onPedidoCreado?.(pedidoId);
            }
            throw new Error(result.error || 'No se pudo crear el pedido.');
        }
        params.onPedidoCreado?.(pedidoId);
        return pedidoId;
    },

    async aplicarDescuentoPedido(params: { pedido_id: number; descuento: number }) {
        const res = await fetch('/api/pedidos/descuento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo aplicar el descuento.');
        }
        return data.pedido;
    },

    /** Número de ficha del turno (se reinicia en cada caja abierta). */
    async obtenerFicha(pedidoId: number) {
        const res = await fetch(`/api/pedidos/ficha?pedidoId=${pedidoId}`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo obtener la ficha.');
        }
        return data.numero_ficha as number | null;
    },

    async registrarPago(params: {
        pedido_id: number;
        apertura_caja_id: number;
        usuario_id: string;
        metodo: MetodoPago;
        monto: number;
        referencia_pago?: string;
        descuento?: number;
    }) {
        const response = await fetch('/api/pedidos/pago', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pedido_id: params.pedido_id,
                apertura_caja_id: params.apertura_caja_id,
                metodo: params.metodo,
                descuento: params.descuento || 0,
                referencia_pago: params.referencia_pago || null,
            }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
            throw new Error(result.error || 'No se pudo registrar el pago.');
        }
        return result.resultado;
    },

    async listarPedidos(params?: { sucursalId?: number; cajaId?: number; estado?: string }) {
        const queryParams = new URLSearchParams();
        if (params?.sucursalId) queryParams.set('sucursalId', String(params.sucursalId));
        if (params?.cajaId) queryParams.set('cajaId', String(params.cajaId));
        if (params?.estado) queryParams.set('estado', params.estado);

        const res = await fetch(`/api/pedidos/listar?${queryParams.toString()}`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'No se pudieron obtener los pedidos.');
        }
        return data.pedidos;
    },

    async editarPedido(params: {
        pedido_id: number;
        cliente_nombre: string;
        descuento: number;
        metodo_pago?: string;
        items: ItemEdicionDTO[];
    }) {
        const res = await fetch('/api/pedidos/editar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo editar el pedido.');
        }
        return data.pedido;
    },

    async anularPedido(params: {
        pedido_id: number;
        usuario_id?: string;
        motivo: string;
        devolver_stock?: boolean;
    }) {
        const res = await fetch('/api/pedidos/anular', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo anular el pedido.');
        }
        return data.resultado;
    },

    async cerrarCaja(params: {
        apertura_caja_id: number;
        monto_efectivo_declarado: number;
        monto_digital_declarado: number;
        observaciones?: string;
    }) {
        const res = await fetch('/api/caja/cerrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo cerrar la caja.');
        }
        return data.arqueo;
    },

    async ajustarInventario(params: {
        sucursal_id: number;
        producto_id: number;
        usuario_id: string;
        tipo: TipoMovimientoInv;
        cantidad: number;
        motivo: string;
    }) {
        const response = await fetch('/api/inventario/ajustar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                producto_id: params.producto_id,
                tipo: params.tipo,
                cantidad: params.cantidad,
                motivo: params.motivo,
            }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
            throw new Error(result.error || 'No se pudo registrar el ajuste de inventario.');
        }
        return result.resultado;
    },

    // ==========================================================================
    // 3. GESTIÓN DE CATÁLOGO (CATEGORÍAS Y PRODUCTOS TERMINADOS)
    // ==========================================================================
    async crearCategoria(params: { nombre: string; descripcion: string; orden: number }) {
        const res = await fetch('/api/catalogo/categorias', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error al crear categoría');
        return json.data;
    },

    async actualizarCategoria(params: { id: number; nombre?: string; descripcion?: string; orden?: number; activa?: boolean }) {
        const res = await fetch('/api/catalogo/categorias', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error al actualizar categoría');
        return json.data;
    },

    async eliminarCategoria(id: number) {
        const res = await fetch('/api/catalogo/categorias', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error al eliminar categoría');
        return json;
    },

    async guardarProducto(params: {
        id?: number;
        categoria_id: number;
        nombre: string;
        descripcion: string;
        precio_base: number;
        imagen_url?: string;
        activo: boolean;
        stock_inicial?: number;
        stock_actual?: number;
        stock_anterior?: number;
    }) {
        const method = params.id ? 'PUT' : 'POST';
        const res = await fetch('/api/catalogo/productos', {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error al guardar plato');
        return json.data;
    },

    async eliminarProducto(id: number) {
        const res = await fetch('/api/catalogo/productos', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error al eliminar plato');
        return json;
    },

    // ==========================================================================
    // 4. GESTIÓN DE SUCURSALES Y USUARIOS
    // ==========================================================================
    async crearSucursal(params: { nombre: string; direccion: string; telefono: string }) {
        const res = await fetch('/api/organizacion/sucursales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error al crear sucursal');
        return json.data;
    },

    async actualizarSucursal(params: { id: number; nombre?: string; direccion?: string; telefono?: string; activa?: boolean }) {
        const res = await fetch('/api/organizacion/sucursales', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error al actualizar sucursal');
        return json.data;
    },

    async eliminarSucursal(id: number) {
        const res = await fetch('/api/organizacion/sucursales', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error al eliminar sucursal');
        return json;
    },

    async toggleSucursalActiva(id: number, activa: boolean) {
        return this.actualizarSucursal({ id, activa });
    },

    async actualizarUsuario(params: {
        id: string;
        nombre_completo: string;
        rol: RolUsuario;
        sucursal_id: number | null;
        activo: boolean;
    }) {
        const { data, error } = await supabase
            .from('usuarios')
            .update({
                nombre_completo: params.nombre_completo,
                rol: params.rol,
                sucursal_id: params.sucursal_id,
                activo: params.activo,
            })
            .eq('id', params.id)
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
};
