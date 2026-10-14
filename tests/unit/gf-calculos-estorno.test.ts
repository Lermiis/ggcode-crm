import { describe, expect, it } from "vitest";

import { visaoGeral } from "@/lib/gestao-financeira/calculos";
import type { CobrancaContrato, Lancamento } from "@/lib/gestao-financeira/tipos";

const base: Lancamento = {
  id: "a", direction: "in", amount_cents: 10000, entry_date: "2026-10-10", status: "paid", paid_date: "2026-10-10",
  grupo: "receita", conta_cac: false, origin: "manual", reverses_entry_id: null, cobranca_contrato: true, cliente_id: "k1",
};
const cobranca: CobrancaContrato = { vencimento: "2026-10-10", valor_cents: 10000, situacao: "recebida", recebida_em: "2026-10-10", contrato_id: "k1" };

describe("recebimento de contrato + estorno", () => {
  it("Faturado conta a cobrança uma vez e Recebido anula com o estorno", () => {
    const estorno: Lancamento = { ...base, id: "b", direction: "out", reverses_entry_id: "a", cobranca_contrato: false, cliente_id: null };
    const v = visaoGeral({ mes: "2026-10", hoje: "2026-10-20", lancamentos: [base, estorno], cobrancas: [cobranca], saldoInicialContas: 0 });
    expect(v.faturado).toBe(10000);
    expect(v.recebido).toBe(0);
    expect(v.saldo).toBe(0);
  });
  it("sem estorno: Recebido 10000 e Faturado continua 10000 (não duplica)", () => {
    const v = visaoGeral({ mes: "2026-10", hoje: "2026-10-20", lancamentos: [base], cobrancas: [cobranca], saldoInicialContas: 0 });
    expect(v.faturado).toBe(10000);
    expect(v.recebido).toBe(10000);
  });
});
