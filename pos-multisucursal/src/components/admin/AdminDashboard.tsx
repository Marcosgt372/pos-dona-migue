import React, { useState } from 'react';
import { toast, Toaster } from 'sonner';
import {
  TrendingUp, AlertOctagon, Ban, ArrowUpRight,
  ArrowDownRight, ShieldAlert, PlusCircle, History,
} from 'lucide-react';
import { PosService, type TipoMovimientoInv } from '../../services/pos.service';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Field, Input, Textarea } from '../ui/Field';

interface PedidoDashboard {
  id: number;
  cliente_nombre: string;
  /** Ficha del turno (se reinicia en cada caja abierta). */
  numero_ficha?: number | null;
  total: number;
  estado: 'PENDIENTE' | 'PAGADO' | 'ANULADO';
  created_at: string;
}

interface MovimientoKardex {
  id: number;
  producto_nombre: string;
  tipo: string;
  cantidad: number;
  stock_anterior: number;
  stock_resultante: number;
  motivo: string;
  created_at: string;
}

interface Props {
  sucursalId: number;
  adminUsuarioId: string;
  pedidosIniciales: PedidoDashboard[];
  kardexInicial: MovimientoKardex[];
  productosStock: { id: number; nombre: string; stock_actual: number; stock_minimo: number }[];
}

const tonoEstado = {
  PAGADO: 'ok',
  PENDIENTE: 'brasa',
  ANULADO: 'peligro',
} as const;

function esEntrada(tipo: string) {
  return tipo.startsWith('ENTRADA') || tipo === 'AJUSTE_POSITIVO';
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AdminDashboard({
  sucursalId,
  adminUsuarioId,
  pedidosIniciales,
  kardexInicial,
  productosStock: stockInicial,
}: Props) {
  const [pedidos, setPedidos] = useState<PedidoDashboard[]>(pedidosIniciales);
  const [kardex, setKardex] = useState<MovimientoKardex[]>(kardexInicial);
  const [productosStock, setProductosStock] = useState(stockInicial);
  const solicitudInventario = React.useRef(0);
  const refrescarInventario = React.useCallback(async () => {
    const solicitud = ++solicitudInventario.current;
    try {
      const respuesta = await fetch('/api/inventario/stock?kardex=1');
      if (!respuesta.ok) return;
      const { stock, kardex: movimientos } = await respuesta.json() as {
        stock: { producto_id: number; stock_actual: number; stock_minimo: number }[];
        kardex: (Omit<MovimientoKardex, 'producto_nombre'> & { productos: { nombre: string } | null })[];
      };
      if (solicitud !== solicitudInventario.current) return;
      const porProducto = new Map(stock.map((fila) => [fila.producto_id, fila]));
      setProductosStock((prev) => prev.map((producto) => {
        const fila = porProducto.get(producto.id);
        return fila ? { ...producto, stock_actual: fila.stock_actual, stock_minimo: fila.stock_minimo } : producto;
      }));
      setKardex(movimientos.map(({ productos, ...movimiento }) => ({
        ...movimiento,
        producto_nombre: productos?.nombre || 'Producto',
        motivo: movimiento.motivo || 'Sin observación',
      })));
    } catch (error) {
      console.error('No se pudo actualizar el inventario del panel:', error);
    }
  }, []);

  React.useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState === 'visible') void refrescarInventario();
    };
    const intervalo = window.setInterval(refrescar, 15_000);
    window.addEventListener('focus', refrescar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', refrescar);
      solicitudInventario.current++;
    };
  }, [refrescarInventario]);

  // Estados de Modales
  const [pedidoAAnular, setPedidoAAnular] = useState<PedidoDashboard | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [devolverStock, setDevolverStock] = useState(true);

  const [modalAjusteAbierto, setModalAjusteAbierto] = useState(false);
  const [productoAjusteId, setProductoAjusteId] = useState<number>(productosStock[0]?.id || 1);
  const [tipoAjuste, setTipoAjuste] = useState<TipoMovimientoInv>('ENTRADA_ABASTECIMIENTO');
  const [cantidadAjuste, setCantidadAjuste] = useState<number>(10);
  const [motivoAjuste, setMotivoAjuste] = useState('');

  // Métricas
  const totalRecaudado = pedidos
    .filter((p) => p.estado === 'PAGADO')
    .reduce((acc, p) => acc + Number(p.total), 0);
  const totalAnulados = pedidos.filter((p) => p.estado === 'ANULADO').length;
  const productosCriticos = productosStock.filter((p) => p.stock_actual <= p.stock_minimo);

  const metricas = [
    {
      etiqueta: 'Ventas netas del turno',
      valor: `Bs ${totalRecaudado.toFixed(2)}`,
      nota: 'Comandas cobradas en caja',
      Icono: TrendingUp,
      acento: 'text-ink',
      principal: true,
    },
    {
      etiqueta: 'Comandas emitidas',
      valor: String(pedidos.length),
      nota: 'Registradas en el turno',
      Icono: History,
      acento: 'text-ink',
    },
    {
      etiqueta: 'Comandas anuladas',
      valor: String(totalAnulados),
      nota: 'Reversiones registradas',
      Icono: Ban,
      acento: totalAnulados > 0 ? 'text-danger' : 'text-ink',
    },
    {
      etiqueta: 'Stock crítico',
      valor: String(productosCriticos.length),
      nota: 'Platos bajo el mínimo',
      Icono: AlertOctagon,
      acento: productosCriticos.length > 0 ? 'text-warn' : 'text-ink',
    },
  ];

  // Ejecutar Anulación
  const confirmarAnulacion = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!pedidoAAnular) return;

    const promesa = PosService.anularPedido({
      pedido_id: pedidoAAnular.id,
      usuario_id: adminUsuarioId,
      motivo: motivoAnulacion,
      devolver_stock: devolverStock,
    });

    toast.promise(promesa, {
      loading: 'Anulando y reintegrando inventario al Kardex...',
      success: () => {
        setPedidos((prev) =>
          prev.map((p) => (p.id === pedidoAAnular.id ? { ...p, estado: 'ANULADO' } : p))
        );
        setPedidoAAnular(null);
        setMotivoAnulacion('');
        void refrescarInventario();
        return `Comanda #${pedidoAAnular.id} anulada con éxito`;
      },
      error: (err) => err.message,
    });
  };

  // Ejecutar Abastecimiento o Merma
  const confirmarAjusteInventario = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const promesa = PosService.ajustarInventario({
      sucursal_id: sucursalId,
      producto_id: productoAjusteId,
      usuario_id: adminUsuarioId,
      tipo: tipoAjuste,
      cantidad: cantidadAjuste,
      motivo: motivoAjuste,
    });

    toast.promise(promesa, {
      loading: 'Registrando ajuste en Kardex...',
      success: () => {
        setModalAjusteAbierto(false);
        setMotivoAjuste('');
        void refrescarInventario();
        return 'Movimiento registrado en Kardex';
      },
      error: (err) => err.message,
    });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
      <Toaster position="top-right" richColors theme="dark" />

      {/* Cabecera */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ember">
            Sucursal #{sucursalId} · turno en curso
          </p>
          <h1 className="mt-1 text-[22px] font-extrabold leading-tight tracking-[-0.025em] text-ink sm:text-[26px]">
            Monitor de ventas y Kardex
          </h1>
          <p className="mt-1 max-w-xl text-[12.5px] leading-5 text-ink-muted">
            Recaudación, comandas del turno y trazabilidad de inventario en tiempo real.
          </p>
        </div>

        <Button
          onClick={() => setModalAjusteAbierto(true)}
          icono={<PlusCircle className="size-4" strokeWidth={2.5} />}
          className="self-start sm:self-auto"
        >
          Ajustar stock
        </Button>
      </header>

      {/* Métricas */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {metricas.map(({ etiqueta, valor, nota, Icono, acento, principal }) => (
          <section
            key={etiqueta}
            className={`flex flex-col justify-between rounded-card border border-line-strong bg-card p-3.5 sm:p-4 ${
              principal ? 'col-span-2 lg:col-span-1' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                {etiqueta}
              </h2>
              <Icono className="size-4 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden />
            </div>
            <p
              className={`mt-2.5 font-mono font-bold tracking-[-0.02em] tnum ${acento} ${
                principal ? 'text-[26px] sm:text-[28px]' : 'text-[22px] sm:text-[24px]'
              }`}
            >
              {valor}
            </p>
            <p className="mt-1 text-[11.5px] leading-4 text-ink-faint">{nota}</p>
          </section>
        ))}
      </div>

      {/* Paneles */}
      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Comandas */}
        <section className="overflow-hidden rounded-card border border-line-strong bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-bold tracking-[-0.01em] text-ink">
              Últimas comandas del turno
            </h2>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
              top 25
            </span>
          </div>

          {pedidos.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-ink-faint">
              No hay comandas registradas en este turno.
            </p>
          ) : (
            <>
              {/* Escritorio */}
              <table className="hidden w-full border-collapse text-left md:table">
                <caption className="sr-only">Comandas recientes con su estado y total</caption>
                <thead>
                  <tr className="border-b border-line bg-sunken text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Ficha</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Cliente</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Total</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Estado</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pedidos.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-raised/60">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[12.5px] font-bold text-ink tnum">
                          {p.numero_ficha
                            ? `#${String(p.numero_ficha).padStart(3, '0')}`
                            : `#${String(p.id).padStart(4, '0')}`}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10px] text-ink-faint">
                          {hora(p.created_at)}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-2.5 text-[12.5px] text-ink-soft">
                        {p.cliente_nombre || 'Cliente mostrador'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[12.5px] font-semibold text-ink tnum">
                        {Number(p.total).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tono={tonoEstado[p.estado]}>{p.estado}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {p.estado !== 'ANULADO' ? (
                          <button
                            type="button"
                            onClick={() => setPedidoAAnular(p)}
                            className="h-8 rounded-[7px] border border-danger/30 bg-danger/10 px-2.5 text-[11.5px] font-semibold text-danger transition-colors hover:bg-danger/18"
                          >
                            Anular
                          </button>
                        ) : (
                          <span className="text-[11px] text-ink-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Móvil */}
              <ul className="divide-y divide-line md:hidden">
                {pedidos.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px] font-bold text-ink tnum">
                          {p.numero_ficha
                            ? `#${String(p.numero_ficha).padStart(3, '0')}`
                            : `#${p.id}`}
                        </span>
                        <Badge tono={tonoEstado[p.estado]}>{p.estado}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-ink-muted">
                        {p.cliente_nombre || 'Cliente mostrador'} · {hora(p.created_at)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[13px] font-bold text-ink tnum">
                      {Number(p.total).toFixed(2)}
                    </span>
                    {p.estado !== 'ANULADO' && (
                      <button
                        type="button"
                        onClick={() => setPedidoAAnular(p)}
                        aria-label={`Anular comanda ${p.id}`}
                        className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-danger/30 bg-danger/10 text-danger"
                      >
                        <Ban className="size-4" strokeWidth={2.25} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Kardex */}
        <section className="overflow-hidden rounded-card border border-line-strong bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-bold tracking-[-0.01em] text-ink">
              Movimientos de Kardex
            </h2>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
              trazabilidad
            </span>
          </div>

          {kardex.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-ink-faint">
              Sin movimientos de Kardex registrados.
            </p>
          ) : (
            <>
              {/* Escritorio */}
              <table className="hidden w-full border-collapse text-left md:table">
                <caption className="sr-only">Movimientos de inventario con stock anterior y resultante</caption>
                <thead>
                  <tr className="border-b border-line bg-sunken text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Producto</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Tipo</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Cant.</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Stock</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {kardex.map((k) => (
                    <tr key={k.id} className="transition-colors hover:bg-raised/60">
                      <td className="max-w-[160px] truncate px-4 py-2.5 text-[12.5px] font-medium text-ink">
                        {k.producto_nombre}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.05em] ${
                            esEntrada(k.tipo) ? 'text-ok' : 'text-warn'
                          }`}
                        >
                          {esEntrada(k.tipo) ? (
                            <ArrowUpRight className="size-3" strokeWidth={3} aria-hidden />
                          ) : (
                            <ArrowDownRight className="size-3" strokeWidth={3} aria-hidden />
                          )}
                          {k.tipo.split('_')[0]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[12px] font-bold text-ink tnum">
                        {k.cantidad}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[11.5px] text-ink-muted tnum">
                        {k.stock_anterior} <span aria-hidden>→</span>{' '}
                        <span className="font-bold text-ink">{k.stock_resultante}</span>
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-2.5 text-[11.5px] text-ink-faint">
                        {k.motivo}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Móvil */}
              <ul className="divide-y divide-line md:hidden">
                {kardex.map((k) => (
                  <li key={k.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium text-ink">
                        {k.producto_nombre}
                      </span>
                      <span
                        className={`flex shrink-0 items-center gap-1 font-mono text-[11px] font-bold ${
                          esEntrada(k.tipo) ? 'text-ok' : 'text-warn'
                        }`}
                      >
                        {esEntrada(k.tipo) ? (
                          <ArrowUpRight className="size-3" strokeWidth={3} aria-hidden />
                        ) : (
                          <ArrowDownRight className="size-3" strokeWidth={3} aria-hidden />
                        )}
                        {k.cantidad}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                      {k.tipo.split('_').join(' ').toLowerCase()} · {k.stock_anterior} →{' '}
                      {k.stock_resultante} · {k.motivo}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {/* Anular comanda */}
      <Modal
        abierto={!!pedidoAAnular}
        onCerrar={() => setPedidoAAnular(null)}
        titulo={`Anular comanda #${pedidoAAnular?.id ?? ''}`}
        descripcion="La acción revierte los pagos y devuelve los productos al inventario."
        posicion="centro"
        ancho="md"
        pie={
          <div className="flex items-center gap-2">
            <Button variante="secundaria" onClick={() => setPedidoAAnular(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-anular-comanda"
              variante="peligro"
              bloque
              icono={<ShieldAlert className="size-4" strokeWidth={2.25} />}
            >
              Anular y revertir
            </Button>
          </div>
        }
      >
        <form id="form-anular-comanda" onSubmit={confirmarAnulacion} className="space-y-4 p-5">
          <Field etiqueta="Motivo de la anulación" htmlFor="motivo-anulacion-admin">
            <Textarea
              id="motivo-anulacion-admin"
              required
              rows={3}
              value={motivoAnulacion}
              onChange={(e) => setMotivoAnulacion(e.target.value)}
              placeholder="Ej. error de digitación, el cliente canceló…"
            />
          </Field>

          <label
            htmlFor="devolver-stock"
            className="flex cursor-pointer items-start gap-2.5 rounded-field border border-line bg-sunken px-3 py-2.5"
          >
            <input
              id="devolver-stock"
              type="checkbox"
              checked={devolverStock}
              onChange={(e) => setDevolverStock(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-ember"
            />
            <span className="text-[12.5px] leading-5 text-ink-soft">
              Devolver automáticamente el stock al inventario
            </span>
          </label>
        </form>
      </Modal>

      {/* Ajuste de inventario */}
      <Modal
        abierto={modalAjusteAbierto}
        onCerrar={() => setModalAjusteAbierto(false)}
        titulo="Ajuste manual de inventario"
        descripcion="Todo movimiento queda registrado en el Kardex."
        posicion="centro"
        ancho="md"
        pie={
          <div className="flex items-center gap-2">
            <Button variante="secundaria" onClick={() => setModalAjusteAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="form-ajuste-stock" bloque>
              Registrar en Kardex
            </Button>
          </div>
        }
      >
        <form id="form-ajuste-stock" onSubmit={confirmarAjusteInventario} className="space-y-4 p-5">
          <Field etiqueta="Producto" htmlFor="ajuste-producto">
            <select
              id="ajuste-producto"
              value={productoAjusteId}
              onChange={(e) => setProductoAjusteId(Number(e.target.value))}
              className="h-11 w-full rounded-field border border-line-strong bg-sunken px-2.5 text-[13.5px] text-ink transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
            >
              {productosStock.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} — stock actual {p.stock_actual}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field etiqueta="Movimiento" htmlFor="ajuste-tipo">
              <select
                id="ajuste-tipo"
                value={tipoAjuste}
                onChange={(e) => setTipoAjuste(e.target.value as TipoMovimientoInv)}
                className="h-11 w-full rounded-field border border-line-strong bg-sunken px-2.5 text-[13px] text-ink transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
              >
                <option value="ENTRADA_ABASTECIMIENTO">Entrada (+)</option>
                <option value="AJUSTE_POSITIVO">Ajuste positivo (+)</option>
                <option value="AJUSTE_MERMA">Merma / dañado (−)</option>
              </select>
            </Field>

            <Field etiqueta="Cantidad" htmlFor="ajuste-cantidad">
              <Input
                id="ajuste-cantidad"
                type="number"
                min={1}
                required
                value={cantidadAjuste}
                onChange={(e) => setCantidadAjuste(parseInt(e.target.value) || 1)}
                className="font-mono tnum"
              />
            </Field>
          </div>

          <Field etiqueta="Motivo o comprobante" htmlFor="ajuste-motivo">
            <Input
              id="ajuste-motivo"
              type="text"
              required
              value={motivoAjuste}
              onChange={(e) => setMotivoAjuste(e.target.value)}
              placeholder="Ej. ingreso de insumos, remisión #45"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
