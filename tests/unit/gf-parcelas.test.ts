import { describe, expect, it } from "vitest";

import { gerarParcelado } from "@/lib/gestao-financeira/parcelas";

describe("gerarParcelado", () => {
  it("6x de 1000,00 a partir de 31/01 cai no último dia em fev", () => {
    const p = gerarParcelado({ total_cents: 100000, parcelas: 6, primeiro: "2027-01-31" });
    expect(p).toHaveLength(6);
    expect(p[1]).toEqual({ numero: 2, entry_date: "2027-02-28", amount_cents: 16666 });
    expect(p[0]!.amount_cents).toBe(16670);
    expect(p.reduce((s, x) => s + x.amount_cents, 0)).toBe(100000);
  });
});
