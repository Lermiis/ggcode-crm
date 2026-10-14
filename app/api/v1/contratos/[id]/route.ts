import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { alterarContratoSchema } from "@/lib/contratos/esquemas";
import { hojeNoFuso } from "@/lib/contratos/regras";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { achatarCobranca, respostaDeErro, SELECT_COBRANCA } from "../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const supabase = await createClient();
  const orgId = authz.org.orgId;

  const [c, f, k] = await Promise.all([
    supabase.from("contratos").select("id, lead_id, titulo, inicio, fim, situacao, crm_leads(title, contact_id)").eq("id", id).eq("organization_id", orgId).maybeSingle(),
    supabase.from("contrato_formas").select("id, tipo, valor_cents, parcelas, primeiro_vencimento, dia_vencimento, descricao, ativa").eq("contrato_id", id).eq("organization_id", orgId).order("created_at"),
    supabase.from("contrato_cobrancas").select(SELECT_COBRANCA).eq("contrato_id", id).eq("organization_id", orgId).order("vencimento"),
  ]);
  const erro = c.error ?? f.error ?? k.error;
  if (erro) return respostaDeErro(erro, requestId);
  if (!c.data) return fail("not_found", "Contrato não encontrado.", 404, { requestId });
  const lead = c.data.crm_leads as { title?: string; contact_id?: string } | null;
  return ok({
    contrato: { ...c.data, crm_leads: undefined, cliente: lead?.title ?? "—", contact_id: lead?.contact_id ?? null },
    formas: f.data ?? [],
    cobrancas: (k.data ?? []).map((l) => achatarCobranca(l as never)),
  }, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const lido = alterarContratoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", "Ação inválida.", 422, { requestId });
  const { id } = await ctx.params;
  const orgId = authz.org.orgId;
  const supabase = await createClient();
  const situacao = lido.data.acao === "encerrar" ? "encerrado" : "cancelado";
  const hoje = hojeNoFuso();

  const { data, error } = await supabase.from("contratos")
    .update({ situacao, fim: hoje, updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", orgId).eq("situacao", "ativo").select("id, situacao").maybeSingle();
  if (error) return respostaDeErro(error, requestId);
  if (!data) return fail("not_found", "Contrato ativo não encontrado.", 404, { requestId });

  await supabase.from("contrato_formas").update({ ativa: false }).eq("contrato_id", id).eq("organization_id", orgId);
  if (lido.data.cancelar_futuras) {
    await supabase.from("contrato_cobrancas").update({ situacao: "cancelada", updated_at: new Date().toISOString() })
      .eq("contrato_id", id).eq("organization_id", orgId).eq("situacao", "a_receber").gt("vencimento", hoje);
  }
  await audit({ action: `contratos.contrato_${situacao}`, resourceType: "contrato", resourceId: id, requestId });
  return ok(data, { requestId });
}
