// Deja data/gastos.db lista para subir a Turso con `turso db create --from-file`:
// pasa al archivo principal los cambios que SQLite tiene guardados aparte (gastos.db-wal).
// Correlo con la app cerrada.
import { createClient } from "@libsql/client";
import fs from "node:fs";

const archivo = "data/gastos.db";
if (!fs.existsSync(archivo)) {
  console.error(`No encontré ${archivo}. ¿Estás en la carpeta del proyecto?`);
  process.exit(1);
}
const cliente = createClient({ url: `file:${archivo}` });
await cliente.execute("PRAGMA journal_mode = WAL");
const r = await cliente.execute("PRAGMA wal_checkpoint(TRUNCATE)");
const { busy } = r.rows[0];
cliente.close();
if (busy) {
  console.error("La base está en uso. Cerrá la app (npm run dev) y volvé a correr este comando.");
  process.exit(1);
}
console.log(`Listo: ${archivo} tiene todos los datos. Ahora podés correr:`);
console.log(`  turso db create gastos --from-file ${archivo}`);
