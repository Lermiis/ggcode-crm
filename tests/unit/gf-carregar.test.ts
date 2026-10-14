import { describe, expect, it } from "vitest";

import { dataCivil, grupoPadrao, mapearContrato, mapearLancamento, saldosPorConta, type Contexto, type LinhaLancamento } from "@/lib/gestao-financeira/carregar";

const linha: LinhaLancamento = {
  id: "e1", direction: "in", amount_cents: 5000, entry_date: "2026-10-10", status: "paid", paid_at: "2026-10-10T15:00:00Z",
  origin: "manual", reverses_entry_id: null, description: "x", account_id: "c1", account_plan_id: null, recurring_entry_id: null,
};
const ctx = (p: Partial<Contexto> = {}): Contexto => ({
  categorias: new Map(), contratoDoLancamento: new Map(), contas: new Map([["c1", "Caixa"]]), parcelas: new Map(), ...p,
});

describe("dataCivil", () => {
  it("converte timestamptz para o dia civil de São Paulo (UTC-3)", () => {
    expect(dataCivil("2026-10-11T02:30:00Z")).toBe("2026-10-10"); // 23:30 do dia 10 em SP
    expect(dataCivil("2026-10-11T03:00:00Z")).toBe("2026-10-11");
    expect(dataCivil("2026-10-10T15:00:00Z")).toBe("2026-10-10"); // meio-dia civil das RPCs
  });
  it("nulo continua nulo", () => {
    expect(dataCivil(null)).toBeNull();
  });
});

describe("grupoPadrao", () => {
  it("receita para entrada, outras despesas para saída", () => {
    expect(grupoPadrao("in")).toBe("receita");
    expect(grupoPadrao("out")).toBe("outras_despesas");
  });
});

describe("mapearLancamento", () => {
  it("sem categoria cai no grupo padrão da direção e não conta CAC", () => {
    expect(mapearLancamento(linha, ctx()).lancamento).toMatchObject({ grupo: "receita", conta_cac: false, paid_date: "2026-10-10" });
    expect(mapearLancamento({ ...linha, direction: "out" }, ctx()).lancamento.grupo).toBe("outras_despesas");
  });
  it("usa grupo e conta_cac da categoria", () => {
    const categorias = new Map([["p1", { nome: "Meta Ads", grupo: "marketing" as const, conta_cac: true }]]);
    const m = mapearLancamento({ ...linha, direction: "out", account_plan_id: "p1" }, ctx({ categorias }));
    expect(m.lancamento).toMatchObject({ grupo: "marketing", conta_cac: true });
    expect(m.detalhe.categoria).toEqual({ id: "p1", nome: "Meta Ads", grupo: "marketing" });
  });
  it("recebimento de contrato: cliente_id é o CONTRATO e cobranca_contrato true", () => {
    const m = mapearLancamento(linha, ctx({ contratoDoLancamento: new Map([["e1", "contrato-9"]]) }));
    expect(m.lancamento).toMatchObject({ cobranca_contrato: true, cliente_id: "contrato-9" });
  });
  it("lançamento comum: cliente_id nulo e cobranca_contrato false", () => {
    expect(mapearLancamento(linha, ctx()).lancamento).toMatchObject({ cobranca_contrato: false, cliente_id: null });
  });
  it("pendente fica sem paid_date; parcela, conta e recorrente nos detalhes", () => {
    const m = mapearLancamento({ ...linha, status: "pending", paid_at: null, recurring_entry_id: "r1" }, ctx({ parcelas: new Map([["e1", { numero: 2, total: 3 }]]) }));
    expect(m.lancamento.paid_date).toBeNull();
    expect(m.detalhe).toMatchObject({ recorrente: true, parcela: { numero: 2, total: 3 }, conta: { id: "c1", nome: "Caixa" } });
  });
});

describe("mapearContrato", () => {
  const c = { id: "k", inicio: "2026-01-01", fim: null, situacao: "ativo" as const, created_at: "2026-01-01T02:00:00Z", updated_at: "2026-05-01T12:00:00Z",
    contrato_formas: [{ tipo: "mensalidade", valor_cents: 1000, ativa: true }, { tipo: "mensalidade", valor_cents: 500, ativa: false }, { tipo: "avulso", valor_cents: 99, ativa: true }] };
  it("soma só mensalidades ativas; created_at vira data civil; ativo não tem encerrado_em", () => {
    expect(mapearContrato(c)).toMatchObject({ mensal_cents: 1000, criado_em: "2025-12-31", encerrado_em: null });
  });
  it("não ativo usa updated_at como encerrado_em", () => {
    expect(mapearContrato({ ...c, situacao: "encerrado" }).encerrado_em).toBe("2026-05-01");
  });
});

describe("saldosPorConta", () => {
  it("saldo inicial + pagos por conta; pendente não conta", () => {
    const mk = (id: string, direction: "in" | "out", amount_cents: number, status: "paid" | "pending") =>
      mapearLancamento({ ...linha, id, direction, amount_cents, status }, ctx());
    const ms = [mk("a", "in", 1000, "paid"), mk("b", "out", 300, "paid"), mk("c", "in", 9999, "pending")];
    const detalhes = new Map(ms.map((m) => [m.lancamento.id, m.detalhe]));
    const s = saldosPorConta([{ id: "c1", opening_balance_cents: 100 }], ms.map((m) => m.lancamento), detalhes);
    expect(s.get("c1")).toBe(800);
  });
});
