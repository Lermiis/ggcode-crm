import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

import { entrar, respostaDeErro } from "../../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const ent = await entrar("editar", "contrato_cobrancas", requestId);
  if (!ent.ok) return ent.response;
  const { supabase, orgId } = ent;
  const { id } = await ctx.params;
  const { data, error } = await supabase.from("contrato_cobrancas")
    .update({ situacao: "cancelada", updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", orgId).eq("situacao", "a_receber").select("id, situacao").maybeSingle();
  if (error) return respostaDeErro(error, requestId);
  if (!data) return fail("conflict", "Só dá para cancelar cobrança a receber.", 409, { requestId });
  await audit({ action: "contratos.cobranca_cancelada", resourceType: "contrato_cobranca", resourceId: id, requestId });
  return ok(data, { requestId });
}
