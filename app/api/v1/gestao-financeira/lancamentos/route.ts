import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { carregarLancamentos } from "@/lib/gestao-financeira/carregar";
import { lancamentoSchema, parceladoSchema } from "@/lib/gestao-financeira/esquemas";

import { MES, entrar, protegido, respostaDeErro } from "../_comum";

export const dynamic = "force-dynamic";
const LIMITE = 500;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("ver", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const q = req.nextUrl.searchParams;
  const mes = q.get("mes");
  const direction = q.get("direction");
  const status = q.get("status");
  if ((mes && !MES.test(mes)) || (direction && !["in", "out"].includes(direction)) || (status && !["pending", "paid"].includes(status))) {
    return fail("validation_failed", "Filtro inválido.", 422, { requestId });
  }
  const conta = q.get("account_id");
  const categoria = q.get("account_plan_id");
  return protegido(requestId, async () => {
    const { lancamentos, detalhes } = await carregarLancamentos(g.supabase, g.orgId);
    const lista = lancamentos
      .filter((l) => (!mes || l.entry_date.startsWith(mes)) && (!direction || l.direction === direction) && (!status || l.status === status))
      .filter((l) => (!conta || detalhes.get(l.id)?.conta.id === conta) && (!categoria || detalhes.get(l.id)?.categoria?.id === categoria))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || a.id.localeCompare(b.id))
      .slice(0, LIMITE)
      .map((l) => {
        const d = detalhes.get(l.id)!;
        return {
          id: l.id, direction: l.direction, amount_cents: l.amount_cents, entry_date: l.entry_date, status: l.status,
          paid_date: l.paid_date, description: d.description, categoria: d.categoria, conta: d.conta, parcela: d.parcela,
          recorrente: d.recorrente, cobranca_contrato: l.cobranca_contrato,
        };
      });
    return ok(lista, { requestId });
  });
}

/** Corpo com `parcelas` = parcelado; sem = lançamento avulso. */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("editar", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if ("parcelas" in corpo) {
    const lido = parceladoSchema.safeParse(corpo);
    if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
    const p = lido.data;
    const { data, error } = await g.supabase.rpc("fn_gf_parcelado_criar", {
      p_org: g.orgId, p_direction: p.direction, p_account_id: p.account_id, p_account_plan_id: p.account_plan_id ?? null,
      p_total_cents: p.total_cents, p_parcelas: p.parcelas, p_primeiro: p.primeiro, p_description: p.description,
    });
    if (error) return respostaDeErro(error, requestId);
    await audit({ action: "financeiro.lancamento_criado", resourceType: "gf_parcelamento", resourceId: data as string, requestId, metadata: { direction: p.direction, parcelas: p.parcelas } });
    return ok({ id: data }, { requestId, status: 201 });
  }

  const lido = lancamentoSchema.safeParse(corpo);
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const l = lido.data;
  const { data, error } = await g.supabase.rpc("fn_gf_lancamento_criar", {
    p_org: g.orgId, p_direction: l.direction, p_account_id: l.account_id, p_account_plan_id: l.account_plan_id ?? null,
    p_amount_cents: l.amount_cents, p_entry_date: l.entry_date, p_description: l.description, p_pago: l.pago ?? false, p_paid_date: l.paid_date ?? null,
  });
  if (error) return respostaDeErro(error, requestId);
  await audit({ action: "financeiro.lancamento_criado", resourceType: "financial_entry", resourceId: data as string, requestId, metadata: { direction: l.direction, pago: l.pago ?? false } });
  return ok({ id: data }, { requestId, status: 201 });
}
