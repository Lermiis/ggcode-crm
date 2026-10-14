import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { lancarEventoSchema } from "@/lib/contratos/esquemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { achatarCobranca, respostaDeErro, SELECT_COBRANCA } from "../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const lido = lancarEventoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const { id: contratoId } = await ctx.params;
  const orgId = authz.org.orgId;
  const supabase = await createClient();

  const { data: forma, error: e1 } = await supabase.from("contrato_formas")
    .select("id, valor_cents, contratos!inner(situacao)").eq("id", lido.data.forma_id).eq("contrato_id", contratoId)
    .eq("organization_id", orgId).eq("tipo", "evento").maybeSingle();
  if (e1) return respostaDeErro(e1, requestId);
  if (!forma || (forma.contratos as unknown as { situacao: string }).situacao !== "ativo") {
    return fail("validation_failed", "Forma de cobrança por evento não encontrada em contrato ativo.", 422, { requestId });
  }

  const { data, error } = await supabase.from("contrato_cobrancas").insert({
    organization_id: orgId, contrato_id: contratoId, forma_id: forma.id, competencia: `evento-${randomUUID()}`,
    descricao: `Evento: ${lido.data.titulo}`, vencimento: lido.data.data, valor_cents: lido.data.valor_cents ?? forma.valor_cents,
  }).select(SELECT_COBRANCA).single();
  if (error) return respostaDeErro(error, requestId);

  await audit({ action: "contratos.evento_lancado", resourceType: "contrato", resourceId: contratoId, requestId });
  return ok(achatarCobranca(data as never), { requestId });
}
