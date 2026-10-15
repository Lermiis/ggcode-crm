import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { exigirAcesso } from "@/lib/gestao-financeira/acesso";
import { categoriaSchema } from "@/lib/gestao-financeira/esquemas";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { entrar, protegido, respostaDeErro } from "../_comum";

export const dynamic = "force-dynamic";

/** Lista as categorias da org. Primeiro acesso (nenhuma gf_categorias): semeia o padrão, se quem pede pode editar. */
export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const g = await entrar("ver", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  return protegido(requestId, async () => {
    const contar = async () => {
      const { count, error } = await g.supabase.from("gf_categorias").select("account_plan_id", { count: "exact", head: true }).eq("organization_id", g.orgId);
      if (error) throw error;
      return count ?? 0;
    };
    if ((await contar()) === 0 && (await exigirAcesso(g.supabase, g.orgId, "editar"))) {
      const { error } = await g.supabase.rpc("fn_gf_semear_categorias", { p_org: g.orgId });
      if (error) throw error;
    }
    const { data, error } = await g.supabase
      .from("gf_categorias")
      .select("account_plan_id, grupo, conta_cac, account_plans!inner(name, direction, is_active)")
      .eq("organization_id", g.orgId)
      .eq("account_plans.is_active", true)
      .limit(1000);
    if (error) throw error;
    type Linha = { account_plan_id: string; grupo: string; conta_cac: boolean; account_plans: { name: string; direction: string } | Array<{ name: string; direction: string }> };
    const lista = ((data ?? []) as unknown as Linha[]).map((c) => {
      const p = Array.isArray(c.account_plans) ? c.account_plans[0]! : c.account_plans;
      return { id: c.account_plan_id, nome: p.name, direction: p.direction, grupo: c.grupo, conta_cac: c.conta_cac };
    });
    return ok(lista.sort((a, b) => a.nome.localeCompare(b.nome)), { requestId });
  });
}

/** Sem `id` cria; com `id` altera nome/grupo (a direção não muda). */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const g = await entrar("editar", "gestao_financeira", requestId);
  if (!g.ok) return g.response;
  const lido = categoriaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const c = lido.data;
  const { data, error } = await g.supabase.rpc("fn_gf_categoria_salvar", {
    p_org: g.orgId, p_id: c.id ?? null, p_nome: c.nome, p_direction: c.direction, p_grupo: c.grupo, p_conta_cac: c.conta_cac ?? false,
  });
  if (error) return respostaDeErro(error, requestId);
  return ok({ id: data }, { requestId, status: c.id ? 200 : 201 });
}
