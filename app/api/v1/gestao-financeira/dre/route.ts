import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { hojeNoFuso } from "@/lib/contratos/regras";
import { dre } from "@/lib/gestao-financeira/calculos";
import { carregarLancamentos } from "@/lib/gestao-financeira/carregar";

import { MES, entrar, protegido } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("ver", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const mes = req.nextUrl.searchParams.get("mes") ?? hojeNoFuso().slice(0, 7);
  if (!MES.test(mes)) return fail("validation_failed", "Mês inválido (AAAA-MM).", 422, { requestId });
  return protegido(requestId, async () => ok(dre({ mes, lancamentos: (await carregarLancamentos(g.supabase, g.orgId)).lancamentos }), { requestId }));
}
