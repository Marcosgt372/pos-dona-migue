import React, { useState, useMemo } from 'react';
import { toast, Toaster } from 'sonner';
import {
  Plus, Search, Layers, Edit2, Trash2,
  AlertTriangle, X,
} from 'lucide-react';
import { PosService } from '../../services/pos.service';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Field, Input, Textarea } from '../ui/Field';

interface Categoria {
  id: number;
  nombre: string;
  descripcion?: string;
  orden?: number;
  activa?: boolean;
}

interface Producto {
  id: number;
  categoria_id: number;
  categoria_nombre: string;
  nombre: string;
  descripcion?: string;
  precio_base: number;
  activo: boolean;
  stock_actual: number;
}

interface Props {
  sucursalId: number;
  usuarioId: string;
  categoriasIniciales: Categoria[];
  productosIniciales: Producto[];
}

export default function CatalogoManager({
  categoriasIniciales,
  productosIniciales,
}: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>(categoriasIniciales);
  const [productos, setProductos] = useState<Producto[]>(productosIniciales);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<number | 'TODAS'>('TODAS');
  const [busqueda, setBusqueda] = useState('');

  // Modales
  const [modalProductoAbierto, setModalProductoAbierto] = useState(false);
  const [modalCategoriaAbierto, setModalCategoriaAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Formulario Producto
  const [productoEditando, setProductoEditando] = useState<Producto | null>(null);
  const [formNombre, setFormNombre] = useState('');
  const [formDescripcion, setFormDescripcion] = useState('');
  const [formPrecio, setFormPrecio] = useState('');
  const [formStock, setFormStock] = useState('0');
  const [formCategoriaId, setFormCategoriaId] = useState<number>(categorias[0]?.id || 1);
  const [formActivo, setFormActivo] = useState(true);

  // Eliminar Producto
  const [productoParaEliminar, setProductoParaEliminar] = useState<Producto | null>(null);
  const [eliminandoProducto, setEliminandoProducto] = useState(false);

  // Formulario Categoría (Crear / Editar)
  const [categoriaEditando, setCategoriaEditando] = useState<Categoria | null>(null);
  const [catNombre, setCatNombre] = useState('');
  const [catDescripcion, setCatDescripcion] = useState('');
  const [catOrden, setCatOrden] = useState('1');

  // Eliminar Categoría
  const [categoriaParaEliminar, setCategoriaParaEliminar] = useState<Categoria | null>(null);
  const [eliminandoCategoria, setEliminandoCategoria] = useState(false);

  const abrirModalCrearProducto = () => {
    setProductoEditando(null);
    setFormNombre('');
    setFormDescripcion('');
    setFormPrecio('');
    setFormStock('0');
    setFormCategoriaId(categorias[0]?.id || 1);
    setFormActivo(true);
    setModalProductoAbierto(true);
  };

  const abrirModalEditarProducto = (prod: Producto) => {
    setProductoEditando(prod);
    setFormNombre(prod.nombre);
    setFormDescripcion(prod.descripcion || '');
    setFormPrecio(prod.precio_base.toString());
    setFormStock(String(prod.stock_actual));
    setFormCategoriaId(prod.categoria_id);
    setFormActivo(prod.activo);
    setModalProductoAbierto(true);
  };

  const abrirModalCrearCategoria = () => {
    setCategoriaEditando(null);
    setCatNombre('');
    setCatDescripcion('');
    setCatOrden((categorias.length + 1).toString());
    setModalCategoriaAbierto(true);
  };

  const abrirModalEditarCategoria = (cat: Categoria) => {
    setCategoriaEditando(cat);
    setCatNombre(cat.nombre);
    setCatDescripcion(cat.descripcion || '');
    setCatOrden((cat.orden || 1).toString());
    setModalCategoriaAbierto(true);
  };

  const guardarProductoHandler = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const stock = Number(formStock);
    if (!formStock.trim() || !Number.isInteger(stock) || stock < 0 || stock > 2_147_483_647) {
      toast.error('Ingresa una cantidad entera mayor o igual a cero.');
      return;
    }
    const cambiaStock = productoEditando && stock !== productoEditando.stock_actual;
    setGuardando(true);

    const promesa = async () => {
      const saved = await PosService.guardarProducto({
        id: productoEditando?.id,
        categoria_id: Number(formCategoriaId),
        nombre: formNombre.trim(),
        descripcion: formDescripcion.trim(),
        precio_base: parseFloat(formPrecio) || 0,
        activo: formActivo,
        stock_inicial: productoEditando ? undefined : stock,
        stock_actual: cambiaStock ? stock : undefined,
        stock_anterior: cambiaStock ? productoEditando.stock_actual : undefined,
      });

      const catObj = categorias.find((c) => c.id === Number(formCategoriaId));
      const catNombreActual = catObj?.nombre || 'General';

      if (productoEditando) {
        setProductos((prev) =>
          prev.map((p) =>
            p.id === productoEditando.id
              ? {
                  ...p,
                  categoria_id: Number(formCategoriaId),
                  categoria_nombre: catNombreActual,
                  nombre: formNombre.trim(),
                  descripcion: formDescripcion.trim(),
                  precio_base: parseFloat(formPrecio) || 0,
                  activo: formActivo,
                  stock_actual: saved.stock_actual ?? p.stock_actual,
                }
              : p
          )
        );
      } else {
        setProductos((prev) => [
          ...prev,
          {
            id: saved.id,
            categoria_id: Number(formCategoriaId),
            categoria_nombre: catNombreActual,
            nombre: formNombre.trim(),
            descripcion: formDescripcion.trim(),
            precio_base: parseFloat(formPrecio) || 0,
            activo: formActivo,
            stock_actual: saved.stock_actual,
          },
        ]);
      }
      setModalProductoAbierto(false);
      return saved;
    };

    toast.promise(promesa(), {
      loading: productoEditando ? 'Actualizando datos del plato...' : 'Creando nuevo plato...',
      success: productoEditando ? 'Plato actualizado con éxito' : 'Plato añadido con éxito',
      error: (err) => err.message,
      finally: () => setGuardando(false),
    });
  };

  const confirmarEliminarProducto = async () => {
    if (!productoParaEliminar) return;
    setEliminandoProducto(true);

    const promesa = async () => {
      await PosService.eliminarProducto(productoParaEliminar.id);
      setProductos((prev) => prev.filter((p) => p.id !== productoParaEliminar.id));
      setProductoParaEliminar(null);
    };

    toast.promise(promesa(), {
      loading: 'Eliminando plato del catálogo...',
      success: 'Plato procesado con éxito',
      error: (err) => err.message,
      finally: () => setEliminandoProducto(false),
    });
  };

  const guardarCategoriaHandler = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setGuardando(true);

    const promesa = async () => {
      if (categoriaEditando) {
        const catActualizada = await PosService.actualizarCategoria({
          id: categoriaEditando.id,
          nombre: catNombre.trim(),
          descripcion: catDescripcion.trim(),
          orden: parseInt(catOrden) || 1,
        });

        setCategorias((prev) =>
          prev.map((c) => (c.id === categoriaEditando.id ? { ...c, ...catActualizada } : c))
        );

        // Actualizar nombres en productos
        setProductos((prev) =>
          prev.map((p) =>
            p.categoria_id === categoriaEditando.id
              ? { ...p, categoria_nombre: catActualizada.nombre }
              : p
          )
        );

        setModalCategoriaAbierto(false);
        return catActualizada;
      } else {
        const nuevaCat = await PosService.crearCategoria({
          nombre: catNombre.trim(),
          descripcion: catDescripcion.trim(),
          orden: parseInt(catOrden) || 1,
        });

        setCategorias((prev) => [...prev, nuevaCat]);
        setModalCategoriaAbierto(false);
        setCatNombre('');
        setCatDescripcion('');
        return nuevaCat;
      }
    };

    toast.promise(promesa(), {
      loading: categoriaEditando ? 'Actualizando categoría...' : 'Creando categoría...',
      success: categoriaEditando ? 'Categoría actualizada con éxito' : 'Categoría añadida con éxito',
      error: (err) => err.message,
      finally: () => setGuardando(false),
    });
  };

  const confirmarEliminarCategoria = async () => {
    if (!categoriaParaEliminar) return;
    setEliminandoCategoria(true);

    const promesa = async () => {
      await PosService.eliminarCategoria(categoriaParaEliminar.id);
      setCategorias((prev) => prev.filter((c) => c.id !== categoriaParaEliminar.id));
      if (categoriaSeleccionada === categoriaParaEliminar.id) {
        setCategoriaSeleccionada('TODAS');
      }
      setCategoriaParaEliminar(null);
    };

    toast.promise(promesa(), {
      loading: 'Eliminando categoría...',
      success: 'Categoría eliminada con éxito',
      error: (err) => err.message,
      finally: () => setEliminandoCategoria(false),
    });
  };

  const categoriaActivaObj = useMemo(() => {
    if (categoriaSeleccionada === 'TODAS') return null;
    return categorias.find((c) => c.id === categoriaSeleccionada) || null;
  }, [categorias, categoriaSeleccionada]);

  const productosFiltrados = useMemo(() => {
    return productos.filter((p) => {
      const matchCat = categoriaSeleccionada === 'TODAS' || p.categoria_id === categoriaSeleccionada;
      const matchText = p.nombre.toLowerCase().includes(busqueda.toLowerCase());
      return matchCat && matchText;
    });
  }, [productos, categoriaSeleccionada, busqueda]);

  const sinStock = productos.filter((p) => p.stock_actual <= 0).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
      <Toaster position="top-right" richColors theme="dark" />

      {/* Cabecera */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ember">
            Administración del menú
          </p>
          <h1 className="mt-1 text-[22px] font-extrabold leading-tight tracking-[-0.025em] text-ink sm:text-[26px]">
            Carta de platos y precios
          </h1>
          <p className="mt-1 max-w-xl text-[12.5px] leading-5 text-ink-muted">
            Disponibilidad, precios y categorías de lo que ven los terminales de venta.
          </p>
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
            {productos.length} platos · {categorias.length} categorías ·{' '}
            <span className={sinStock > 0 ? 'text-warn' : ''}>{sinStock} sin stock</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variante="secundaria"
            onClick={abrirModalCrearCategoria}
            icono={<Layers className="size-4 text-ember" strokeWidth={2.25} />}
          >
            Nueva categoría
          </Button>
          <Button
            onClick={abrirModalCrearProducto}
            icono={<Plus className="size-4" strokeWidth={2.5} />}
          >
            Añadir plato
          </Button>
        </div>
      </header>

      {/* Filtros */}
      <div className="mt-5 space-y-2.5 rounded-card border border-line-strong bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              strokeWidth={2}
              aria-hidden
            />
            <label htmlFor="catalogo-busqueda" className="sr-only">
              Buscar plato
            </label>
            <input
              id="catalogo-busqueda"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar plato por nombre"
              className="h-10 w-full rounded-field border border-line-strong bg-sunken pl-9 pr-8 text-[13.5px] text-ink placeholder:text-ink-faint transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25 [&::-webkit-search-cancel-button]:hidden"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted hover:bg-raised hover:text-ink"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>

          {categoriaActivaObj && (
            <div className="flex shrink-0 items-center gap-1.5 rounded-field border border-line bg-sunken py-1 pl-2.5 pr-1">
              <span className="max-w-[160px] truncate text-[12px] font-semibold text-ink">
                {categoriaActivaObj.nombre}
              </span>
              <IconButton
                etiqueta="Editar categoría"
                tamano="sm"
                onClick={() => abrirModalEditarCategoria(categoriaActivaObj)}
                icono={<Edit2 className="size-3.5" strokeWidth={2.25} />}
              />
              <IconButton
                etiqueta="Eliminar categoría"
                tamano="sm"
                tono="peligro"
                onClick={() => setCategoriaParaEliminar(categoriaActivaObj)}
                icono={<Trash2 className="size-3.5" strokeWidth={2.25} />}
              />
            </div>
          )}
        </div>

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setCategoriaSeleccionada('TODAS')}
            aria-pressed={categoriaSeleccionada === 'TODAS'}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
              categoriaSeleccionada === 'TODAS'
                ? 'border-ember-strong bg-ember-strong text-white'
                : 'border-line-strong bg-sunken text-ink-soft hover:text-ink'
            }`}
          >
            Todas
            <span
              className={`font-mono text-[10.5px] tnum ${
                categoriaSeleccionada === 'TODAS' ? 'text-white/70' : 'text-ink-faint'
              }`}
            >
              {productos.length}
            </span>
          </button>

          {categorias.map((cat) => {
            const countProd = productos.filter((p) => p.categoria_id === cat.id).length;
            const esActiva = categoriaSeleccionada === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoriaSeleccionada(cat.id)}
                aria-pressed={esActiva}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
                  esActiva
                    ? 'border-ember-strong bg-ember-strong text-white'
                    : 'border-line-strong bg-sunken text-ink-soft hover:text-ink'
                }`}
              >
                {cat.nombre}
                <span
                  className={`font-mono text-[10.5px] tnum ${
                    esActiva ? 'text-white/70' : 'text-ink-faint'
                  }`}
                >
                  {countProd}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Listado */}
      {productosFiltrados.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line-strong bg-card px-4 py-12 text-center text-[12.5px] text-ink-faint">
          No se encontraron platos con este criterio.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {productosFiltrados.map((prod) => (
            <li
              key={prod.id}
              className={`group flex flex-col rounded-card border bg-card p-3.5 transition-colors ${
                prod.activo
                  ? 'border-line-strong hover:border-ember/40'
                  : 'border-line border-dashed bg-card/60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3
                    className={`truncate text-[14px] font-bold leading-tight tracking-[-0.01em] ${
                      prod.activo ? 'text-ink' : 'text-ink-muted'
                    }`}
                  >
                    {prod.nombre}
                  </h3>
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    {prod.categoria_nombre}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[15px] font-bold text-ember tnum">
                  Bs {prod.precio_base.toFixed(2)}
                </span>
              </div>

              {prod.descripcion && (
                <p className="mt-2 line-clamp-2 text-[11.5px] leading-[1.45] text-ink-muted">
                  {prod.descripcion}
                </p>
              )}

              <div className="mt-2.5 flex items-center gap-1.5">
                <Badge
                  tono={prod.stock_actual > 0 ? 'ok' : 'peligro'}
                  mono
                >
                  {prod.stock_actual > 0 ? `${prod.stock_actual} uds` : 'sin stock'}
                </Badge>
                {!prod.activo && <Badge tono="neutro">Oculto</Badge>}
              </div>

              <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2.5">
                <button
                  type="button"
                  onClick={() => abrirModalEditarProducto(prod)}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-line-strong bg-sunken text-[11.5px] font-semibold text-ink-soft transition-colors hover:border-control hover:text-ink"
                >
                  <Edit2 className="size-3.5" strokeWidth={2.25} />
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => setProductoParaEliminar(prod)}
                  aria-label={`Eliminar ${prod.nombre}`}
                  className="flex size-9 items-center justify-center rounded-[8px] border border-danger/30 bg-danger/10 text-danger transition-colors hover:bg-danger/18"
                >
                  <Trash2 className="size-3.5" strokeWidth={2.25} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Crear / editar producto */}
      <Modal
        abierto={modalProductoAbierto}
        onCerrar={() => setModalProductoAbierto(false)}
        titulo={productoEditando ? 'Editar plato' : 'Nuevo plato o bebida'}
        descripcion={
          productoEditando
            ? 'Los cambios se reflejan en los terminales al guardar.'
            : 'Se publica en la carta del terminal según su categoría.'
        }
        posicion="centro"
        ancho="md"
        pie={
          <div className="flex items-center gap-2">
            <Button variante="secundaria" onClick={() => setModalProductoAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="form-producto" bloque cargando={guardando}>
              {guardando ? 'Guardando…' : productoEditando ? 'Actualizar plato' : 'Guardar plato'}
            </Button>
          </div>
        }
      >
        <form id="form-producto" onSubmit={guardarProductoHandler} className="space-y-4 p-5">
          <Field etiqueta="Nombre del plato" htmlFor="prod-nombre">
            <Input
              id="prod-nombre"
              type="text"
              required
              value={formNombre}
              onChange={(e) => setFormNombre(e.target.value)}
              placeholder="Ej. Kjara tradicional, costilla especial"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field etiqueta="Categoría" htmlFor="prod-categoria">
              <select
                id="prod-categoria"
                value={formCategoriaId}
                onChange={(e) => setFormCategoriaId(Number(e.target.value))}
                className="h-11 w-full rounded-field border border-line-strong bg-sunken px-2.5 text-[13.5px] text-ink transition-colors hover:border-control focus-visible:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25"
              >
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Field>

            <Field etiqueta="Precio (Bs)" htmlFor="prod-precio">
              <Input
                id="prod-precio"
                type="number"
                step="0.01"
                min="0"
                required
                value={formPrecio}
                onChange={(e) => setFormPrecio(e.target.value)}
                placeholder="0.00"
                className="font-mono tnum"
              />
            </Field>
          </div>

          <Field
            etiqueta={productoEditando ? 'Stock actual (unidades)' : 'Stock inicial (unidades)'}
            htmlFor="prod-stock"
            ayuda="Se registra en el inventario de tu sucursal."
          >
            <Input
              id="prod-stock"
              type="number"
              min="0"
              max="2147483647"
              step="1"
              required
              value={formStock}
              onChange={(e) => setFormStock(e.target.value)}
              className="font-mono tnum"
            />
          </Field>

          <Field
            etiqueta="Descripción o guarniciones"
            htmlFor="prod-descripcion"
            ayuda="Opcional. Se muestra en la tarjeta del plato."
          >
            <Textarea
              id="prod-descripcion"
              rows={2}
              value={formDescripcion}
              onChange={(e) => setFormDescripcion(e.target.value)}
              placeholder="Ej. con mote, papa y llajwa"
            />
          </Field>

          <label
            htmlFor="prod-activo"
            className="flex cursor-pointer items-start gap-2.5 rounded-field border border-line bg-sunken px-3 py-2.5"
          >
            <input
              id="prod-activo"
              type="checkbox"
              checked={formActivo}
              onChange={(e) => setFormActivo(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-ember"
            />
            <span className="text-[12.5px] leading-5 text-ink-soft">
              Disponible de inmediato en el terminal POS
            </span>
          </label>
        </form>
      </Modal>

      {/* Crear / editar categoría */}
      <Modal
        abierto={modalCategoriaAbierto}
        onCerrar={() => setModalCategoriaAbierto(false)}
        titulo={categoriaEditando ? 'Editar categoría' : 'Nueva categoría'}
        descripcion="Agrupa los platos en la carta y en los filtros del terminal."
        posicion="centro"
        ancho="md"
        pie={
          <div className="flex items-center gap-2">
            <Button variante="secundaria" onClick={() => setModalCategoriaAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="form-categoria" bloque cargando={guardando}>
              {guardando ? 'Guardando…' : categoriaEditando ? 'Actualizar' : 'Crear categoría'}
            </Button>
          </div>
        }
      >
        <form id="form-categoria" onSubmit={guardarCategoriaHandler} className="space-y-4 p-5">
          <Field etiqueta="Nombre de la categoría" htmlFor="cat-nombre">
            <Input
              id="cat-nombre"
              type="text"
              required
              value={catNombre}
              onChange={(e) => setCatNombre(e.target.value)}
              placeholder="Ej. Kjaras, guarniciones, refrescos"
            />
          </Field>

          <Field etiqueta="Descripción breve" htmlFor="cat-descripcion">
            <Input
              id="cat-descripcion"
              type="text"
              value={catDescripcion}
              onChange={(e) => setCatDescripcion(e.target.value)}
              placeholder="Opcional"
            />
          </Field>

          <Field
            etiqueta="Orden en la carta"
            htmlFor="cat-orden"
            ayuda="Menor número aparece primero en el terminal."
            className="max-w-[160px]"
          >
            <Input
              id="cat-orden"
              type="number"
              min="1"
              value={catOrden}
              onChange={(e) => setCatOrden(e.target.value)}
              className="font-mono tnum"
            />
          </Field>
        </form>
      </Modal>

      {/* Eliminar producto */}
      <Modal
        abierto={!!productoParaEliminar}
        onCerrar={() => setProductoParaEliminar(null)}
        titulo="¿Eliminar plato?"
        posicion="centro"
        ancho="ajustado"
        pie={
          <div className="flex items-center gap-2">
            <Button
              variante="secundaria"
              onClick={() => setProductoParaEliminar(null)}
              disabled={eliminandoProducto}
            >
              Cancelar
            </Button>
            <Button
              variante="peligro"
              bloque
              cargando={eliminandoProducto}
              onClick={confirmarEliminarProducto}
              icono={<Trash2 className="size-4" strokeWidth={2.25} />}
            >
              {eliminandoProducto ? 'Eliminando…' : 'Sí, eliminar'}
            </Button>
          </div>
        }
      >
        <div className="flex items-start gap-3 p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-danger/35 bg-danger/12 text-danger">
            <AlertTriangle className="size-5" strokeWidth={2.25} aria-hidden />
          </span>
          <p className="text-[13px] leading-5 text-ink-soft">
            Se quitará del menú{' '}
            <strong className="font-semibold text-ink">{productoParaEliminar?.nombre}</strong> (Bs{' '}
            {Number(productoParaEliminar?.precio_base ?? 0).toFixed(2)}). Las comandas ya cobradas
            conservan su registro.
          </p>
        </div>
      </Modal>

      {/* Eliminar categoría */}
      <Modal
        abierto={!!categoriaParaEliminar}
        onCerrar={() => setCategoriaParaEliminar(null)}
        titulo="¿Eliminar categoría?"
        posicion="centro"
        ancho="ajustado"
        pie={
          <div className="flex items-center gap-2">
            <Button
              variante="secundaria"
              onClick={() => setCategoriaParaEliminar(null)}
              disabled={eliminandoCategoria}
            >
              Cancelar
            </Button>
            <Button
              variante="peligro"
              bloque
              cargando={eliminandoCategoria}
              onClick={confirmarEliminarCategoria}
              icono={<Trash2 className="size-4" strokeWidth={2.25} />}
            >
              {eliminandoCategoria ? 'Eliminando…' : 'Sí, eliminar'}
            </Button>
          </div>
        }
      >
        <div className="flex items-start gap-3 p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-danger/35 bg-danger/12 text-danger">
            <AlertTriangle className="size-5" strokeWidth={2.25} aria-hidden />
          </span>
          <p className="text-[13px] leading-5 text-ink-soft">
            Se eliminará la categoría{' '}
            <strong className="font-semibold text-ink">{categoriaParaEliminar?.nombre}</strong>. Solo
            es posible si no tiene platos asociados.
          </p>
        </div>
      </Modal>
    </div>
  );
}
