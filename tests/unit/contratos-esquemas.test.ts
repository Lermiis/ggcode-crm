import { describe, expect, it } from "vitest";

import { criarContratoSchema, lancarEventoSchema } from "@/lib/contratos/esquemas";

const lead = "6f1c2b9e-1111-4000-8000-000000000001";

describe("criarContratoSchema", () => {
  it("aceita implantação + mensalidade", () => {
    expect(criarContratoSchema.safeParse({
      lead_id: lead, titulo: "Site", inicio: "2026-10-14",
      formas: [{ tipo: "implantacao", valor_cents: 100000, parcelas: 2, primeiro_vencimento: "2026-10-20" }, { tipo: "mensalidade", valor_cents: 50000, dia_vencimento: 10 }],
    }).success).toBe(true);
  });
  it("recusa contrato sem forma", () => {
    expect(criarContratoSchema.safeParse({ lead_id: lead, titulo: "X", inicio: "2026-10-14", formas: [] }).success).toBe(false);
  });
  it("recusa mensalidade sem dia", () => {
    expect(criarContratoSchema.safeParse({ lead_id: lead, titulo: "X", inicio: "2026-10-14", formas: [{ tipo: "mensalidade", valor_cents: 1 }] }).success).toBe(false);
  });
  it("recusa implantação sem primeiro vencimento", () => {
    expect(criarContratoSchema.safeParse({ lead_id: lead, titulo: "X", inicio: "2026-10-14", formas: [{ tipo: "implantacao", valor_cents: 1 }] }).success).toBe(false);
  });
  it("recusa fim antes do início", () => {
    expect(criarContratoSchema.safeParse({ lead_id: lead, titulo: "X", inicio: "2026-10-14", fim: "2026-10-01", formas: [{ tipo: "evento", valor_cents: 1 }] }).success).toBe(false);
  });
});

describe("lancarEventoSchema", () => {
  it("valor é opcional (usa o padrão da forma)", () => {
    expect(lancarEventoSchema.safeParse({ forma_id: lead, data: "2026-12-05", titulo: "Espetáculo" }).success).toBe(true);
  });
});
