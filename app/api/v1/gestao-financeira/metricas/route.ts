import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { hojeNoFuso, somarMeses } from "@/lib/contratos/regras";
import { metricas } from "@/lib/gestao-financeira/calculos";
import { carregarContratos, carregarLancamentos, contarGanhos } from "@/lib/gestao-financeira/carregar";

import { entrar, protegido } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("ver", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const n = Number(req.nextUrl.searchParams.get("periodo") ?? 3);
  if (![1, 3, 6, 12].includes(n)) return fail("validation_failed", "Período deve ser 1, 3, 6 ou 12.", 422, { requestId });
  const ate = hojeNoFuso().slice(0, 7);
  const de = somarMeses(`${ate}-01`, -(n - 1)).slice(0, 7);
  return protegido(requestId, async () => {
    const [{ lancamentos }, contratos] = await Promise.all([carregarLancamentos(g.supabase, g.orgId), carregarContratos(g.supabase, g.orgId)]);
    const ganhosSemContrato = contratos.length === 0 ? await contarGanhos(g.supabase, g.orgId, de, ate) : 0;
    return ok({ ...metricas({ de, ate, lancamentos, contratos, ganhosSemContrato }), periodo: { de, ate } }, { requestId });
  });
}
