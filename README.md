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

## Cómo correrla en tu compu

La base de datos está en **MongoDB Atlas** (en la nube), así que la app necesita saber dónde está:

1. Copiá `.env.example` como `.env.local` y completá `MONGODB_URI` (ver "Configurar MongoDB Atlas" abajo).
   `.env.local` está en `.gitignore`: nunca se sube a GitHub.
2. Después:
   ```bash
   npm install        # instala las dependencias (una sola vez)
   npm run dev        # levanta la app → abrila en http://localhost:3000
   npm test           # corre los tests (la primera vez descarga un MongoDB de prueba, ~100 MB)
   ```

En tu compu no pide contraseña (salvo que definas `ADMIN_PASSWORD` en `.env.local`).
Los tests usan un MongoDB propio que se crea y se borra solo: nunca tocan tus datos.

Los PDFs se pueden guardar en `resumenes/` para los tests. Esa carpeta, `data/` y `.env.local` están
en `.gitignore`: **tienen datos personales o claves y nunca se suben a GitHub**.

## Cómo está organizada

| Carpeta / archivo | Qué hace |
| --- | --- |
| `lib/parser/montos.ts` | Lee montos argentinos (`151.554,44`), monedas, cuotas y fechas. Trabaja en centavos enteros. |
| `lib/parser/santander.ts` | Convierte el texto del PDF en tarjetas → gastos, pagos e impuestos. |
| `lib/parser/validar.ts` | Compara lo sumado con los subtotales del banco y con el total a pagar. |
| `lib/pdf.ts` | Saca el texto del PDF con `pdf-parse`. |
| `lib/sesion.ts` / `proxy.ts` / `app/login/` | Login del administrador: cookie firmada; el proxy manda a `/login` a quien no tenga sesión. |
| `lib/db/` | Única puerta a la base de datos (MongoDB). Ninguna pantalla habla con la base. `conexion.ts` describe cada colección y crea los índices; hay un archivo por tema: `resumenes`, `personas`, `asignaciones`, `saldos`, `pagos`. |
| `scripts/migrar-a-mongo.mjs` | Pasa a MongoDB los datos de la base SQLite de las versiones anteriores. |
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

## Configurar MongoDB Atlas (una sola vez)
1. En [cloud.mongodb.com](https://cloud.mongodb.com), en tu cluster:
   - **Database Access** → *Add New Database User*: usuario y contraseña (solo letras y números,
     así no hay que escapar caracteres raros en la URI).
   - **Network Access** → *Add IP Address* → **Allow access from anywhere** (`0.0.0.0/0`).
     Hace falta porque Vercel no tiene una IP fija; la base sigue protegida por usuario y contraseña.
   - **Connect** → *Drivers* → copiá la dirección (`mongodb+srv://usuario:<password>@…`) y reemplazá
     `<password>`. Ese es tu `MONGODB_URI`.
2. Ponelo en `.env.local` (para tu compu) y, al publicar, en Vercel.
3. **Si ya tenías datos cargados con la versión anterior** (en `data/gastos.db`), pasalos a Atlas una sola vez:
   ```bash
   npm run migrar-a-mongo
   ```
   Copia todo (personas, tarjetas, resúmenes, gastos con sus repartos, impuestos y pagos) conservando
   los ids. Si la base de Atlas ya tiene datos, no hace nada, para no duplicar.

Tip: para probar cosas sin tocar los datos reales, poné `MONGODB_DB=gastos_pruebas` en `.env.local`:
usa otra base dentro del mismo cluster.

**Copia de seguridad:** con las [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools):
```bash
mongodump --uri "TU_MONGODB_URI" --db gastos --out backup-$(date +%F)
```
Guardala fuera del repo: tiene tus datos.

## Publicarla en la web

La app tiene **un solo usuario: el administrador**. Nadie más entra; a cada persona se le manda
su detalle por WhatsApp. Se publica en **Vercel** (el hosting) y los datos quedan en tu **MongoDB Atlas**.

### Cómo está protegida
- Toda página y toda acción pide sesión. La contraseña es `ADMIN_PASSWORD`; al entrar se guarda una
  cookie firmada (HMAC con `SESSION_SECRET`) que dura 30 días. "Salir" la borra.
- Cambiar `ADMIN_PASSWORD` cierra todas las sesiones abiertas.
- Cada intento con contraseña incorrecta tarda 1 segundo (frena a quien quiera adivinarla).
- **Si se publica sin `ADMIN_PASSWORD` o con un `SESSION_SECRET` de menos de 32 caracteres, la app
  se bloquea entera** y muestra qué falta configurar. Nunca queda abierta por un olvido.
- Los PDFs se leen en memoria y no se guardan en ningún lado.

### Paso a paso (una sola vez)
1. Configurá Atlas (sección anterior) y, si hace falta, corré la migración.
2. **Generá el secreto de sesión:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
3. **Creá el proyecto en Vercel** (vercel.com → Add New → Project → importar el repo `gastos` de GitHub)
   y en *Environment Variables* cargá: `MONGODB_URI`, `ADMIN_PASSWORD` (una contraseña larga) y
   `SESSION_SECRET`. Deploy.
4. Listo: Vercel te da el link (algo como `gastos-xxxx.vercel.app`).
   **Cada push a `main` publica una versión nueva sola.**

Tu compu y la web usan la misma base (la de Atlas), así que lo que cargues en un lado se ve en el otro.

## Pensada para crecer
- **El parser no depende de nada externo** (texto entra, datos salen): agregar Mercado Pago es sumar
  otro parser al lado.
- **Todo el acceso a datos está en `lib/db/`**: las pantallas no saben dónde vive la base. Así se pudo
  pasar de SQLite a MongoDB sin tocar ninguna pantalla.
- **Montos en centavos enteros**, para que los totales sean exactos.
