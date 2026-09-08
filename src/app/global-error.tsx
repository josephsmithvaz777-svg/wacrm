"use client";

import { useEffect } from "react";

import { reloadOnceIfStale } from "@/lib/navigation/stale-client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
    reloadOnceIfStale(error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>No se pudo cargar esta página</h1>
          <p style={{ fontSize: 14, opacity: 0.7, margin: "12px 0 24px" }}>
            Recarga para intentarlo de nuevo. Suele pasar después de una
            actualización, con la pestaña abierta.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginRight: 8,
              border: 0,
              borderRadius: 8,
              padding: "8px 14px",
              background: "#f8fafc",
              color: "#020617",
              cursor: "pointer",
            }}
          >
            Recargar
          </button>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "8px 14px",
              background: "transparent",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
