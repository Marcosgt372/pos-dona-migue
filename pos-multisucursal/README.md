# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Inventario de gaseosas y snacks

1. En el SQL Editor del proyecto Supabase del POS, ejecuta [la migración de inventario y ventas](supabase/migracion-inventario-ventas.sql). Usa las RPC y tablas que ya existen en ese proyecto y requiere la migración de `detalle_pedidos.tipo_corte`.
2. Ejecuta [la corrección de cobro](supabase/migracion-inventario-cobro.sql). La comanda queda pendiente hasta que se registre el pago.
3. Ejecuta [la migración de stock inicial](supabase/migracion-stock-inicial-producto.sql) y [la migración de edición de stock](supabase/migracion-editar-stock-producto.sql) para habilitar ambos formularios del catálogo web.
4. Despliega la web después de aplicar las migraciones. Web y Android comparten las RPC de creación, edición, cobro y anulación.
5. Verifica las cantidades físicas por sucursal y usa **Admin → Dashboard → Ajustar stock** para registrar las diferencias iniciales. Las migraciones conservan los saldos actuales y el historial.

La comanda descuenta existencias al guardarse. La edición aplica la diferencia de unidades, y la anulación devuelve las unidades descontadas que consten en el Kardex si se elige devolver el stock. Si el pago queda pendiente, la comanda conserva su reserva hasta que se cobre o se anule.

El control nuevo abarca la categoría **Snacks** y las gaseosas del catálogo. En **Bebidas Frías** se reconocen los nombres que empiezan con «Gaseosa» o «Simba». Una categoría **Gaseosas** también queda incluida.
