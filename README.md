# Gastos de tarjetas

App para controlar los gastos de las tarjetas de crédito (Santander Visa y American Express)
y, más adelante, repartirlos entre las personas y saber cuánto debe cada una.

- **Fase 1:** subir el PDF del resumen, ver los gastos agrupados por tarjeta y validar
  que todo coincide con los subtotales del banco.
- **Fase 2:** personas y asignación de cada gasto a una persona (o dividido entre varias).
  - Cada tarjeta tiene un dueño (se sugiere solo por el nombre del titular) y sus gastos se le asignan al importar.
  - Las cuotas heredan el reparto de la cuota anterior ("Flores 4 de 6" va a quien tenía "Flores 3 de 6").
    Para que funcione, los resúmenes se importan en orden (el mes anterior primero).
  - En cada resumen se ve cuánto suma cada persona y lo que quedó sin asignar.
- **Fase 3:** saldos, impuestos y pagos.
  - **Saldos:** lo que te debe cada uno, en pesos y en dólares por separado (todos sus gastos + su parte
    de impuestos − todo lo que pagó). La persona marcada como "vos" no genera deuda.
  - **Impuestos por resumen**, con tres opciones:
    - *Proporcional:* las percepciones sobre dólares (RG 5617, IVA RG 4240, IIBB) según el consumo en
      dólares de cada uno, y los intereses y su IVA según el consumo en pesos.
    - *Los pago yo.*
    - *Manual.*
  - **Pagos:** se registran en la cuenta de cada persona. Un pago en pesos puede cancelar dólares
    indicando la cotización.
  - **Próximas cuotas** de cada persona y un **detalle para mandar por WhatsApp**, con botón Copiar.
  - Un resumen se puede **borrar** (con sus gastos y repartos) para volver a importarlo.

## Cómo correrla

```bash
npm install        # instala las dependencias (una sola vez)
npm run dev        # levanta la app en http://localhost:3000
npm test           # corre los tests del parser
```

**Copia de seguridad:** con la app cerrada, copiá la carpeta `data/` entera. SQLite guarda los cambios
recientes en `gastos.db-wal`, así que copiar solo `gastos.db` puede dejar afuera lo último.

Los PDFs se pueden guardar en `resumenes/` para los tests. Esa carpeta y la base (`data/gastos.db`)
están en `.gitignore`: **tienen datos personales y nunca se suben a GitHub**.

## Cómo está organizada

| Carpeta / archivo | Qué hace |
| --- | --- |
| `lib/parser/montos.ts` | Lee montos argentinos (`151.554,44`), monedas, cuotas y fechas. Trabaja en centavos enteros. |
| `lib/parser/santander.ts` | Convierte el texto del PDF en tarjetas → gastos, pagos e impuestos. |
| `lib/parser/validar.ts` | Compara lo sumado con los subtotales del banco y con el total a pagar. |
| `lib/pdf.ts` | Saca el texto del PDF con `pdf-parse`. |
| `lib/db/` | Única puerta a la base de datos (SQLite). Ninguna pantalla escribe SQL. `conexion.ts` crea las tablas y migra las bases viejas, y hay un archivo por tema: `resumenes`, `personas`, `asignaciones`, `saldos`, `pagos`. |
| `lib/saldos.ts` | Cuentas de la Fase 3: reparto proporcional e impuestos, saldo acumulado, cuotas pendientes, texto del detalle. |
| `lib/reparto.ts` | Cuentas de repartos: partes iguales sin perder centavos, heredar el reparto de una cuota, validar. |
| `app/actions.ts` | Server Action que importa un PDF (evita importar dos veces el mismo resumen). |
| `app/page.tsx` / `app/resumenes/[id]/page.tsx` | Pantallas de subida y de detalle (con la columna "De quién"). |
| `app/personas/` | Personas y dueños de tarjeta; `[id]` es la cuenta de cada persona (pagos, movimientos, cuotas, detalle). |
| `app/saldos/` | Lo que te debe cada uno. |

### Dato importante del formato Santander
Si se mira la posición en la página, la columna de montos está dibujada **en orden invertido**.
El texto que entrega `pdf-parse` sigue el orden interno del archivo, donde cada fila trae su monto
correcto, y por eso el parser lee línea por línea y no por coordenadas.

## Pensada para publicarse en la web más adelante
Lo que ya quedó preparado:
- **El parser no depende de nada externo** (texto entra, datos salen). Sirve igual en local o en un
  servidor, y agregar Mercado Pago es sumar otro parser al lado.
- **Todo el acceso a datos está en `lib/db/`** y sus funciones ya son `async`, así que cambiar
  SQLite por una base en la nube no obliga a tocar las pantallas.
- **Montos en centavos al calcular**, para que los totales sean exactos.

Lo que habrá que hacer antes de publicar:
1. **Base en la nube.** Un archivo SQLite no sirve en hostings como Vercel, porque su disco se borra.
   Opciones: **Turso** (SQLite en la nube, el cambio más chico) o **Postgres** (Neon, Supabase).
2. **Login.** Son datos financieros: sin autenticación no se publica. Por ejemplo, Auth.js o Clerk.
3. **Multiusuario.** Agregar `usuario_id` a `resumenes` (y a las tablas futuras) y filtrar
   todas las consultas por el usuario logueado.
4. **No guardar los PDFs**: hoy solo se lee el texto y se descarta el archivo. Mantenerlo así.
