# Gastos de tarjetas

App para controlar los gastos de las tarjetas de crédito (Santander Visa y American Express),
repartirlos entre las personas y saber cuánto debe cada una.

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

En tu compu no pide contraseña (salvo que definas `ADMIN_PASSWORD`, ver `.env.example`).

**Copia de seguridad (local):** con la app cerrada, copiá la carpeta `data/` entera. SQLite guarda los
cambios recientes en `gastos.db-wal`, así que copiar solo `gastos.db` puede dejar afuera lo último
(o corré antes `npm run preparar-subida`, que los pasa a `gastos.db`).

Los PDFs se pueden guardar en `resumenes/` para los tests. Esa carpeta y la base (`data/gastos.db`)
están en `.gitignore`: **tienen datos personales y nunca se suben a GitHub**.

## Cómo está organizada

| Carpeta / archivo | Qué hace |
| --- | --- |
| `lib/parser/montos.ts` | Lee montos argentinos (`151.554,44`), monedas, cuotas y fechas. Trabaja en centavos enteros. |
| `lib/parser/santander.ts` | Convierte el texto del PDF en tarjetas → gastos, pagos e impuestos. |
| `lib/parser/validar.ts` | Compara lo sumado con los subtotales del banco y con el total a pagar. |
| `lib/pdf.ts` | Saca el texto del PDF con `pdf-parse`. |
| `lib/sesion.ts` / `proxy.ts` / `app/login/` | Login del administrador: cookie firmada; el proxy manda a `/login` a quien no tenga sesión. |
| `lib/db/` | Única puerta a la base de datos (SQLite local o Turso, vía `@libsql/client`). Ninguna pantalla escribe SQL. `conexion.ts` crea las tablas y migra las bases viejas, y hay un archivo por tema: `resumenes`, `personas`, `asignaciones`, `saldos`, `pagos`. |
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

## Publicarla en la web

La app tiene **un solo usuario: el administrador**. Nadie más entra; a cada persona se le manda
su detalle por WhatsApp. Se publica en **Vercel** (el hosting) con la base en **Turso** (SQLite en la nube).

### Cómo está protegida
- Toda página y toda acción pide sesión. La contraseña es `ADMIN_PASSWORD`; al entrar se guarda una
  cookie firmada (HMAC con `SESSION_SECRET`) que dura 30 días. "Salir" la borra.
- Cambiar `ADMIN_PASSWORD` cierra todas las sesiones abiertas.
- Cada intento con contraseña incorrecta tarda 1 segundo (frena a quien quiera adivinarla).
- **Si se publica sin `ADMIN_PASSWORD` o con un `SESSION_SECRET` de menos de 32 caracteres, la app
  se bloquea entera** y muestra qué falta configurar. Nunca queda abierta por un olvido.
- Los PDFs se leen en memoria y no se guardan en ningún lado.

### Paso a paso (una sola vez)
1. **Subí tu base a Turso** (así no perdés nada de lo cargado):
   ```bash
   # con la app cerrada
   npm run preparar-subida
   # instalar la CLI de Turso: https://docs.turso.tech/cli/installation
   turso auth signup                    # o `turso auth login` si ya tenés cuenta
   turso db create gastos --from-file data/gastos.db
   turso db show gastos --url           # → DATABASE_URL
   turso db tokens create gastos        # → DATABASE_AUTH_TOKEN
   ```
2. **Generá el secreto de sesión:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
3. **Creá el proyecto en Vercel** (vercel.com → Add New → Project → importar el repo `gastos` de GitHub)
   y en *Environment Variables* cargá: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ADMIN_PASSWORD` (una
   contraseña larga) y `SESSION_SECRET`. Deploy.
4. Listo. **Cada push a `main` publica una versión nueva sola.**

Desde que publicás, **la base de verdad es la de Turso**: lo que cargues en tu compu (en `data/`) ya
no se ve en la web. Si querés usar tu compu contra la misma base, poné `DATABASE_URL` y
`DATABASE_AUTH_TOKEN` en un archivo `.env.local` (está en `.gitignore`).

### Copia de seguridad (Turso)
```bash
turso db shell gastos .dump > backup-$(date +%F).sql
```
Guardala fuera del repo: tiene tus datos.

## Pensada para crecer
- **El parser no depende de nada externo** (texto entra, datos salen): agregar Mercado Pago es sumar
  otro parser al lado.
- **Todo el acceso a datos está en `lib/db/`** (con `@libsql/client`, que habla igual con un archivo
  local o con Turso): las pantallas no saben dónde vive la base.
- **Montos en centavos al calcular**, para que los totales sean exactos.
