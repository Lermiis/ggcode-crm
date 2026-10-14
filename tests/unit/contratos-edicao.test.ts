import { describe, expect, it } from "vitest";

import { refazerParcelamento, vencimentoPeloDia } from "@/lib/contratos/edicao";

describe("refazerParcelamento", () => {
  it("1000 em 2x com 1 recebida → restante 500 em 3x continua a numeração", () => {
    const r = refazerParcelamento({ total_cents: 100000, recebidas: [{ competencia: "parcela-1", valor_cents: 50000 }], novasParcelas: 3, primeiroVencimento: "2026-11-10" });
    expect(r.map((c) => c.competencia)).toEqual(["parcela-2", "parcela-3", "parcela-4"]);
    expect(r.map((c) => c.valor_cents)).toEqual([16668, 16666, 16666]);
    expect(r[0]!.descricao).toBe("Implantação 2/4");
    expect(r.map((c) => c.vencimento)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
  });
  it("nada a parcelar", () => {
    expect(() => refazerParcelamento({ total_cents: 1000, recebidas: [{ competencia: "parcela-1", valor_cents: 1000 }], novasParcelas: 2, primeiroVencimento: "2026-11-10" })).toThrow("Nada a parcelar.");
  });
  it("sem recebidas começa em parcela-1", () => {
    const r = refazerParcelamento({ total_cents: 1000, recebidas: [], novasParcelas: 1, primeiroVencimento: "2026-11-10" });
    expect(r.map((c) => c.competencia)).toEqual(["parcela-1"]);
    expect(r[0]!.descricao).toBe("Implantação 1/1");
  });
});

describe("refazerParcelamento com ocupadas", () => {
  it("numera depois de parcela cancelada", () => {
    const r = refazerParcelamento({ total_cents: 1000, recebidas: [], novasParcelas: 1, primeiroVencimento: "2026-11-10", ocupadas: ["parcela-1", "parcela-2"] });
    expect(r[0]!.competencia).toBe("parcela-3");
    expect(r[0]!.descricao).toBe("Implantação 1/1");
  });
  it("com a_receber existentes: chaves depois da maior, rótulo por posição", () => {
    const r = refazerParcelamento({
      total_cents: 90000, recebidas: [{ competencia: "parcela-1", valor_cents: 30000 }], novasParcelas: 2, primeiroVencimento: "2026-11-10",
      ocupadas: ["parcela-1", "parcela-2", "parcela-3"],
    });
    expect(r.map((c) => c.competencia)).toEqual(["parcela-4", "parcela-5"]);
    expect(r.map((c) => c.descricao)).toEqual(["Implantação 2/3", "Implantação 3/3"]);
  });
});

describe("vencimentoPeloDia", () => {
  it("troca o dia dentro do mês da cobrança", () => {
    expect(vencimentoPeloDia("2026-11-10", 20)).toBe("2026-11-20");
  });
  it("limita ao último dia do mês", () => {
    expect(vencimentoPeloDia("2027-02-05", 31)).toBe("2027-02-28");
  });
});
