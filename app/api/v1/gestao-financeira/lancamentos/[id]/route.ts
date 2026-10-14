import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { lancamentoEdicaoSchema } from "@/lib/gestao-financeira/esquemas";

import { entrar, respostaDeErro } from "../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Editar lançamento PENDENTE. Pago = 409 lancamento_pago_imutavel (usar /corrigir). */
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("editar", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const lido = lancamentoEdicaoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const l = lido.data;
  const { error } = await g.supabase.rpc("fn_gf_lancamento_editar", {
    p_org: g.orgId, p_entry: id, p_amount_cents: l.amount_cents, p_entry_date: l.entry_date,
    p_account_id: l.account_id, p_account_plan_id: l.account_plan_id ?? null, p_description: l.description,
  });
  if (error) return respostaDeErro(error, requestId);
  return ok({ id }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("editar", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const { error } = await g.supabase.rpc("fn_gf_lancamento_excluir", { p_org: g.orgId, p_entry: id });
  if (error) return respostaDeErro(error, requestId);
  await audit({ action: "financeiro.lancamento_removido", resourceType: "financial_entry", resourceId: id, requestId });
  return ok({ id }, { requestId });
}
