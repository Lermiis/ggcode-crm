import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { hojeNoFuso } from "@/lib/contratos/regras";
import { serie12Meses, visaoGeral } from "@/lib/gestao-financeira/calculos";
import { carregarCobrancas, carregarContas, carregarLancamentos, saldoInicialTotal } from "@/lib/gestao-financeira/carregar";

import { MES, entrar, protegido } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("ver", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const hoje = hojeNoFuso();
  const mes = req.nextUrl.searchParams.get("mes") ?? hoje.slice(0, 7);
  if (!MES.test(mes)) return fail("validation_failed", "Mês inválido (AAAA-MM).", 422, { requestId });
  return protegido(requestId, async () => {
    const [{ lancamentos }, cobrancas, contas] = await Promise.all([
      carregarLancamentos(g.supabase, g.orgId),
      carregarCobrancas(g.supabase, g.orgId),
      carregarContas(g.supabase, g.orgId),
    ]);
    const visao = visaoGeral({ mes, hoje, lancamentos, cobrancas, saldoInicialContas: saldoInicialTotal(contas) });
    return ok({ ...visao, serie: serie12Meses({ ateMes: mes, lancamentos }) }, { requestId });
  });
}
