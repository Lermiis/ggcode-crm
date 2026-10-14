import { describe, expect, it } from "vitest";

import { hojeNoFuso, somarMeses } from "@/lib/contratos/regras";
import { acessoSchema, categoriaSchema, lancamentoSchema, parceladoSchema, recorrenciaSchema } from "@/lib/gestao-financeira/esquemas";

const U = "11111111-1111-4111-8111-111111111111";
const base = { direction: "out", amount_cents: 1000, entry_date: "2026-10-15", account_id: U, description: "Aluguel" };

describe("lancamentoSchema", () => {
  it("aceita o mínimo, com categoria opcional", () => {
    expect(lancamentoSchema.safeParse(base).success).toBe(true);
    expect(lancamentoSchema.safeParse({ ...base, account_plan_id: U }).success).toBe(true);
    expect(lancamentoSchema.safeParse({ ...base, account_plan_id: null }).success).toBe(true);
  });
  it("aceita pago com paid_date", () => {
    expect(lancamentoSchema.safeParse({ ...base, pago: true, paid_date: "2026-10-16" }).success).toBe(true);
  });
  it.each([
    ["direction", { direction: "x" }],
    ["valor zero", { amount_cents: 0 }],
    ["valor negativo", { amount_cents: -5 }],
    ["valor fracionado", { amount_cents: 10.5 }],
    ["data", { entry_date: "15/10/2026" }],
    ["conta", { account_id: "abc" }],
    ["categoria", { account_plan_id: "abc" }],
    ["descrição vazia", { description: "  " }],
    ["paid_date sem pago", { paid_date: "2026-10-16" }],
    ["paid_date inválida", { pago: true, paid_date: "ontem" }],
  ])("recusa %s", (_n, extra) => {
    expect(lancamentoSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });
});

describe("parceladoSchema", () => {
  const p = { direction: "in", total_cents: 100000, parcelas: 2, primeiro: "2026-11-01", account_id: U, description: "Implantação" };
  it("aceita de 2 a 60 parcelas", () => {
    expect(parceladoSchema.safeParse(p).success).toBe(true);
    expect(parceladoSchema.safeParse({ ...p, parcelas: 60 }).success).toBe(true);
  });
  it.each([1, 61, 0, 2.5])("recusa %s parcelas", (parcelas) => {
    expect(parceladoSchema.safeParse({ ...p, parcelas }).success).toBe(false);
  });
  it("recusa total zero e data ruim", () => {
    expect(parceladoSchema.safeParse({ ...p, total_cents: 0 }).success).toBe(false);
    expect(parceladoSchema.safeParse({ ...p, primeiro: "2026-13" }).success).toBe(false);
  });
});

describe("recorrenciaSchema", () => {
  const r = { direction: "out", amount_cents: 5000, day_of_month: 10, account_id: U, description: "Internet" };
  it("aceita dia 1 a 31 e fim opcional", () => {
    expect(recorrenciaSchema.safeParse(r).success).toBe(true);
    expect(recorrenciaSchema.safeParse({ ...r, day_of_month: 1 }).success).toBe(true);
    expect(recorrenciaSchema.safeParse({ ...r, day_of_month: 31 }).success).toBe(true);
  });
  it.each([0, 32, 1.5])("recusa dia %s", (day_of_month) => {
    expect(recorrenciaSchema.safeParse({ ...r, day_of_month }).success).toBe(false);
  });
  it("fim >= hoje", () => {
    const hoje = hojeNoFuso();
    expect(recorrenciaSchema.safeParse({ ...r, fim: hoje }).success).toBe(true);
    expect(recorrenciaSchema.safeParse({ ...r, fim: somarMeses(hoje, 3) }).success).toBe(true);
    expect(recorrenciaSchema.safeParse({ ...r, fim: "2000-01-01" }).success).toBe(false);
  });
});

describe("categoriaSchema", () => {
  it("receita só com entrada; despesa só com saída", () => {
    expect(categoriaSchema.safeParse({ nome: "Vendas", direction: "in", grupo: "receita" }).success).toBe(true);
    expect(categoriaSchema.safeParse({ nome: "Meta Ads", direction: "out", grupo: "marketing", conta_cac: true }).success).toBe(true);
    expect(categoriaSchema.safeParse({ nome: "X", direction: "out", grupo: "receita" }).success).toBe(false);
    expect(categoriaSchema.safeParse({ nome: "X", direction: "in", grupo: "marketing" }).success).toBe(false);
    expect(categoriaSchema.safeParse({ nome: "X", direction: "out", grupo: "inventado" }).success).toBe(false);
  });
});

describe("acessoSchema", () => {
  it.each(["nenhum", "ver", "editar"])("aceita %s", (nivel) => {
    expect(acessoSchema.safeParse({ user_id: U, nivel }).success).toBe(true);
  });
  it.each(["admin", "", "VER"])("recusa nível %s", (nivel) => {
    expect(acessoSchema.safeParse({ user_id: U, nivel }).success).toBe(false);
  });
  it("recusa user_id que não é uuid", () => {
    expect(acessoSchema.safeParse({ user_id: "x", nivel: "ver" }).success).toBe(false);
  });
});
