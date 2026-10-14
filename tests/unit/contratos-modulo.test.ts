import { describe, expect, it } from "vitest";

import { moduloAusente } from "@/lib/contratos/modulo";

describe("moduloAusente", () => {
  it("tabela/relação ausente (Postgres e PostgREST) = módulo não instalado", () => {
    for (const code of ["42P01", "PGRST205", "PGRST200"]) expect(moduloAusente({ code })).toBe(true);
  });
  it("outros erros e ausência de erro não são", () => {
    expect(moduloAusente({ code: "23505" })).toBe(false);
    expect(moduloAusente(undefined)).toBe(false);
  });
});
