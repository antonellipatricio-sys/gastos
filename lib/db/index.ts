// Punto de entrada único a la base de datos: las pantallas importan desde "@/lib/db".
export * from "./resumenes";
export * from "./personas";
export * from "./saldos";
export { registrarPago, borrarPago, type NuevoPago } from "./pagos";
export { asignarGasto } from "./asignaciones";
