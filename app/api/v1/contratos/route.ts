/**
 * CONTRATOS (GG Code, migration 9001) — lista e criação.
 * Criar = contrato + formas + cobranças iniciais (implantação, avulso, mensalidade do mês).
 * Não é transação única: se uma etapa falhar, o contrato recém-criado é apagado (sem cobrança
 * recebida, a policy de delete permite) para não deixar contrato pela metade.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { criarContratoSchema } from "@/lib/contratos/esquemas";
import { cobrancasIniciais, hojeNoFuso } from "@/lib/contratos/regras";
import { logger } from "@/lib/logger";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { respostaDeErro } from "./_comum";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const hoje = hojeNoFuso();

  const { data, error } = await supabase
    .from("contratos")
    .select("id, lead_id, titulo, inicio, fim, situacao, crm_leads(title), contrato_formas(tipo, valor_cents, ativa), contrato_cobrancas(vencimento, situacao)")
    .eq("organization_id", authz.org.orgId)
    .order("situacao")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return respostaDeErro(error, requestId);

  const lista = (data ?? []).map((c) => ({
    id: c.id, lead_id: c.lead_id, titulo: c.titulo, inicio: c.inicio, fim: c.fim, situacao: c.situacao,
    cliente: (c.crm_leads as { title?: string } | null)?.title ?? "—",
    mensal_cents: (c.contrato_formas as Array<{ tipo: string; valor_cents: number; ativa: boolean }>)
      .filter((f) => f.tipo === "mensalidade" && f.ativa).reduce((s, f) => s + f.valor_cents, 0),
    proximo_vencimento: (c.contrato_cobrancas as Array<{ vencimento: string; situacao: string }>)
      .filter((k) => k.situacao === "a_receber" && k.vencimento >= hoje).map((k) => k.vencimento).sort()[0] ?? null,
  }));
  return ok(lista, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;

  const lido = criarContratoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const orgId = authz.org.orgId;
  const corpo = lido.data;
  const supabase = await createClient();

  const { data: lead, error: eLead } = await supabase.from("crm_leads").select("id").eq("id", corpo.lead_id).eq("organization_id", orgId).maybeSingle();
  if (eLead) return respostaDeErro(eLead, requestId);
  if (!lead) return fail("validation_failed", "Negócio inválido para esta organização.", 422, { requestId });

  const { data: contrato, error: e1 } = await supabase
    .from("contratos")
    .insert({ organization_id: orgId, lead_id: corpo.lead_id, titulo: corpo.titulo, inicio: corpo.inicio, fim: corpo.fim ?? null })
    .select("id")
    .single();
  if (e1) return respostaDeErro(e1, requestId);

  const desfazer = async () => {
    const { error } = await supabase.from("contratos").delete().eq("id", contrato.id);
    if (error) logger.error("contratos.rollback_falhou", { requestId, contratoId: contrato.id, code: error.code, message: error.message });
  };
  const hoje = corpo.inicio > hojeNoFuso() ? corpo.inicio : hojeNoFuso();

  for (const forma of corpo.formas) {
    const { data: f, error: e2 } = await supabase
      .from("contrato_formas")
      .insert({ organization_id: orgId, contrato_id: contrato.id, tipo: forma.tipo, valor_cents: forma.valor_cents,
        parcelas: forma.parcelas ?? 1, primeiro_vencimento: forma.primeiro_vencimento ?? null,
        dia_vencimento: forma.dia_vencimento ?? null, descricao: forma.descricao ?? null })
      .select("id")
      .single();
    if (e2) { await desfazer(); return respostaDeErro(e2, requestId); }
    const novas = cobrancasIniciais(forma, hoje).map((c) => ({ ...c, organization_id: orgId, contrato_id: contrato.id, forma_id: f.id }));
    if (novas.length) {
      const { error: e3 } = await supabase.from("contrato_cobrancas").insert(novas);
      if (e3) { await desfazer(); return respostaDeErro(e3, requestId); }
    }
  }

  await audit({ action: "contratos.contrato_criado", resourceType: "contrato", resourceId: contrato.id, requestId, metadata: { formas: corpo.formas.length } });
  return ok({ id: contrato.id }, { requestId, status: 201 });
}
