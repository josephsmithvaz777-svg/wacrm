import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_COTIZADOR_URL, getCotizadorUrl } from "./cotizador";

describe("getCotizadorUrl", () => {
  const previous = process.env.NEXT_PUBLIC_COTIZADOR_URL;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_COTIZADOR_URL;
    } else {
      process.env.NEXT_PUBLIC_COTIZADOR_URL = previous;
    }
  });

  it("defaults to the Altaterra Netlify deploy", () => {
    delete process.env.NEXT_PUBLIC_COTIZADOR_URL;
    expect(getCotizadorUrl()).toBe(DEFAULT_COTIZADOR_URL);
  });

  it("uses NEXT_PUBLIC_COTIZADOR_URL when set", () => {
    process.env.NEXT_PUBLIC_COTIZADOR_URL = "https://cotizador.example.com/";
    expect(getCotizadorUrl()).toBe("https://cotizador.example.com/");
  });
});
