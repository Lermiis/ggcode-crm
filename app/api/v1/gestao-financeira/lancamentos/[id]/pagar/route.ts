import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { pagarSchema } from "@/lib/gestao-financeira/esquemas";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { entrar, respostaDeErro } from "../../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const g = await entrar("editar", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const lido = pagarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", "Data de pagamento inválida.", 422, { requestId });
  const { error } = await g.supabase.rpc("fn_gf_lancamento_pagar", { p_org: g.orgId, p_entry: id, p_paid_date: lido.data.paid_date ?? null });
  if (error) return respostaDeErro(error, requestId);
  await audit({ action: "financeiro.lancamento_pago", resourceType: "financial_entry", resourceId: id, requestId });
  return ok({ id }, { requestId });
}
