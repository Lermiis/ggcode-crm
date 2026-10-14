import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";

import { entrar, respostaDeErro } from "../../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("editar", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const { error } = await g.supabase.rpc("fn_gf_recorrencia_encerrar", { p_org: g.orgId, p_id: id });
  if (error) return respostaDeErro(error, requestId);
  return ok({ id }, { requestId });
}
