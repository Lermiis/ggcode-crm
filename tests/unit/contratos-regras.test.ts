import { describe, expect, it } from "vitest";

import {
  cobrancasIniciais,
  competenciaMensal,
  dividirEmParcelas,
  hojeNoFuso,
  mensalidadesDevidas,
  situacaoExibida,
  somarMeses,
  totaisDoMes,
} from "@/lib/contratos/regras";

describe("dividirEmParcelas", () => {
  it("divide exato", () => expect(dividirEmParcelas(100000, 2)).toEqual([50000, 50000]));
  it("sobra de centavos vai na primeira e a soma fecha", () => {
    const p = dividirEmParcelas(100000, 3);
    expect(p).toEqual([33334, 33333, 33333]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100000);
  });
  it("recusa n < 1", () => expect(() => dividirEmParcelas(100, 0)).toThrow());
});

describe("datas", () => {
  it("somarMeses cai no último dia em mês curto", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2026-10-15", 2)).toBe("2026-12-15");
    expect(somarMeses("2026-12-10", 1)).toBe("2027-01-10");
  });
  it("competenciaMensal com dia 31 em fevereiro vence no dia 28", () => {
    expect(competenciaMensal(2027, 2, 31)).toEqual({ competencia: "2027-02", vencimento: "2027-02-28" });
  });
  it("hojeNoFuso usa São Paulo, não UTC", () => {
    // 02:00 UTC de 15/10 ainda é 14/10 em São Paulo (UTC-3)
    expect(hojeNoFuso(new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14");
  });
});

describe("cobrancasIniciais", () => {
  const hoje = "2026-10-14";
  it("implantação 2x vence mês a mês a partir do primeiro vencimento", () => {
    expect(cobrancasIniciais({ tipo: "implantacao", valor_cents: 100000, parcelas: 2, primeiro_vencimento: "2026-10-20" }, hoje)).toEqual([
      { competencia: "parcela-1", descricao: "Implantação 1/2", vencimento: "2026-10-20", valor_cents: 50000 },
      { competencia: "parcela-2", descricao: "Implantação 2/2", vencimento: "2026-11-20", valor_cents: 50000 },
    ]);
  });
  it("implantação à vista tem descrição sem fração", () => {
    expect(cobrancasIniciais({ tipo: "implantacao", valor_cents: 100000, primeiro_vencimento: "2026-10-20" }, hoje)[0]?.descricao).toBe("Implantação");
  });
  it("avulso gera uma cobrança com a descrição dada", () => {
    expect(cobrancasIniciais({ tipo: "avulso", valor_cents: 30000, primeiro_vencimento: "2026-11-01", descricao: "Ajuste no site" }, hoje)).toEqual([
      { competencia: "avulso", descricao: "Ajuste no site", vencimento: "2026-11-01", valor_cents: 30000 },
    ]);
  });
  it("mensalidade com vencimento ainda por vir no mês gera a do mês corrente", () => {
    expect(cobrancasIniciais({ tipo: "mensalidade", valor_cents: 50000, dia_vencimento: 20 }, hoje)).toEqual([
      { competencia: "2026-10", descricao: "Mensalidade out/26", vencimento: "2026-10-20", valor_cents: 50000 },
    ]);
  });
  it("mensalidade com vencimento já passado no mês começa no mês seguinte (Review Focus 4)", () => {
    expect(cobrancasIniciais({ tipo: "mensalidade", valor_cents: 50000, dia_vencimento: 10 }, hoje)).toEqual([
      { competencia: "2026-11", descricao: "Mensalidade nov/26", vencimento: "2026-11-10", valor_cents: 50000 },
    ]);
  });
  it("evento não gera nada na criação", () => {
    expect(cobrancasIniciais({ tipo: "evento", valor_cents: 50000 }, hoje)).toEqual([]);
  });
});

describe("mensalidadesDevidas", () => {
  const f = { dia_vencimento: 10, valor_cents: 50000 };
  it("devolve o mês corrente e o seguinte", () => {
    expect(mensalidadesDevidas(f, { inicio: "2026-01-01", fim: null }, "2026-10-14").map((c) => c.competencia)).toEqual(["2026-10", "2026-11"]);
  });
  it("não gera competência depois do fim (Review Focus 5)", () => {
    expect(mensalidadesDevidas(f, { inicio: "2026-01-01", fim: "2026-10-31" }, "2026-10-14").map((c) => c.competencia)).toEqual(["2026-10"]);
  });
  it("não gera competência antes do início", () => {
    expect(mensalidadesDevidas(f, { inicio: "2026-11-05", fim: null }, "2026-10-14").map((c) => c.competencia)).toEqual(["2026-11"]);
  });
});

describe("situação e totais", () => {
  const hoje = "2026-10-14";
  it("a_receber vencida vira atrasada só na exibição", () => {
    expect(situacaoExibida({ situacao: "a_receber", vencimento: "2026-10-13" }, hoje)).toBe("atrasada");
    expect(situacaoExibida({ situacao: "a_receber", vencimento: "2026-10-14" }, hoje)).toBe("a_receber");
    expect(situacaoExibida({ situacao: "recebida", vencimento: "2026-01-01" }, hoje)).toBe("recebida");
  });
  it("totais do mês: a receber (vence no mês, não vencida), recebido (recebida no mês), atrasado (qualquer mês)", () => {
    const t = totaisDoMes([
      { situacao: "a_receber", vencimento: "2026-10-20", valor_cents: 50000, recebida_em: null },
      { situacao: "a_receber", vencimento: "2026-11-20", valor_cents: 50000, recebida_em: null },
      { situacao: "a_receber", vencimento: "2026-09-10", valor_cents: 30000, recebida_em: null },
      { situacao: "recebida", vencimento: "2026-10-05", valor_cents: 20000, recebida_em: "2026-10-06" },
      { situacao: "cancelada", vencimento: "2026-10-01", valor_cents: 99900, recebida_em: null },
    ], hoje);
    expect(t).toEqual({ aReceber: 50000, recebido: 20000, atrasado: 30000, qtdAtrasadas: 1 });
  });
});
