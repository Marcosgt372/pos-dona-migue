import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast, Toaster } from 'sonner';
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  QrCode,
  Banknote,
  Building2,
  Unlock,
  Lock as LockIcon,
  Receipt,
  Shield,
  Utensils,
  Flame,
  LogOut,
  Scissors,
  Check,
  Search,
  ChevronRight,
  ChevronDown,
  UtensilsCrossed,
  ShoppingBag,
} from 'lucide-react';
import { PosService, type MetodoPago } from '../../services/pos.service';
import PosHeader from './PosHeader';
import PosHistorialModal from './PosHistorialModal';
import PosTicketModal, { type TicketData } from './PosTicketModal';
import PosCorteBurbuja from './PosCorteBurbuja';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import {
  claveLinea,
  construirNotasConCorte,
  etiquetasCortes,
  productoTieneCortes as coincideConCortes,
  type TipoCorte,
} from '../../core/tiposCorte';

interface ProductoPOS {
  id: number;
  categoria_id: number;
  nombre: string;
  precio_base: number;
  imagen_url?: string;
  stock_actual: number;
  stock_minimo: number;
}

interface CartItem extends ProductoPOS {
  cantidad: number;
  descuento_item: number;
  notas: string;
  /** Cortes elegidos en la burbuja (vacío si el producto no maneja cortes). */
  tipos_corte: TipoCorte[];
  /** Identidad de la línea: producto + cortes. */
  clave: string;
}

interface PedidoPendientePago {
  id: number;
  aperturaCajaId: number;
  clienteNombre: string;
  tipoServicio: 'mesa' | 'llevar';
  carrito: CartItem[];
  subtotal: number;
  descuento: number;
  total: number;
  metodo: MetodoPago;
  efectivoRecibido: number;
  cambio: number;
  referenciaPago: string;
}

interface Props {
  cajaActivaId: number | null;
  cajaInicialInfo?: any | null;
  sucursalId: number;
  usuarioId: string;
  cajeroNombre: string;
  rol: string;
  esAdminOSupervisor: boolean;
  sucursalNombre: string;
  categoriasIniciales: { id: number; nombre: string }[];
  productosIniciales: ProductoPOS[];
}

const METODOS: { id: MetodoPago; label: string; icon: typeof Banknote }[] = [
  { id: 'EFECTIVO', label: 'Efectivo', icon: Banknote },
  { id: 'QR', label: 'Pago QR', icon: QrCode },
  { id: 'TARJETA', label: 'Tarjeta POS', icon: CreditCard },
  { id: 'TRANSFERENCIA', label: 'Transferencia', icon: Building2 },
];

const bolivianos = (n: number) => `Bs ${n.toFixed(2)}`;

export default function PosTerminal({
  cajaActivaId: cajaInicialId,
  cajaInicialInfo,
  sucursalId,
  usuarioId,
  cajeroNombre,
  rol,
  esAdminOSupervisor,
  sucursalNombre,
  categoriasIniciales,
  productosIniciales,
}: Props) {
  const [cajaId, setCajaId] = useState<number | null>(cajaInicialId);
  const [cajaInfo, setCajaInfo] = useState<any | null>(cajaInicialInfo || null);
  const [montoApertura, setMontoApertura] = useState<string>('200');
  const [abriendoCaja, setAbriendoCaja] = useState(false);

  const [productos, setProductos] = useState<ProductoPOS[]>(productosIniciales);
  const solicitudStockRef = React.useRef(0);
  const actualizarStock = React.useCallback(async () => {
    const solicitud = ++solicitudStockRef.current;
    try {
      const respuesta = await fetch('/api/inventario/stock');
      if (!respuesta.ok) return;
      const { stock } = await respuesta.json() as {
        stock: { producto_id: number; stock_actual: number; stock_minimo: number }[];
      };
      if (solicitud !== solicitudStockRef.current) return;
      const porProducto = new Map(stock.map((fila) => [fila.producto_id, fila]));
      setProductos((prev) => prev.map((producto) => {
        const fila = porProducto.get(producto.id);
        return fila ? { ...producto, stock_actual: fila.stock_actual, stock_minimo: fila.stock_minimo } : producto;
      }));
    } catch (error) {
      console.error('No se pudo actualizar el stock del POS:', error);
    }
  }, []);

  React.useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState === 'visible') void actualizarStock();
    };
    const intervalo = window.setInterval(refrescar, 15_000);
    window.addEventListener('focus', refrescar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', refrescar);
      solicitudStockRef.current++;
    };
  }, [actualizarStock]);
  const [categoriaActiva, setCategoriaActiva] = useState<number | 'TODAS'>('TODAS');
  const [busqueda, setBusqueda] = useState('');

  const [carrito, setCarrito] = useState<CartItem[]>([]);
  const carritoRef = React.useRef(carrito);
  const actualizarCarrito = (actualizar: React.SetStateAction<CartItem[]>) => {
    const siguiente =
      typeof actualizar === 'function' ? actualizar(carritoRef.current) : actualizar;
    carritoRef.current = siguiente;
    setCarrito(siguiente);
  };
  const [burbujaCorte, setBurbujaCorte] = useState<{
    producto: ProductoPOS;
    ancla: HTMLElement;
  } | null>(null);
  const [clienteNombre, setClienteNombre] = useState('');
  const [tipoServicio, setTipoServicio] = useState<'mesa' | 'llevar'>('mesa');
  /** Ficha que le tocará a la próxima comanda del turno. */
  const [proximaFicha, setProximaFicha] = useState<number | null>(null);
  const solicitudFichaRef = React.useRef(0);
  const [descuentoGlobal, setDescuentoGlobal] = useState<number>(0);

  const [comandaAbierta, setComandaAbierta] = useState(false);
  const [modalPagoAbierto, setModalPagoAbierto] = useState(false);
  const [modalCierreAbierto, setModalCierreAbierto] = useState(false);
  const [modalHistorialAbierto, setModalHistorialAbierto] = useState(false);
  const [modalTicketAbierto, setModalTicketAbierto] = useState(false);
  const [ticketParaImprimir, setTicketParaImprimir] = useState<TicketData | null>(null);
  const [procesando, setProcesando] = useState(false);
  const procesandoRef = React.useRef(false);
  const [pagoPendiente, setPagoPendiente] = useState(false);
  const pedidoPendienteRef = React.useRef<PedidoPendientePago | null>(null);

  const [metodoSeleccionado, setMetodoSeleccionado] = useState<MetodoPago>('EFECTIVO');
  const [referenciaPago, setReferenciaPago] = useState('');
  const [efectivoRecibido, setEfectivoRecibido] = useState<string>('');
  const [mostrarDetallePago, setMostrarDetallePago] = useState(false);

  const [efectivoDeclarado, setEfectivoDeclarado] = useState<string>('');
  const [digitalDeclarado, setDigitalDeclarado] = useState<string>('');
  const [observacionesCierre, setObservacionesCierre] = useState('');
  const [resultadoArqueo, setResultadoArqueo] = useState<any | null>(null);

  // Sincronizar estado de caja abierta con el backend al cargar si no viene ID inicial
  React.useEffect(() => {
    if (!cajaId) {
      PosService.obtenerEstadoCaja(sucursalId)
        .then((res) => {
          if (res?.hayCajaAbierta && res.caja) {
            setCajaInfo(res.caja);
          } else {
            setCajaInfo(null);
          }
        })
        .catch(() => {});
    }
  }, [cajaId, sucursalId]);

  // Ficha que le tocará a la próxima comanda (la base de datos la asigna al
  // crear el pedido y se reinicia en cada caja abierta).
  const cargarProximaFicha = React.useCallback(async (caja: number | null) => {
    const solicitud = ++solicitudFichaRef.current;
    if (!caja) {
      setProximaFicha(null);
      return;
    }
    try {
      const res = await fetch(`/api/pedidos/ficha?aperturaCajaId=${caja}`);
      const data = await res.json();
      if (solicitud !== solicitudFichaRef.current) return;
      if (res.ok && data.ok && data.proxima_ficha) {
        setProximaFicha(Number(data.proxima_ficha));
      } else {
        setProximaFicha(null);
      }
    } catch {
      if (solicitud === solicitudFichaRef.current) setProximaFicha(null);
    }
  }, []);

  React.useEffect(() => {
    cargarProximaFicha(cajaId);
  }, [cajaId, cargarProximaFicha]);

  const productosFiltrados = useMemo(() => {
    return productos.filter((p) => {
      const coincideCat = categoriaActiva === 'TODAS' || p.categoria_id === categoriaActiva;
      const coincideTexto = p.nombre.toLowerCase().includes(busqueda.toLowerCase());
      return coincideCat && coincideTexto;
    });
  }, [productos, categoriaActiva, busqueda]);

  // Solo los platos "mixto" ofrecen selección de corte
  const productoTieneCortes = (producto: ProductoPOS) => coincideConCortes(producto.nombre);

  const subtotalCarrito = useMemo(
    () => carrito.reduce((acc, item) => acc + (item.cantidad * item.precio_base - item.descuento_item), 0),
    [carrito]
  );
  const totalPagar = Math.max(0, subtotalCarrito - descuentoGlobal);
  const cambioEfectivo = Math.max(0, (parseFloat(efectivoRecibido) || 0) - totalPagar);
  const totalUnidades = carrito.reduce((acc, i) => acc + i.cantidad, 0);

  React.useEffect(() => {
    (window as any).__posHidratado = true;
  }, []);

  // Red de seguridad: si el panel lateral no se pinta (CSS/zoom/extensión),
  // se ofrece un botón flotante para abrir la comanda igualmente.
  const [panelLateralVisible, setPanelLateralVisible] = React.useState(true);
  React.useEffect(() => {
    const medir = () => {
      const panel = document.getElementById('comanda-lateral');
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const pintado = rect.width > 0 && rect.height > 0;
      setPanelLateralVisible((prev) => (prev === pintado ? prev : pintado));
    };
    medir();
    window.addEventListener('resize', medir);
    const temporizador = window.setInterval(medir, 1000);
    return () => {
      window.removeEventListener('resize', medir);
      window.clearInterval(temporizador);
    };
  }, []);

  React.useEffect(() => {
    setDescuentoGlobal((d) => (d > subtotalCarrito ? subtotalCarrito : d));
  }, [subtotalCarrito]);

  const handleAbrirCaja = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setAbriendoCaja(true);

    try {
      const resultadoApertura = await PosService.abrirCaja({
        sucursal_id: sucursalId,
        usuario_id: usuarioId,
        monto_inicial: parseFloat(montoApertura) || 0,
      });
      const nuevaCaja = resultadoApertura.caja;

      setProximaFicha(null);
      setCajaId(nuevaCaja.id);
      setCajaInfo(nuevaCaja);
      toast.success(`Caja #${nuevaCaja.id} habilitada con éxito`, {
        description: resultadoApertura.yaAbierta
          ? `Fondo de ${bolivianos(Number(nuevaCaja.monto_inicial))}. Ya puedes registrar ventas.`
          : `Fondo de ${bolivianos(Number(nuevaCaja.monto_inicial))}. La ficha inicia en 001.`,
        duration: 3500,
      });
    } catch (err: any) {
      toast.error('No se pudo aperturar la caja', {
        description: err.message || 'Intenta de nuevo.',
        duration: 4000,
      });
    } finally {
      setAbriendoCaja(false);
    }
  };

  const handleCerrarSesion = async () => {
    await PosService.cerrarSesion();
    window.location.href = '/login';
  };

  if (!cajaId) {
    const hayCajaAbiertaDetectada = Boolean(cajaInfo && cajaInfo.estado === 'ABIERTA');

    return (
      <div className="flex h-dvh w-full select-none items-center justify-center overflow-y-auto bg-app p-4 sm:p-6">
        <Toaster position="top-right" richColors theme="dark" />
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          className="w-full max-w-md py-6"
        >
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[13px] border border-ember/35 bg-ember/12 text-ember">
              <Flame className="size-5.5 fill-ember/25" strokeWidth={2} />
            </span>
            <div>
              <p className="text-[17px] font-extrabold leading-tight tracking-[-0.02em] text-ink">
                Doña Migue
              </p>
              <p className="text-[12px] leading-tight text-ink-muted">
                {sucursalNombre} · {cajeroNombre}
              </p>
            </div>
          </div>

          <div className="rounded-panel border border-line-strong bg-chrome p-5 shadow-pop sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[19px] font-bold leading-tight tracking-[-0.02em] text-ink">
                  Apertura de turno
                </h1>
                <p className="mt-1 text-[13px] leading-5 text-ink-muted">
                  {hayCajaAbiertaDetectada
                    ? 'Ya hay una caja abierta en esta sucursal.'
                    : 'Registra el fondo de cambio para empezar a vender.'}
                </p>
              </div>
              <Badge tono={hayCajaAbiertaDetectada ? 'ok' : 'neutro'} mono>
                {hayCajaAbiertaDetectada ? 'Abierta' : 'Sin turno'}
              </Badge>
            </div>

            {hayCajaAbiertaDetectada ? (
              <div className="space-y-3">
                <div className="rounded-card border border-ok/30 bg-ok/8 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.07em] text-ok">
                      Caja #{cajaInfo.id}
                    </span>
                    <span className="font-mono text-[13px] font-semibold text-ink tnum">
                      {cajaInfo.fecha_inicio
                        ? new Date(cajaInfo.fecha_inicio).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Hoy'}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-5 text-ink-soft">
                    Abierta por{' '}
                    <strong className="font-semibold text-ink">
                      {cajaInfo.usuarios?.nombre_completo || 'otro cajero'}
                    </strong>
                    .
                  </p>
                  <div className="mt-3 flex items-baseline justify-between border-t border-ok/20 pt-2.5">
                    <span className="text-[12px] text-ink-muted">Fondo inicial</span>
                    <span className="font-mono text-[15px] font-semibold text-ink tnum">
                      {bolivianos(Number(cajaInfo.monto_inicial || 0))}
                    </span>
                  </div>
                </div>

                <Button
                  variante="primaria"
                  tamano="lg"
                  bloque
                  icono={<Unlock className="size-4.5" strokeWidth={2.25} />}
                  onClick={() => setCajaId(cajaInfo.id)}
                >
                  Entrar al terminal
                </Button>
                <Button
                  variante="peligro-suave"
                  tamano="md"
                  bloque
                  onClick={() => {
                    setCajaId(cajaInfo.id);
                    setModalCierreAbierto(true);
                  }}
                >
                  Cerrar el turno anterior
                </Button>
              </div>
            ) : (
              <form onSubmit={handleAbrirCaja} className="space-y-4">
                <div>
                  <label
                    htmlFor="fondo-inicial"
                    className="block text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-muted"
                  >
                    Fondo inicial en efectivo
                  </label>
                  <div className="relative mt-1.5">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[15px] font-semibold text-ember">
                      Bs
                    </span>
                    <input
                      id="fondo-inicial"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={montoApertura}
                      onChange={(e) => setMontoApertura(e.target.value)}
                      className="h-14 w-full rounded-field border border-line-strong bg-sunken pl-12 pr-4 font-mono text-[24px] font-semibold text-ember tnum transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {['100', '150', '200', '300'].map((val) => {
                      const activo = montoApertura === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setMontoApertura(val)}
                          aria-pressed={activo}
                          className={`h-10 rounded-[9px] border font-mono text-[12px] font-semibold tnum transition-colors ${
                            activo
                              ? 'border-ember/50 bg-ember/12 text-ember'
                              : 'border-line-strong bg-raised text-ink-soft hover:border-control hover:text-ink'
                          }`}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Button
                  type="submit"
                  variante="primaria"
                  tamano="lg"
                  bloque
                  cargando={abriendoCaja}
                  icono={<Unlock className="size-4.5" strokeWidth={2.25} />}
                >
                  {abriendoCaja ? 'Aperturando…' : 'Aperturar caja'}
                </Button>
              </form>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            {esAdminOSupervisor ? (
              <a
                href="/admin/dashboard"
                className="inline-flex h-10 items-center gap-2 rounded-field border border-line-strong bg-chrome px-3 text-[12px] font-semibold text-ink-soft transition-colors hover:border-ember/40 hover:text-ember"
              >
                <Shield className="size-4" strokeWidth={2.25} />
                Administración
              </a>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={handleCerrarSesion}
              className="inline-flex h-10 items-center gap-2 rounded-field px-3 text-[12px] font-medium text-ink-muted transition-colors hover:bg-danger/12 hover:text-danger"
            >
              <LogOut className="size-4" strokeWidth={2} />
              Salir
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const totalEnCarrito = (productoId: number, lineas: CartItem[] = carrito) =>
    lineas.filter((i) => i.id === productoId).reduce((acc, i) => acc + i.cantidad, 0);

  const agregarAlCarrito = (
    producto: ProductoPOS,
    cortes: TipoCorte[] = [],
    cantidad: number = 1,
    notasExtra: string = '',
    piezasChuleta?: number
  ) => {
    if (producto.stock_actual <= 0) {
      toast.error(`Producto agotado: ${producto.nombre}`);
      return;
    }
    const carritoActual = carritoRef.current;
    if (totalEnCarrito(producto.id, carritoActual) + cantidad > producto.stock_actual) {
      toast.warning(`Stock máximo disponible: ${producto.stock_actual} porciones`);
      return;
    }
    const clave = claveLinea(producto.id, cortes, piezasChuleta);
    const existe = carritoActual.find((item) => item.clave === clave);
    actualizarCarrito(
      existe
        ? carritoActual.map((item) =>
            item.clave === clave ? { ...item, cantidad: item.cantidad + cantidad } : item
          )
        : [
            ...carritoActual,
            { ...producto, cantidad, descuento_item: 0, notas: notasExtra, tipos_corte: cortes, clave },
          ]
    );

    // Sin panel lateral (pantallas < lg) conviene confirmar que el plato entró.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      toast.success(`${cantidad > 1 ? `${cantidad} × ` : ''}${producto.nombre}`, {
        id: 'producto-agregado',
        description: 'Añadido a la comanda',
        duration: 2600,
        action: {
          label: 'Ver comanda',
          onClick: () => setComandaAbierta(true),
        },
      });
    }
  };

  /** Toca una tarjeta: si el plato es "mixto", abre la burbuja de corte. */
  const tocarProducto = (producto: ProductoPOS, e: React.MouseEvent<HTMLElement>) => {
    if (producto.stock_actual <= 0) {
      toast.error(`Producto agotado: ${producto.nombre}`);
      return;
    }
    if (productoTieneCortes(producto)) {
      setBurbujaCorte({ producto, ancla: e.currentTarget });
      return;
    }
    agregarAlCarrito(producto, [], 1);
  };

  const confirmarCorte = (cortes: TipoCorte[], cantidad: number, piezasChuleta?: number) => {
    if (!burbujaCorte) return;
    const notasCorte = piezasChuleta && piezasChuleta > 1 ? `${piezasChuleta} chuletas` : '';
    agregarAlCarrito(burbujaCorte.producto, cortes, cantidad, notasCorte, piezasChuleta);
    setBurbujaCorte(null);
  };

  const cambiarCantidad = (clave: string, delta: number) => {
    actualizarCarrito((prev) =>
      prev
        .map((item) => {
          if (item.clave !== clave) return item;
          const nuevaCant = item.cantidad + delta;
          if (delta > 0) {
            // El stock se descuenta por producto: se suman todas sus líneas
            const totalConCambio = totalEnCarrito(item.id, prev) - item.cantidad + nuevaCant;
            const stockActual = productos.find((producto) => producto.id === item.id)?.stock_actual ?? item.stock_actual;
            if (totalConCambio > stockActual) {
              toast.warning(`Solo quedan ${stockActual} unidades disponibles`);
              return item;
            }
          }
          return { ...item, cantidad: nuevaCant };
        })
        .filter((item) => item.cantidad > 0)
    );
  };

  const abrirCobro = () => {
    if (carrito.length === 0) return;
    setEfectivoRecibido(totalPagar.toFixed(2));
    setMostrarDetallePago(false);
    setModalPagoAbierto(true);
  };

  const eliminarLinea = (clave: string) => {
    actualizarCarrito((prev) => prev.filter((item) => item.clave !== clave));
  };

  const vaciarComanda = () => {
    actualizarCarrito([]);
    setDescuentoGlobal(0);
    setTipoServicio('mesa');
  };

  const confirmarPedidoYPago = async () => {
    const pendiente = pedidoPendienteRef.current;
    if (
      (!pendiente && (carrito.length === 0 || !cajaId)) ||
      procesandoRef.current
    ) return;
    const montoRecibido = Number(efectivoRecibido);
    if (
      !pendiente &&
      metodoSeleccionado === 'EFECTIVO' &&
      (!Number.isFinite(montoRecibido) || montoRecibido < totalPagar)
    ) {
      toast.error(`El efectivo recibido debe ser al menos ${bolivianos(totalPagar)}`);
      return;
    }

    const snapshotCarrito = pendiente?.carrito ?? [...carrito];
    const snapshotSubtotal = pendiente?.subtotal ?? subtotalCarrito;
    const snapshotDescuento = pendiente?.descuento ?? descuentoGlobal;
    const snapshotTotal = pendiente?.total ?? totalPagar;
    const snapshotCliente = pendiente?.clienteNombre ?? (clienteNombre.trim() || 'Cliente Mostrador');
    const snapshotMetodo = pendiente?.metodo ?? metodoSeleccionado;
    const snapshotEfectivo =
      pendiente?.efectivoRecibido ?? (snapshotMetodo === 'EFECTIVO' ? montoRecibido : totalPagar);
    const snapshotCambio = pendiente?.cambio ?? cambioEfectivo;
    const snapshotTipoServicio = pendiente?.tipoServicio ?? tipoServicio;
    const snapshotReferencia = pendiente?.referenciaPago ?? referenciaPago;
    const snapshotCajaId = pendiente?.aperturaCajaId ?? cajaId;

    if (!snapshotCajaId) {
      toast.error('No hay una caja abierta para registrar el pago.');
      return;
    }

    procesandoRef.current = true;
    setProcesando(true);

    const promesaTransaccion = async () => {
      let pedidoId = pedidoPendienteRef.current?.id;
      if (!pedidoId) {
        pedidoId = await PosService.crearPedido({
          apertura_caja_id: snapshotCajaId,
          usuario_id: usuarioId,
          cliente_nombre: snapshotCliente,
          items: snapshotCarrito.map((i) => ({
            producto_id: i.id,
            cantidad: i.cantidad,
            descuento_item: i.descuento_item,
            notas: construirNotasConCorte(i.notas, i.tipos_corte),
          })),
          tipo_servicio: snapshotTipoServicio,
          onPedidoCreado: (id) => {
            pedidoPendienteRef.current = {
              id,
              aperturaCajaId: snapshotCajaId,
              clienteNombre: snapshotCliente,
              tipoServicio: snapshotTipoServicio,
              carrito: snapshotCarrito,
              subtotal: snapshotSubtotal,
              descuento: snapshotDescuento,
              total: snapshotTotal,
              metodo: snapshotMetodo,
              efectivoRecibido: snapshotEfectivo,
              cambio: snapshotCambio,
              referenciaPago: snapshotReferencia,
            };
            setPagoPendiente(true);
          },
        });
      }

      await PosService.registrarPago({
        pedido_id: pedidoId,
        apertura_caja_id: snapshotCajaId,
        usuario_id: usuarioId,
        metodo: snapshotMetodo,
        monto: snapshotTotal,
        referencia_pago: snapshotReferencia,
        descuento: snapshotDescuento,
      });
      pedidoPendienteRef.current = null;
      setPagoPendiente(false);

      // Ficha asignada por la base de datos (consecutivo del turno)
      let ficha: number | null = null;
      try {
        ficha = await PosService.obtenerFicha(pedidoId);
      } catch {
        ficha = null;
      }
      cargarProximaFicha(snapshotCajaId);

      // Armar el comprobante térmico con el ID emitido
      const datosTicket: TicketData = {
        pedidoId,
        aperturaCajaId: snapshotCajaId,
        sucursalNombre,
        cajeroNombre,
        clienteNombre: snapshotCliente,
        numeroFicha: ficha,
        tipoServicio: snapshotTipoServicio,
        fecha: new Date(),
        items: snapshotCarrito.map((i) => ({
          nombre: i.nombre,
          cantidad: i.cantidad,
          precio_unitario: i.precio_base,
          subtotal: i.cantidad * i.precio_base - i.descuento_item,
          descuento_item: i.descuento_item,
          notas: i.notas,
          tipo_corte: i.tipos_corte,
        })),
        subtotal: snapshotSubtotal,
        descuento: snapshotDescuento,
        total: snapshotTotal,
        metodoPago: snapshotMetodo,
        efectivoRecibido: snapshotMetodo === 'EFECTIVO' ? snapshotEfectivo : undefined,
        cambio: snapshotMetodo === 'EFECTIVO' ? snapshotCambio : undefined,
      };

      setTicketParaImprimir(datosTicket);
      setModalTicketAbierto(true);

      actualizarCarrito([]);
      setClienteNombre('');
      setDescuentoGlobal(0);
      setTipoServicio('mesa');
      setReferenciaPago('');
      setEfectivoRecibido('');
      setModalPagoAbierto(false);
      setComandaAbierta(false);
      return { id: pedidoId, ficha };
    };

    toast.promise(promesaTransaccion(), {
      loading: 'Registrando comanda y emitiendo pago…',
      success: (r) =>
        r?.ficha
          ? `Ficha #${r.ficha} emitida. Imprimiendo ticket…`
          : `Comanda #${r?.id} emitida. Imprimiendo ticket…`,
      error: (err) => err.message,
      finally: () => {
        procesandoRef.current = false;
        setProcesando(false);
        void actualizarStock();
      },
    });
  };

  const ejecutarCierreCaja = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!cajaId) return;
    setProcesando(true);

    const promesaCierre = PosService.cerrarCaja({
      apertura_caja_id: cajaId,
      monto_efectivo_declarado: parseFloat(efectivoDeclarado) || 0,
      monto_digital_declarado: parseFloat(digitalDeclarado) || 0,
      observaciones: observacionesCierre,
    });

    toast.promise(promesaCierre, {
      loading: 'Consolidando arqueo y cerrando turno…',
      success: (data) => {
        setResultadoArqueo(data);
        return 'Turno cerrado';
      },
      error: (err) => err.message,
      finally: () => setProcesando(false),
    });
  };

  // ---------------------------------------------------------------------------
  // Comanda: se dibuja como un recibo de papel dentro del panel (escritorio) y
  // como hoja inferior en pantallas angostas. Es el mismo contenido en ambos.
  // ---------------------------------------------------------------------------
  const comanda = (enHoja: boolean) => (
    <div
      className={`paper flex h-full min-h-0 flex-col rounded-card overflow-hidden border border-paper-line/50 ${
        enHoja ? 'shadow-none' : 'shadow-paper'
      }`}
    >
      <div className={enHoja ? 'px-4 pt-5 pb-2.5' : 'px-4 pt-4 pb-2.5'}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-paper-ink-soft">
                Comanda
              </p>
              {totalUnidades > 0 && (
                <span className="rounded-full bg-paper-ink/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-paper-ink tnum">
                  {totalUnidades} {totalUnidades === 1 ? 'porción' : 'porciones'}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-paper-ink-soft">
              Caja #{cajaId} · {cajeroNombre.split(' ')[0]}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-paper-ink-soft">
              Ficha
            </p>
            <p className="stamp mt-0.5 rounded-[6px] px-2 py-0.5 text-[26px] font-bold leading-none">
              {proximaFicha !== null ? String(proximaFicha).padStart(3, '0') : '—'}
            </p>
          </div>
        </div>

        <label htmlFor="comanda-cliente" className="sr-only">
          Cliente
        </label>
        <input
          id="comanda-cliente"
          type="text"
          value={clienteNombre}
          onChange={(e) => setClienteNombre(e.target.value)}
          placeholder="Cliente (opcional)"
          autoComplete="off"
          className="field field-paper mt-3 h-9 w-full px-2.5 text-[13px]"
        />

        {/* Toggle Mesa / Para llevar */}
        <div className="mt-2.5 flex rounded-[8px] border border-paper-line bg-white/40 p-0.5">
          <button
            type="button"
            onClick={() => setTipoServicio('mesa')}
            aria-pressed={tipoServicio === 'mesa'}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-[12px] font-bold transition-all ${
              tipoServicio === 'mesa'
                ? 'bg-paper-ink text-white shadow-sm'
                : 'text-paper-ink-soft hover:text-paper-ink'
            }`}
          >
            <UtensilsCrossed className="size-3.5" strokeWidth={2.25} />
            Mesa
          </button>
          <button
            type="button"
            onClick={() => setTipoServicio('llevar')}
            aria-pressed={tipoServicio === 'llevar'}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-[12px] font-bold transition-all ${
              tipoServicio === 'llevar'
                ? 'bg-ember-strong text-white shadow-sm'
                : 'text-paper-ink-soft hover:text-paper-ink'
            }`}
          >
            <ShoppingBag className="size-3.5" strokeWidth={2.25} />
            Para llevar
          </button>
        </div>
      </div>

      <div className="mx-4 border-b border-dashed border-paper-line" />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2.5">
        <AnimatePresence initial={false}>
          {carrito.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center">
              <Utensils className="size-7 text-paper-line" strokeWidth={1.5} />
              <p className="text-[13px] leading-5 text-paper-ink-soft">
                Comanda vacía.
                <br />
                Toca un plato de la carta.
              </p>
            </div>
          ) : (
            carrito.map((item) => (
              <motion.div
                layout
                key={item.clave}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.16 }}
                className="group border-b border-dashed border-paper-line/70 py-2.5 first:pt-0 last:border-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold leading-snug text-paper-ink">
                      {item.nombre}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px] text-paper-ink-soft tnum">
                        {item.cantidad > 1
                          ? `${item.cantidad} × ${bolivianos(item.precio_base)}`
                          : bolivianos(item.precio_base)}
                      </span>
                      {item.tipos_corte.length > 0 && (
                        <span className="inline-flex items-center gap-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.05em] text-stamp">
                          <Scissors className="size-2.5" strokeWidth={2.5} aria-hidden />
                          {etiquetasCortes(item.tipos_corte)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="font-mono text-[13.5px] font-semibold text-paper-ink tnum">
                      {bolivianos(item.cantidad * item.precio_base - item.descuento_item)}
                    </span>
                    <button
                      type="button"
                      onClick={() => eliminarLinea(item.clave)}
                      title={`Eliminar ${item.nombre} de la comanda`}
                      aria-label={`Eliminar ${item.nombre} de la comanda`}
                      className="flex size-7 items-center justify-center rounded-[6px] text-paper-ink-soft/60 transition-colors hover:bg-paper-danger/10 hover:text-paper-danger active:bg-paper-danger/20"
                    >
                      <Trash2 className="size-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </div>

                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="flex shrink-0 items-center rounded-[8px] border border-paper-line bg-white/60">
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(item.clave, -1)}
                      aria-label={`Quitar una unidad de ${item.nombre}`}
                      className="flex size-8 items-center justify-center rounded-l-[7px] text-paper-ink-soft transition-colors hover:bg-black/8 hover:text-paper-ink active:bg-black/12"
                    >
                      <Minus className="size-3.5" strokeWidth={2.5} />
                    </button>
                    <span className="w-6 text-center font-mono text-[13px] font-bold text-paper-ink tnum">
                      {item.cantidad}
                    </span>
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(item.clave, 1)}
                      aria-label={`Agregar una unidad de ${item.nombre}`}
                      className="flex size-8 items-center justify-center rounded-r-[7px] text-stamp transition-colors hover:bg-black/8 active:bg-black/12"
                    >
                      <Plus className="size-3.5" strokeWidth={2.5} />
                    </button>
                  </div>

                  <label htmlFor={`nota-${item.clave}`} className="sr-only">
                    Nota de cocina para {item.nombre}
                  </label>
                  <input
                    id={`nota-${item.clave}`}
                    type="text"
                    value={item.notas}
                    onChange={(e) =>
                      actualizarCarrito((prev) =>
                        prev.map((i) => (i.clave === item.clave ? { ...i, notas: e.target.value } : i))
                      )
                    }
                    placeholder="Nota (ej. sin picante)"
                    autoComplete="off"
                    className="field field-paper h-8 min-w-0 flex-1 px-2.5 text-[12px]"
                  />
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      <div className="px-4 pb-3 pt-2">
        <div className="mb-2 border-b border-dashed border-paper-line" />

        <div className="flex items-center justify-between text-[12.5px] text-paper-ink-soft">
          <span>Subtotal</span>
          <span className="font-mono font-semibold text-paper-ink tnum">{bolivianos(subtotalCarrito)}</span>
        </div>

        <div className="mt-1.5 flex items-center justify-between text-[12.5px] text-paper-ink-soft">
          <label htmlFor="descuento-global">Descuento</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-paper-ink-soft">
              Bs
            </span>
            <input
              id="descuento-global"
              type="number"
              min={0}
              max={subtotalCarrito}
              value={descuentoGlobal || ''}
              onChange={(e) =>
                setDescuentoGlobal(
                  Math.max(0, Math.min(subtotalCarrito, parseFloat(e.target.value) || 0))
                )
              }
              step="0.01"
              placeholder="0.00"
              className="field field-paper h-9 w-24 pl-7 pr-2 text-right font-mono text-[12.5px] tnum"
            />
          </div>
        </div>

        <div className="mt-2.5 flex items-end justify-between border-t border-paper-ink/25 pt-2">
          <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-paper-ink-soft">
            Total
          </span>
          <span className="font-mono text-[24px] font-bold leading-none text-paper-ink tnum">
            {bolivianos(totalPagar)}
          </span>
        </div>

        <button
          type="button"
          disabled={carrito.length === 0 || procesando}
          onClick={abrirCobro}
          className="mt-3 flex h-13 w-full items-center justify-center gap-2 rounded-[10px] bg-ember-strong text-[14px] font-bold tracking-[-0.01em] text-white shadow-[0_10px_24px_-14px_rgba(194,65,12,0.9)] transition-colors hover:bg-ember-hover active:brightness-95 disabled:pointer-events-none disabled:opacity-40"
        >
          <ShoppingCart className="size-4.5" strokeWidth={2.25} />
          Cobrar {carrito.length > 0 ? bolivianos(totalPagar) : ''}
        </button>

        {carrito.length > 0 && (
          <button
            type="button"
            onClick={vaciarComanda}
            className="mt-1.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] text-[11.5px] font-semibold text-paper-danger transition-colors hover:bg-black/5"
          >
            <Trash2 className="size-3.5" strokeWidth={2.25} />
            Vaciar comanda
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh w-full select-none flex-col overflow-hidden bg-app">
      <Toaster position="top-right" richColors theme="dark" closeButton />

      <PosHeader
        sucursalNombre={sucursalNombre}
        cajaId={cajaId}
        cajaInfo={cajaInfo}
        cajeroNombre={cajeroNombre}
        rol={rol}
        esAdminOSupervisor={esAdminOSupervisor}
        busqueda={busqueda}
        onBusquedaChange={setBusqueda}
        onAbrirArqueo={() => setModalCierreAbierto(true)}
        onAbrirHistorial={() => setModalHistorialAbierto(true)}
      />

      <div className="flex min-h-0 flex-1">
        {/* Carta */}
        <section aria-label="Carta de platos y bebidas" className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-chrome px-3 py-2 sm:px-5">
            {[{ id: 'TODAS' as const, nombre: 'Toda la carta' }, ...categoriasIniciales].map((cat) => {
              const activa = categoriaActiva === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoriaActiva(cat.id)}
                  aria-pressed={activa}
                  className={`relative h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                    activa ? 'text-white' : 'text-ink-soft hover:bg-raised hover:text-ink'
                  }`}
                >
                  {activa && (
                    <motion.span
                      layoutId="posCategoria"
                      aria-hidden
                      className="absolute inset-0 rounded-full bg-ember-strong"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{cat.nombre}</span>
                </button>
              );
            })}
          </div>

          <div className="grid flex-1 content-start grid-cols-2 gap-2.5 overflow-y-auto p-3 pb-16 sm:grid-cols-3 sm:gap-3 sm:p-5 sm:pb-16 2xl:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {productosFiltrados.map((producto) => {
                const agotado = producto.stock_actual === 0;
                const critico = producto.stock_actual > 0 && producto.stock_actual <= producto.stock_minimo;
                const tieneCortes = productoTieneCortes(producto);

                return (
                  <motion.button
                    layout
                    key={producto.id}
                    whileTap={!agotado ? { scale: 0.975 } : undefined}
                    disabled={agotado}
                    onClick={(e) => tocarProducto(producto, e)}
                    className={`relative flex min-h-[128px] flex-col items-start justify-between gap-2 overflow-hidden rounded-card border p-3 text-left transition-colors sm:min-h-[136px] sm:p-3.5 ${
                      agotado
                        ? 'cursor-not-allowed border-line bg-chrome/40 opacity-45'
                        : 'border-line-strong bg-card hover:border-ember/50 hover:bg-raised focus-visible:border-ember'
                    }`}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <span className="line-clamp-2 text-[14px] font-bold leading-[1.25] tracking-[-0.01em] text-ink">
                        {producto.nombre}
                      </span>
                      <span
                        className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tnum ${
                          agotado
                            ? 'border-danger/35 bg-danger/15 text-danger'
                            : critico
                              ? 'border-warn/35 bg-warn/12 text-warn'
                              : 'border-line bg-black/20 text-ink-muted'
                        }`}
                      >
                        {agotado ? 'Agotado' : `${producto.stock_actual}`}
                      </span>
                    </div>

                    <div className="mt-auto flex w-full items-end justify-between gap-2">
                      <span className="font-mono text-[17px] font-semibold leading-none text-ember tnum">
                        Bs {producto.precio_base.toFixed(2)}
                      </span>
                      {tieneCortes && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-ember/35 bg-ember/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ember">
                          <Scissors className="size-3" strokeWidth={2.5} aria-hidden />
                          Cortes
                        </span>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>

            {productosFiltrados.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Search className="size-6 text-ink-faint" strokeWidth={1.75} />
                <p className="text-[13px] text-ink-muted">
                  Sin resultados para «{busqueda}»
                </p>
                <Button tamano="sm" onClick={() => { setBusqueda(''); setCategoriaActiva('TODAS'); }}>
                  Ver toda la carta
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* Comanda fija de escritorio */}
        <aside
          id="comanda-lateral"
          aria-label="Comanda actual"
          className="flex w-[330px] shrink-0 flex-col border-l border-line bg-sunken p-3 max-[1023px]:hidden xl:w-[368px] 2xl:w-[392px]"
        >
          <div className="min-h-0 flex-1">{comanda(false)}</div>
        </aside>
      </div>

      {/* Barra de cobro táctil para tablet y móvil */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-chrome px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] min-[1024px]:hidden">
        <button
          type="button"
          onClick={() => setComandaAbierta(true)}
          className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[11px] border border-line-strong bg-raised px-3 text-left transition-colors hover:border-control"
        >
          <span className="relative shrink-0 text-ember">
            <Receipt className="size-5" strokeWidth={2} />
            {totalUnidades > 0 && (
              <span className="absolute -right-2 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-ember-strong px-1 font-mono text-[10px] font-bold leading-4 text-white tnum">
                {totalUnidades}
              </span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Comanda
            </span>
            <span className="block truncate font-mono text-[14px] font-semibold text-ink tnum">
              {bolivianos(totalPagar)}
            </span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-ink-muted" strokeWidth={2.25} />
        </button>

        <Button
          variante="primaria"
          tamano="lg"
          disabled={carrito.length === 0 || procesando}
          onClick={abrirCobro}
          className="shrink-0 px-4"
        >
          Cobrar
        </Button>
      </div>

      {/* Botón flotante si el panel lateral no se está pintando */}
      {!panelLateralVisible && (
        <button
          type="button"
          onClick={() => setComandaAbierta(true)}
          className="fixed bottom-4 right-4 z-40 flex h-12 items-center gap-2 rounded-full border border-ember/50 bg-ember-strong px-4 text-[13px] font-bold text-white shadow-pop transition-transform hover:scale-[1.02] active:scale-95 max-[1023px]:hidden"
        >
          <Receipt className="size-4.5" strokeWidth={2.25} />
          Comanda
          {totalUnidades > 0 && (
            <span className="flex min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 font-mono text-[11px] font-bold tnum">
              {totalUnidades}
            </span>
          )}
          <span className="font-mono text-[12px] tnum">{bolivianos(totalPagar)}</span>
        </button>
      )}

      {/* Comanda como hoja inferior */}
      <Modal
        abierto={comandaAbierta}
        onCerrar={() => setComandaAbierta(false)}
        titulo="Comanda"
        descripcion={`Caja #${cajaId} · ${sucursalNombre}`}
        posicion="abajo"
        ancho="md"
        cuerpoSinScroll
        className="h-[86dvh] bg-app"
      >
        <div className="h-full p-2.5">{comanda(true)}</div>
      </Modal>

      {/* Burbuja de selección de tipo de corte */}
      <AnimatePresence>
        {burbujaCorte && (
          <PosCorteBurbuja
            key="burbuja-corte"
            productoNombre={burbujaCorte.producto.nombre}
            precioBase={burbujaCorte.producto.precio_base}
            stockDisponible={burbujaCorte.producto.stock_actual}
            ancla={burbujaCorte.ancla}
            onCerrar={() => setBurbujaCorte(null)}
            onSeleccionar={confirmarCorte}
          />
        )}
      </AnimatePresence>

      {/* Cobro */}
      <Modal
        abierto={modalPagoAbierto}
        onCerrar={() => {
          if (!procesandoRef.current && !pagoPendiente) setModalPagoAbierto(false);
        }}
        titulo="Cobro de comanda"
        descripcion={
          proximaFicha !== null
            ? `Se emitirá la ficha #${String(proximaFicha).padStart(3, '0')}`
            : undefined
        }
        posicion="centro"
        ancho="md"
        pie={
          <Button
            variante="primaria"
            tamano="lg"
            bloque
            cargando={procesando}
            onClick={confirmarPedidoYPago}
            icono={<Check className="size-4.5" strokeWidth={2.5} />}
          >
            {procesando
              ? 'Procesando…'
              : pagoPendiente
                ? `Reintentar pago · ${bolivianos(pedidoPendienteRef.current?.total ?? totalPagar)}`
                : `Confirmar y emitir · ${bolivianos(totalPagar)}`}
          </Button>
        }
      >
        <div className="space-y-4 p-5">
          <div className="rounded-card border border-line bg-sunken px-4 py-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Total a pagar
            </p>
            <p className="mt-0.5 font-mono text-[30px] font-bold leading-none text-ember tnum">
              {bolivianos(totalPagar)}
            </p>
          </div>

          {pagoPendiente && pedidoPendienteRef.current && (
            <div
              role="alert"
              className="rounded-field border border-warn/35 bg-warn/8 px-3.5 py-3 text-[12.5px] leading-5 text-ink-soft"
            >
              El pedido #{pedidoPendienteRef.current.id} ya fue creado y el stock descontado.
              Reintenta el pago; no se creará otro pedido.
            </div>
          )}

          {/* Resumen del pedido en el cobro para validación rápida */}
          <div className="overflow-hidden rounded-card border border-line bg-card/60">
            <button
              type="button"
              onClick={() => setMostrarDetallePago((v) => !v)}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-raised"
            >
              <div className="flex items-center gap-2">
                <Receipt className="size-4 text-ember" strokeWidth={2} />
                <span className="text-[12.5px] font-medium text-ink">
                  {totalUnidades} {totalUnidades === 1 ? 'porción' : 'porciones'} · {carrito.length} {carrito.length === 1 ? 'ítem' : 'ítems'}
                </span>
                {clienteNombre.trim() && (
                  <span className="max-w-[130px] truncate text-[11.5px] text-ink-muted">({clienteNombre.trim()})</span>
                )}
              </div>
              <div className="flex items-center gap-1 text-ink-muted">
                <span className="text-[11.5px]">{mostrarDetallePago ? 'Ocultar' : 'Ver detalle'}</span>
                <ChevronDown
                  className={`size-3.5 transition-transform duration-200 ${
                    mostrarDetallePago ? 'rotate-180' : ''
                  }`}
                />
              </div>
            </button>

            {mostrarDetallePago && (
              <div className="max-h-48 overflow-y-auto border-t border-line/60 bg-sunken/60 px-3.5 py-2">
                <ul className="divide-y divide-line/40 text-[12px]">
                  {carrito.map((item) => (
                    <li key={item.clave} className="flex items-center justify-between py-1.5">
                      <div className="min-w-0 pr-2">
                        <p className="truncate font-medium text-ink">
                          <span className="font-mono font-bold text-ember">{item.cantidad}× </span>
                          {item.nombre}
                        </p>
                        {item.tipos_corte.length > 0 && (
                          <p className="font-mono text-[10px] text-ember/80">
                            {etiquetasCortes(item.tipos_corte)}
                          </p>
                        )}
                        {item.notas && (
                          <p className="truncate text-[10.5px] italic text-ink-muted">
                            «{item.notas}»
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-ink-soft tnum">
                        {bolivianos(item.cantidad * item.precio_base - item.descuento_item)}
                      </span>
                    </li>
                  ))}
                </ul>
                {descuentoGlobal > 0 && (
                  <div className="mt-1.5 flex items-center justify-between border-t border-dashed border-line/60 pt-1.5 text-[11.5px] text-ok">
                    <span>Descuento aplicado</span>
                    <span className="font-mono">-{bolivianos(descuentoGlobal)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
              Método de pago
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {METODOS.map(({ id, label, icon: Icon }) => {
                const activo = metodoSeleccionado === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={pagoPendiente}
                    aria-pressed={activo}
                    onClick={() => setMetodoSeleccionado(id)}
                    className={`flex h-12 items-center gap-2.5 rounded-field border px-3 text-[13px] font-semibold transition-colors ${
                      activo
                        ? 'border-ember/60 bg-ember/12 text-ember'
                        : 'border-line-strong bg-raised text-ink-soft hover:border-control hover:text-ink'
                    }`}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={2.25} />
                    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                    {activo && <Check className="size-3.5 shrink-0" strokeWidth={3} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {metodoSeleccionado === 'EFECTIVO' ? (
            <div className="space-y-3">
              <Field etiqueta="Efectivo recibido" htmlFor="efectivo-recibido">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] font-semibold text-ember">
                    Bs
                  </span>
                  <input
                    id="efectivo-recibido"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    disabled={pagoPendiente}
                    value={efectivoRecibido}
                    onChange={(e) => setEfectivoRecibido(e.target.value)}
                    placeholder={totalPagar.toFixed(2)}
                    className="h-12 w-full rounded-field border border-line-strong bg-sunken pl-10 pr-3 font-mono text-[18px] font-semibold text-ink tnum transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
                  />
                </div>
              </Field>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={pagoPendiente}
                  onClick={() => setEfectivoRecibido(totalPagar.toFixed(2))}
                  className="h-9 rounded-[8px] border border-ember/40 bg-ember/10 px-3 text-[12px] font-semibold text-ember transition-colors hover:bg-ember/18"
                >
                  Exacto
                </button>
                {[20, 50, 100, 200].map((billete) => (
                  <button
                    key={billete}
                    type="button"
                    disabled={pagoPendiente}
                    onClick={() => setEfectivoRecibido(billete.toString())}
                    className="h-9 rounded-[8px] border border-line-strong bg-raised px-3 font-mono text-[12px] font-semibold text-ink-soft tnum transition-colors hover:border-control hover:text-ink"
                  >
                    {billete}
                  </button>
                ))}
              </div>

              <div className="flex items-baseline justify-between rounded-field border border-line bg-sunken px-3.5 py-2.5">
                <span className="text-[12.5px] text-ink-soft">Cambio</span>
                <span className="font-mono text-[16px] font-semibold text-ok tnum">
                  {bolivianos(cambioEfectivo)}
                </span>
              </div>
            </div>
          ) : (
            <Field
              etiqueta="Referencia o comprobante"
              ayuda="Nro. de autorización, recibo QR o últimos dígitos."
              htmlFor="referencia-pago"
            >
              <input
                id="referencia-pago"
                type="text"
                disabled={pagoPendiente}
                value={referenciaPago}
                onChange={(e) => setReferenciaPago(e.target.value)}
                placeholder="Opcional"
                autoComplete="off"
                className="h-11 w-full rounded-field border border-line-strong bg-sunken px-3 text-[14px] text-ink placeholder:text-ink-faint transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
              />
            </Field>
          )}
        </div>
      </Modal>

      {/* Arqueo y cierre */}
      <Modal
        abierto={modalCierreAbierto}
        onCerrar={() => setModalCierreAbierto(false)}
        titulo={`Arqueo y cierre · Caja #${cajaId}`}
        descripcion={
          resultadoArqueo ? 'Turno cerrado' : 'Cuenta físico y digital sin consultar el sistema'
        }
        posicion="centro"
        ancho="md"
        pie={
          resultadoArqueo ? (
            <Button variante="primaria" tamano="lg" bloque onClick={() => window.location.reload()}>
              Finalizar y desocupar terminal
            </Button>
          ) : (
            <Button
              type="submit"
              form="form-cierre-caja"
              variante="peligro"
              tamano="lg"
              bloque
              cargando={procesando}
            >
              Consolidar y cerrar caja
            </Button>
          )
        }
      >
        {!resultadoArqueo ? (
          <form id="form-cierre-caja" onSubmit={ejecutarCierreCaja} className="space-y-4 p-5">
            <div className="flex gap-2.5 rounded-field border border-warn/30 bg-warn/8 px-3.5 py-3">
              <LockIcon className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.25} />
              <p className="text-[12.5px] leading-5 text-ink-soft">
                El arqueo es ciego: declara lo que hay en gaveta antes de ver el esperado por el
                sistema.
              </p>
            </div>

            <Field etiqueta="Efectivo físico en gaveta" htmlFor="efectivo-declarado">
              <input
                id="efectivo-declarado"
                type="number"
                step="0.01"
                inputMode="decimal"
                required
                value={efectivoDeclarado}
                onChange={(e) => setEfectivoDeclarado(e.target.value)}
                placeholder="0.00"
                className="h-12 w-full rounded-field border border-line-strong bg-sunken px-3 font-mono text-[18px] font-semibold text-ink tnum transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
              />
            </Field>

            <Field etiqueta="Cobros digitales (QR / POS)" htmlFor="digital-declarado">
              <input
                id="digital-declarado"
                type="number"
                step="0.01"
                inputMode="decimal"
                required
                value={digitalDeclarado}
                onChange={(e) => setDigitalDeclarado(e.target.value)}
                placeholder="0.00"
                className="h-12 w-full rounded-field border border-line-strong bg-sunken px-3 font-mono text-[18px] font-semibold text-ink tnum transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
              />
            </Field>

            <Field etiqueta="Observaciones" htmlFor="observaciones-cierre">
              <textarea
                id="observaciones-cierre"
                rows={2}
                value={observacionesCierre}
                onChange={(e) => setObservacionesCierre(e.target.value)}
                placeholder="Incidencias del turno (opcional)"
                className="w-full rounded-field border border-line-strong bg-sunken px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
              />
            </Field>
          </form>
        ) : (
          <div className="space-y-3 p-5">
            <div className="rounded-card border border-line bg-sunken p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] text-ink-soft">Efectivo esperado</span>
                <span className="font-mono text-[14px] font-semibold text-ink tnum">
                  {bolivianos(Number(resultadoArqueo.efectivo_esperado_en_gaveta))}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2">
                <span className="text-[12.5px] font-semibold text-ink">Diferencia</span>
                <span
                  className={`font-mono text-[16px] font-bold tnum ${
                    Number(resultadoArqueo.diferencia_efectivo) < 0 ? 'text-danger' : 'text-ok'
                  }`}
                >
                  {bolivianos(Number(resultadoArqueo.diferencia_efectivo))}
                </span>
              </div>
            </div>
            <p className="text-[12.5px] leading-5 text-ink-muted">
              La caja quedó cerrada. El terminal se desocupa para el siguiente turno.
            </p>
          </div>
        )}
      </Modal>

      {/* Historial y edición */}
      <PosHistorialModal
        abierto={modalHistorialAbierto}
        onCerrar={() => setModalHistorialAbierto(false)}
        sucursalId={sucursalId}
        sucursalNombre={sucursalNombre}
        cajaActualId={cajaId}
        usuarioId={usuarioId}
        productosCatalogo={productos}
        onPedidoModificado={actualizarStock}
      />

      {/* Ticket térmico */}
      <PosTicketModal
        ticket={ticketParaImprimir}
        isOpen={modalTicketAbierto}
        onClose={() => setModalTicketAbierto(false)}
        autoPrint={true}
      />
    </div>
  );
}
