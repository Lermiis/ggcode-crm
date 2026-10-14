import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { carregarRecorrencias } from "@/lib/gestao-financeira/carregar";
import { recorrenciaSchema } from "@/lib/gestao-financeira/esquemas";

import { entrar, protegido, respostaDeErro } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("ver", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  return protegido(requestId, async () => ok(await carregarRecorrencias(g.supabase, g.orgId), { requestId }));
}

/** Sem `id` cria; com `id` altera (fn_gf_recorrencia_salvar). */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("editar", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const lido = recorrenciaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const r = lido.data;
  const { data, error } = await g.supabase.rpc("fn_gf_recorrencia_salvar", {
    p_org: g.orgId, p_id: r.id ?? null, p_direction: r.direction, p_account_id: r.account_id, p_account_plan_id: r.account_plan_id ?? null,
    p_amount_cents: r.amount_cents, p_day: r.day_of_month, p_description: r.description, p_fim: r.fim ?? null,
  });
  if (error) return respostaDeErro(error, requestId);
  return ok({ id: data }, { requestId, status: r.id ? 200 : 201 });
}
