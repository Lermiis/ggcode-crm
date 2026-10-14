import { describe, expect, it } from "vitest";

import { dre, fluxoProjetado, metricas, serie12Meses, visaoGeral } from "@/lib/gestao-financeira/calculos";
import type { Lancamento } from "@/lib/gestao-financeira/tipos";

const L = (p: Partial<Lancamento>): Lancamento => ({
  id: Math.random().toString(36).slice(2), direction: "in", amount_cents: 0, entry_date: "2026-10-10",
  status: "pending", paid_date: null, grupo: "receita", conta_cac: false, origin: "manual",
  reverses_entry_id: null, cobranca_contrato: false, cliente_id: null, ...p,
});

describe("visaoGeral", () => {
  it("faturado não conta duas vezes o recebimento de cobrança de contrato (Review Focus 1)", () => {
    const v = visaoGeral({
      mes: "2026-10", hoje: "2026-10-14", saldoInicialContas: 0,
      cobrancas: [{ vencimento: "2026-10-10", valor_cents: 50000, situacao: "recebida", recebida_em: "2026-10-10", contrato_id: "k1" }],
      lancamentos: [L({ amount_cents: 50000, status: "paid", paid_date: "2026-10-10", cobranca_contrato: true })],
    });
    expect(v.faturado).toBe(50000);
    expect(v.recebido).toBe(50000);
  });
  it("lucro de caixa = recebido − saídas pagas; margem null sem recebido", () => {
    const v = visaoGeral({ mes: "2026-10", hoje: "2026-10-14", saldoInicialContas: 100000, cobrancas: [], lancamentos: [
      L({ direction: "out", grupo: "assinaturas", amount_cents: 9900, status: "paid", paid_date: "2026-10-05" }),
    ] });
    expect(v.lucro).toBe(-9900);
    expect(v.margem).toEqual({ valor: null, motivo: "Sem receita no mês." });
    expect(v.saldo).toBe(90100);
  });
  it("a receber / atrasado / a pagar", () => {
    const v = visaoGeral({ mes: "2026-10", hoje: "2026-10-14", saldoInicialContas: 0, lancamentos: [
      L({ amount_cents: 1000, entry_date: "2026-10-01" }), L({ amount_cents: 2000, entry_date: "2026-10-20" }),
      L({ direction: "out", grupo: "estrutura", amount_cents: 500, entry_date: "2026-10-25" }),
    ], cobrancas: [{ vencimento: "2026-10-05", valor_cents: 3000, situacao: "a_receber", recebida_em: null, contrato_id: "k" }] });
    expect(v.atrasado).toBe(4000);
    expect(v.aReceber).toBe(2000);
    expect(v.aPagar).toBe(500);
  });
});

describe("serie12Meses", () => {
  it("12 meses terminando em ateMes com receita, custos e lucro de caixa", () => {
    const s = serie12Meses({ ateMes: "2026-10", lancamentos: [
      L({ amount_cents: 1000, status: "paid", paid_date: "2026-10-02" }),
      L({ direction: "out", grupo: "estrutura", amount_cents: 400, status: "paid", paid_date: "2025-11-30" }),
    ] });
    expect(s).toHaveLength(12);
    expect(s[0]!.mes).toBe("2025-11");
    expect(s[11]).toEqual({ mes: "2026-10", receita: 1000, custos: 0, lucro: 1000 });
    expect(s[0]).toEqual({ mes: "2025-11", receita: 0, custos: 400, lucro: -400 });
  });
});

describe("dre", () => {
  it("margem de contribuição e resultado com %", () => {
    const linhas = dre({ mes: "2026-10", lancamentos: [
      L({ amount_cents: 100000, grupo: "receita" }), L({ direction: "out", amount_cents: 6000, grupo: "imposto" }),
      L({ direction: "out", amount_cents: 4000, grupo: "custo_variavel" }), L({ direction: "out", amount_cents: 30000, grupo: "pessoal" }),
      L({ direction: "out", amount_cents: 10000, grupo: "marketing" }),
    ] });
    const v = Object.fromEntries(linhas.map((l) => [l.chave, l]));
    expect(v.receita_bruta!.valor).toBe(100000);
    expect(v.receita_liquida!.valor).toBe(94000);
    expect(v.margem_contribuicao!.valor).toBe(90000);
    expect(v.margem_contribuicao!.pct).toBe(90);
    expect(v.resultado!.valor).toBe(50000);
  });
  it("estorno (reverses_entry_id) anula o lançamento estornado", () => {
    const a = L({ id: "a", direction: "out", amount_cents: 5000, grupo: "estrutura" });
    const r = L({ direction: "in", amount_cents: 5000, grupo: "estrutura", origin: "reversal", reverses_entry_id: "a" });
    const v = Object.fromEntries(dre({ mes: "2026-10", lancamentos: [a, r] }).map((l) => [l.chave, l]));
    expect(v.resultado!.valor).toBe(0);
  });
});

describe("fluxoProjetado (Review Focus 5)", () => {
  it("recorrência que já gerou o pendente do mês não conta duas vezes; mensalidade que já virou cobrança também não", () => {
    const f = fluxoProjetado({
      hoje: "2026-10-14", mesesFuturos: 2, saldoAtual: 0,
      lancamentos: [L({ direction: "out", grupo: "assinaturas", amount_cents: 9900, entry_date: "2026-11-05", origin: "recurring" })],
      recorrencias: [{ id: "r", direction: "out", amount_cents: 9900, day_of_month: 5, is_active: true, fim: null, grupo: "assinaturas" }],
      contratos: [{ id: "k", inicio: "2026-01-01", fim: null, situacao: "ativo", criado_em: "2026-01-01", encerrado_em: null, mensal_cents: 50000 }],
      cobrancas: [{ vencimento: "2026-11-10", valor_cents: 50000, situacao: "a_receber", recebida_em: null, contrato_id: "k" }],
    });
    const nov = f.find((m) => m.mes === "2026-11")!;
    expect(nov.saidas).toBe(9900);
    expect(nov.entradas).toBe(50000);
    const dez = f.find((m) => m.mes === "2026-12")!;
    expect(dez.saidas).toBe(9900);
    expect(dez.entradas).toBe(50000);
    expect(dez.saldo).toBe(80200);
  });
  it("recorrência com fim não projeta depois do fim", () => {
    const f = fluxoProjetado({ hoje: "2026-10-14", mesesFuturos: 2, saldoAtual: 0, lancamentos: [], contratos: [], cobrancas: [],
      recorrencias: [{ id: "r", direction: "out", amount_cents: 100, day_of_month: 5, is_active: true, fim: "2026-11-30", grupo: "assinaturas" }] });
    expect(f.find((m) => m.mes === "2026-12")!.saidas).toBe(0);
  });
});

describe("metricas (Review Focus 4)", () => {
  it("sem base → null com motivo, nunca 0/Infinity/NaN", () => {
    const m = metricas({ de: "2026-10", ate: "2026-10", lancamentos: [], contratos: [], ganhosSemContrato: 0 });
    for (const k of ["cac", "ltv", "ltvCac", "payback", "roiEmpresa", "roiMarketing", "churn", "ticketMedio"] as const) {
      expect(m[k].valor).toBeNull();
      expect(m[k].motivo).toBeTruthy();
    }
    expect(m.mrr.valor).toBe(0);
    expect(m.clientesNovos.valor).toBe(0);
  });
  const contratos = [
    { id: "a", inicio: "2026-10-01", fim: null, situacao: "ativo" as const, criado_em: "2026-10-02", encerrado_em: null, mensal_cents: 50000 },
    { id: "b", inicio: "2026-01-01", fim: null, situacao: "ativo" as const, criado_em: "2026-01-01", encerrado_em: null, mensal_cents: 50000 },
    { id: "c", inicio: "2026-01-01", fim: "2026-10-05", situacao: "encerrado" as const, criado_em: "2026-01-01", encerrado_em: "2026-10-05", mensal_cents: 50000 },
  ];
  const lancamentos = [
    L({ direction: "out", grupo: "marketing", conta_cac: true, amount_cents: 60000, status: "paid", paid_date: "2026-10-03" }),
    L({ amount_cents: 100000, status: "paid", paid_date: "2026-10-10", cliente_id: "a" }),
  ];
  it("CAC = marketing (conta_cac) ÷ clientes novos; LTV/CAC e payback", () => {
    const m = metricas({ de: "2026-10", ate: "2026-10", ganhosSemContrato: 0, contratos, lancamentos });
    expect(m.clientesNovos.valor).toBe(1);
    expect(m.cac.valor).toBe(60000);
    expect(m.mrr.valor).toBe(100000);
    expect(m.churn.valor).toBe(50); // 1 encerrado ÷ 2 ativos no início (b, c) = 50%
    expect(m.ltv.valor).toBe(100000); // 50000 × (100 ÷ 50)
    expect(m.ltvCac.valor).toBe(1.67);
    expect(m.payback.valor).toBe(1.2);
    expect(m.ticketMedio.valor).toBe(100000);
    expect(m.roiMarketing.valor).toBe(66.7); // (100000 − 60000) ÷ 60000
  });
  it("churn de período de 3 meses é dividido por 3", () => {
    const m = metricas({ de: "2026-08", ate: "2026-10", ganhosSemContrato: 0, contratos, lancamentos: [] });
    expect(m.churn.valor).toBe(16.7); // 50 ÷ 3
  });
  it("LTV usa a duração média dos contratos com fim quando o churn é 0", () => {
    const m = metricas({ de: "2026-10", ate: "2026-10", ganhosSemContrato: 0, lancamentos: [], contratos: [
      { id: "a", inicio: "2026-01-01", fim: null, situacao: "ativo", criado_em: "2026-01-01", encerrado_em: null, mensal_cents: 10000 },
      { id: "x", inicio: "2025-01-01", fim: "2025-07-01", situacao: "encerrado", criado_em: "2025-01-01", encerrado_em: "2025-07-01", mensal_cents: 10000 },
    ] });
    expect(m.churn.valor).toBe(0);
    expect(m.ltv.valor).toBe(60000); // 10000 × 6 meses de duração média (jan→jul)
  });
});
