import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { hojeNoFuso } from "@/lib/contratos/regras";
import { fluxoProjetado } from "@/lib/gestao-financeira/calculos";
import {
  carregarCobrancas, carregarContas, carregarContratos, carregarLancamentos, carregarRecorrencias, saldoInicialTotal,
} from "@/lib/gestao-financeira/carregar";

import { entrar, protegido } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("ver", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const meses = Number(req.nextUrl.searchParams.get("meses") ?? 6);
  if (!Number.isInteger(meses) || meses < 1 || meses > 24) return fail("validation_failed", "Meses deve ser de 1 a 24.", 422, { requestId });
  return protegido(requestId, async () => {
    const [{ lancamentos }, cobrancas, contas, contratos, recorrencias] = await Promise.all([
      carregarLancamentos(g.supabase, g.orgId),
      carregarCobrancas(g.supabase, g.orgId),
      carregarContas(g.supabase, g.orgId),
      carregarContratos(g.supabase, g.orgId),
      carregarRecorrencias(g.supabase, g.orgId),
    ]);
    const saldoAtual =
      saldoInicialTotal(contas) +
      lancamentos.filter((l) => l.status === "paid").reduce((s, l) => s + (l.direction === "in" ? l.amount_cents : -l.amount_cents), 0);
    return ok(fluxoProjetado({ hoje: hojeNoFuso(), mesesFuturos: meses, saldoAtual, lancamentos, recorrencias, contratos, cobrancas }), { requestId });
  });
}
