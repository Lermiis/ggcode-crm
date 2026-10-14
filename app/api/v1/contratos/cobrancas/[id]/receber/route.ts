import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { moduloAusente } from "@/lib/contratos/modulo";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { receberSchema } from "@/lib/contratos/esquemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { MENSAGEM_MODULO } from "../../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const RECUSAS: Record<string, [string, string, number]> = {
  cobranca_nao_encontrada: ["not_found", "Cobrança não encontrada.", 404],
  cobranca_nao_recebivel: ["conflict", "Esta cobrança já foi recebida ou cancelada.", 409],
  conta_invalida: ["validation_failed", "Escolha uma conta ativa desta empresa.", 422],
  contratos_forbidden: ["forbidden", "Sem permissão para registrar recebimento.", 403],
};

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contrato_cobrancas" });
  if (!authz.ok) return authz.response;
  const lido = receberSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", "Escolha a conta.", 422, { requestId });
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("fn_contratos_cobranca_receber", {
    p_org: authz.org.orgId, p_cobranca: id, p_account_id: lido.data.account_id, p_recebida_em: lido.data.recebida_em ?? null,
  });
  if (error) {
    if (moduloAusente(error)) return fail("module_not_installed", MENSAGEM_MODULO, 409, { requestId });
    if (error.code === "22008" || error.code === "22007") return fail("validation_failed", "Data inválida.", 422, { requestId });
    const chave = Object.keys(RECUSAS).find((k) => error.message?.includes(k));
    if (chave) { const [code, msg, st] = RECUSAS[chave]!; return fail(code, msg, st, { requestId }); }
    return fail("internal_error", "Erro ao registrar o recebimento.", 500, { requestId });
  }
  await audit({ action: "contratos.cobranca_recebida", resourceType: "contrato_cobranca", resourceId: id, requestId,
    metadata: { financial_entry_id: (data as { financial_entry_id: string }).financial_entry_id } });
  return ok(data, { requestId });
}
