import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { alterarContratoSchema } from "@/lib/contratos/esquemas";
import { hojeNoFuso } from "@/lib/contratos/regras";

import { achatarCobranca, entrar, respostaDeErro, SELECT_COBRANCA } from "../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const ent = await entrar("ver", "contratos", requestId);
  if (!ent.ok) return ent.response;
  const { supabase, orgId } = ent;
  const { id } = await ctx.params;

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
  const ent = await entrar("editar", "contratos", requestId);
  if (!ent.ok) return ent.response;
  const { supabase, orgId } = ent;
  const lido = alterarContratoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "Ação inválida.", 422, { requestId });
  const { id } = await ctx.params;
  const corpo = lido.data;

  if (corpo.acao === "editar") {
    const { data: recebida, error: e0 } = await supabase.from("contrato_cobrancas").select("id")
      .eq("contrato_id", id).eq("organization_id", orgId).eq("situacao", "recebida").lt("vencimento", corpo.inicio).limit(1);
    if (e0) return respostaDeErro(e0, requestId);
    if (recebida?.length) return fail("validation_failed", "Já há recebimento antes dessa data.", 422, { requestId });
    const { data, error } = await supabase.from("contratos")
      .update({ titulo: corpo.titulo, inicio: corpo.inicio, fim: corpo.fim ?? null, updated_at: new Date().toISOString() })
      .eq("id", id).eq("organization_id", orgId).select("id, titulo, inicio, fim").maybeSingle();
    if (error) return respostaDeErro(error, requestId);
    if (!data) return fail("not_found", "Contrato não encontrado.", 404, { requestId });
    await audit({ action: "contratos.contrato_editado", resourceType: "contrato", resourceId: id, requestId });
    return ok(data, { requestId });
  }

  const situacao = corpo.acao === "encerrar" ? "encerrado" : "cancelado";
  const hoje = hojeNoFuso();

  // Ordem retry-safe: confirma o contrato, faz as escritas secundárias (idempotentes) e só por
  // último muda a situação. Se uma etapa falhar, o contrato continua "ativo" e dá para repetir.
  const { data: atual, error: e0 } = await supabase.from("contratos").select("id, inicio")
    .eq("id", id).eq("organization_id", orgId).eq("situacao", "ativo").maybeSingle();
  if (e0) return respostaDeErro(e0, requestId);
  if (!atual) return fail("not_found", "Contrato ativo não encontrado.", 404, { requestId });

  const { error: e1 } = await supabase.from("contrato_formas").update({ ativa: false }).eq("contrato_id", id).eq("organization_id", orgId);
  if (e1) return respostaDeErro(e1, requestId);
  if (corpo.cancelar_futuras) {
    const { error: e2 } = await supabase.from("contrato_cobrancas").update({ situacao: "cancelada", updated_at: new Date().toISOString() })
      .eq("contrato_id", id).eq("organization_id", orgId).eq("situacao", "a_receber").gt("vencimento", hoje);
    if (e2) return respostaDeErro(e2, requestId);
  }

  const { data, error } = await supabase.from("contratos")
    .update({ situacao, fim: hoje < atual.inicio ? atual.inicio : hoje, updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", orgId).eq("situacao", "ativo").select("id, situacao").maybeSingle();
  if (error) return respostaDeErro(error, requestId);
  if (!data) return fail("not_found", "Contrato ativo não encontrado.", 404, { requestId });

  await audit({ action: `contratos.contrato_${situacao}`, resourceType: "contrato", resourceId: id, requestId });
  return ok(data, { requestId });
}
