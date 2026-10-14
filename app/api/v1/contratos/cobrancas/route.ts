import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { filtroSchema } from "@/lib/contratos/esquemas";
import { hojeNoFuso, somarMeses, totaisDoMes } from "@/lib/contratos/regras";

import { achatarCobranca, entrar, respostaDeErro, SELECT_COBRANCA } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ent = await entrar("ver", "contratos", requestId);
  if (!ent.ok) return ent.response;
  const { supabase, orgId } = ent;
  const filtro = filtroSchema.parse(new URL(req.url).searchParams.get("filtro"));
  const hoje = hojeNoFuso();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const fimMes = somarMeses(inicioMes, 1);

  // Totais: tudo que pode cair nos três números (atrasadas de qualquer mês + o mês corrente).
  const base = supabase.from("contrato_cobrancas").select("situacao, vencimento, valor_cents, recebida_em").eq("organization_id", orgId);
  const { data: paraTotais, error: e1 } = await base.or(`and(situacao.eq.a_receber,vencimento.lt.${fimMes}),and(situacao.eq.recebida,recebida_em.gte.${inicioMes},recebida_em.lt.${fimMes})`).limit(5000);
  if (e1) return respostaDeErro(e1, requestId);

  let q = supabase.from("contrato_cobrancas").select(SELECT_COBRANCA).eq("organization_id", orgId);
  if (filtro === "atrasadas") q = q.eq("situacao", "a_receber").lt("vencimento", hoje).order("vencimento");
  else if (filtro === "mes") q = q.eq("situacao", "a_receber").gte("vencimento", hoje).lt("vencimento", fimMes).order("vencimento");
  else if (filtro === "proximas") q = q.eq("situacao", "a_receber").gte("vencimento", fimMes).order("vencimento");
  else q = q.eq("situacao", "recebida").order("recebida_em", { ascending: false });
  const { data, error } = await q.limit(300);
  if (error) return respostaDeErro(error, requestId);

  return ok({
    cobrancas: (data ?? []).map((l) => achatarCobranca(l as never)),
    totais: totaisDoMes((paraTotais ?? []) as never, hoje),
  }, { requestId });
}
