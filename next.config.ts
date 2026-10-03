import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paquetes que usan partes nativas de Node: no se empaquetan, se cargan tal cual en el servidor.
  serverExternalPackages: ["@libsql/client", "libsql", "pdf-parse"],
  experimental: {
    // Por defecto una Server Action acepta hasta 1 MB; un resumen en PDF puede pesar más.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
