import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { carregarContas, carregarLancamentos, saldosPorConta } from "@/lib/gestao-financeira/carregar";

import { entrar, protegido } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("ver", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  return protegido(requestId, async () => {
    const [contas, { lancamentos, detalhes }] = await Promise.all([carregarContas(g.supabase, g.orgId), carregarLancamentos(g.supabase, g.orgId)]);
    const saldos = saldosPorConta(contas, lancamentos, detalhes);
    return ok(contas.filter((c) => c.is_active).map((c) => ({ id: c.id, nome: c.name, saldo_cents: saldos.get(c.id) ?? 0 })), { requestId });
  });
}
