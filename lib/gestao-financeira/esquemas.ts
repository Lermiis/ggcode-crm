import { z } from "zod";

import { hojeNoFuso } from "@/lib/contratos/regras";

import type { Grupo } from "./tipos";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD");
const centavos = z.number().int().min(1).max(10_000_000_00);
const direction = z.enum(["in", "out"]);
const descricao = z.string().trim().min(1).max(200);

export const GRUPOS: [Grupo, ...Grupo[]] = ["receita", "imposto", "custo_variavel", "pessoal", "assinaturas", "marketing", "estrutura", "outras_despesas"];

export const lancamentoSchema = z
  .object({
    direction,
    amount_cents: centavos,
    entry_date: data,
    account_id: z.string().uuid(),
    account_plan_id: z.string().uuid().nullish(),
    description: descricao,
    pago: z.boolean().optional(),
    paid_date: data.nullish(),
  })
  .refine((l) => !l.paid_date || l.pago, { message: "Data de pagamento só com lançamento pago." });
export type LancamentoEntrada = z.infer<typeof lancamentoSchema>;

export const parceladoSchema = z.object({
  direction,
  total_cents: centavos,
  parcelas: z.number().int().min(2).max(60),
  primeiro: data,
  account_id: z.string().uuid(),
  account_plan_id: z.string().uuid().nullish(),
  description: descricao,
});

/** Editar (pendente) e corrigir (pago) levam os mesmos campos. */
export const lancamentoEdicaoSchema = z.object({
  amount_cents: centavos,
  entry_date: data,
  account_id: z.string().uuid(),
  account_plan_id: z.string().uuid().nullish(),
  description: descricao,
});

export const pagarSchema = z.object({ paid_date: data.nullish() });

export const recorrenciaSchema = z
  .object({
    id: z.string().uuid().nullish(),
    direction,
    amount_cents: centavos,
    day_of_month: z.number().int().min(1).max(31),
    account_id: z.string().uuid(),
    account_plan_id: z.string().uuid().nullish(),
    description: descricao,
    fim: data.nullish(),
  })
  .refine((r) => !r.fim || r.fim >= hojeNoFuso(), { message: "O fim não pode ser antes de hoje." });

export const categoriaSchema = z
  .object({
    id: z.string().uuid().nullish(),
    nome: z.string().trim().min(1).max(80),
    direction,
    grupo: z.enum(GRUPOS),
    conta_cac: z.boolean().optional(),
  })
  .refine((c) => (c.grupo === "receita") === (c.direction === "in"), { message: "Grupo incompatível com a direção." });

export const acessoSchema = z.object({ user_id: z.string().uuid(), nivel: z.enum(["nenhum", "ver", "editar"]) });
