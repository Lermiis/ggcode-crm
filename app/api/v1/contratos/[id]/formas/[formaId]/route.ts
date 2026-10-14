/**
 * Editar forma de cobrança. PATCH: valor/dia/descrição (conforme o tipo).
 * POST ?acao=refazer: refaz o parcelamento da implantação (só o que falta receber).
 * Não é transação única: ver a ordem de cada operação abaixo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { refazerParcelamento, vencimentoPeloDia } from "@/lib/contratos/edicao";
import { editarFormaSchema, refazerParcelamentoSchema } from "@/lib/contratos/esquemas";
import { hojeNoFuso } from "@/lib/contratos/regras";
import { logger } from "@/lib/logger";

import { entrar, respostaDeErro } from "../../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; formaId: string }> };

const agora = () => new Date().toISOString();

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const ent = await entrar("editar", "contrato_formas", requestId);
  if (!ent.ok) return ent.response;
  const { supabase, orgId } = ent;
  const lido = editarFormaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const { id, formaId } = await ctx.params;
  const c = lido.data;

  const { data: forma, error: e0 } = await supabase.from("contrato_formas").select("id, tipo, ativa")
    .eq("id", formaId).eq("contrato_id", id).eq("organization_id", orgId).maybeSingle();
  if (e0) return respostaDeErro(e0, requestId);
  if (!forma) return fail("not_found", "Forma de cobrança não encontrada.", 404, { requestId });

  if (forma.tipo === "implantacao") return fail("validation_failed", "Para mudar a implantação, refaça o parcelamento.", 422, { requestId });

  if (forma.tipo === "avulso") {
    const { data: cob, error: e1 } = await supabase.from("contrato_cobrancas").select("id, situacao")
      .eq("forma_id", formaId).eq("organization_id", orgId).limit(1).maybeSingle();
    if (e1) return respostaDeErro(e1, requestId);
    if (!cob || cob.situacao !== "a_receber") return fail("conflict", "Só dá para editar avulso a receber.", 409, { requestId });
    const { error: e2 } = await supabase.from("contrato_cobrancas")
      .update({
        ...(c.valor_cents ? { valor_cents: c.valor_cents } : {}),
        ...(c.vencimento ? { vencimento: c.vencimento } : {}),
        ...(c.descricao ? { descricao: c.descricao } : {}),
        updated_at: agora(),
      })
      .eq("id", cob.id).eq("organization_id", orgId).eq("situacao", "a_receber");
    if (e2) return respostaDeErro(e2, requestId);
    const { error: e3 } = await supabase.from("contrato_formas")
      .update({
        ...(c.valor_cents ? { valor_cents: c.valor_cents } : {}),
        ...(c.descricao ? { descricao: c.descricao } : {}),
        ...(c.vencimento ? { primeiro_vencimento: c.vencimento } : {}),
      })
      .eq("id", formaId).eq("organization_id", orgId);
    if (e3) return respostaDeErro(e3, requestId);
  } else {
    if (forma.tipo === "evento" && c.dia_vencimento) return fail("validation_failed", "Evento não tem dia de vencimento.", 422, { requestId });
    const { error: e1 } = await supabase.from("contrato_formas")
      .update({
        ...(c.valor_cents ? { valor_cents: c.valor_cents } : {}),
        ...(forma.tipo === "mensalidade" && c.dia_vencimento ? { dia_vencimento: c.dia_vencimento } : {}),
      })
      .eq("id", formaId).eq("organization_id", orgId);
    if (e1) return respostaDeErro(e1, requestId);

    // Aplicar às próximas: só mensalidade, só a_receber com vencimento >= hoje (idempotente: dá para repetir).
    if (forma.tipo === "mensalidade" && c.aplicar_futuras) {
      const { data: futuras, error: e2 } = await supabase.from("contrato_cobrancas").select("id, vencimento, valor_cents")
        .eq("forma_id", formaId).eq("organization_id", orgId).eq("situacao", "a_receber").gte("vencimento", hojeNoFuso());
      if (e2) return respostaDeErro(e2, requestId);
      for (const f of futuras ?? []) {
        const { error } = await supabase.from("contrato_cobrancas")
          .update({
            valor_cents: c.valor_cents ?? f.valor_cents,
            vencimento: c.dia_vencimento ? vencimentoPeloDia(f.vencimento, c.dia_vencimento) : f.vencimento,
            updated_at: agora(),
          })
          .eq("id", f.id).eq("organization_id", orgId).eq("situacao", "a_receber");
        if (error) return respostaDeErro(error, requestId);
      }
    }
  }
  await audit({ action: "contratos.forma_editada", resourceType: "contrato_forma", resourceId: formaId, requestId });
  return ok({ id: formaId }, { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  if (new URL(req.url).searchParams.get("acao") !== "refazer") return fail("validation_failed", "Ação inválida.", 422, { requestId });
  const ent = await entrar("editar", "contrato_formas", requestId);
  if (!ent.ok) return ent.response;
  const { supabase, orgId } = ent;
  const lido = refazerParcelamentoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const { id, formaId } = await ctx.params;

  const { data: forma, error: e0 } = await supabase.from("contrato_formas")
    .select("id, valor_cents, contratos!inner(situacao)").eq("id", formaId).eq("contrato_id", id).eq("organization_id", orgId).eq("tipo", "implantacao").maybeSingle();
  if (e0) return respostaDeErro(e0, requestId);
  if (!forma || (forma.contratos as unknown as { situacao: string }).situacao !== "ativo") {
    return fail("validation_failed", "Implantação não encontrada em contrato ativo.", 422, { requestId });
  }
  const { data: cobs, error: e1 } = await supabase.from("contrato_cobrancas").select("competencia, valor_cents, situacao")
    .eq("forma_id", formaId).eq("organization_id", orgId);
  if (e1) return respostaDeErro(e1, requestId);
  const recebidas = (cobs ?? []).filter((x) => x.situacao === "recebida") as Array<{ competencia: string; valor_cents: number }>;

  let novas;
  try {
    novas = refazerParcelamento({
      total_cents: forma.valor_cents, recebidas, novasParcelas: lido.data.parcelas, primeiroVencimento: lido.data.primeiro_vencimento,
      ocupadas: (cobs ?? []).filter((x) => x.situacao !== "a_receber").map((x) => x.competencia),
    });
  } catch (e) {
    return fail("validation_failed", (e as Error).message, 422, { requestId });
  }

  // Competência é única por forma e as novas podem reaproveitar a numeração das a_receber:
  // apaga as antigas (guardando o que saiu) e insere as novas; se a inserção falhar, devolve as antigas.
  const { data: antigas, error: e2 } = await supabase.from("contrato_cobrancas").delete()
    .eq("forma_id", formaId).eq("organization_id", orgId).eq("situacao", "a_receber").select("*");
  if (e2) return respostaDeErro(e2, requestId);
  const { error: e3 } = await supabase.from("contrato_cobrancas")
    .insert(novas.map((n) => ({ ...n, organization_id: orgId, contrato_id: id, forma_id: formaId })));
  if (e3) {
    if (antigas?.length) {
      const { error: eR } = await supabase.from("contrato_cobrancas").insert(antigas);
      if (eR) logger.error("contratos.refazer_restauracao_falhou", { requestId, formaId, code: eR.code, message: eR.message });
    }
    return respostaDeErro(e3, requestId);
  }
  const { error: e4 } = await supabase.from("contrato_formas").update({ parcelas: recebidas.length + novas.length }).eq("id", formaId).eq("organization_id", orgId);
  if (e4) return respostaDeErro(e4, requestId);

  await audit({ action: "contratos.parcelamento_refeito", resourceType: "contrato_forma", resourceId: formaId, requestId, metadata: { parcelas: novas.length } });
  return ok({ parcelas: novas.length }, { requestId });
}
