/**
 * Acesso por pessoa ao Financeiro. SÓ ADMIN (lê e escreve): `requireRole("admin")` e, em
 * seguida, fn_gf_pode('editar') que para admin é sempre verdadeiro; a RPC reconfere o papel.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { acessoSchema } from "@/lib/gestao-financeira/esquemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { protegido, respostaDeErro } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "gestao_financeira_acessos" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  return protegido(requestId, async () => {
    const [membros, acessos] = await Promise.all([
      supabase.from("user_organizations").select("user_id, role").eq("organization_id", authz.org.orgId).is("revoked_at", null).limit(1000),
      supabase.from("gf_acessos").select("user_id, nivel").eq("organization_id", authz.org.orgId).limit(1000),
    ]);
    if (membros.error) throw membros.error;
    if (acessos.error) throw acessos.error;
    const nivelDe = new Map((acessos.data ?? []).map((a) => [a.user_id as string, a.nivel as string]));
    const admin = isServiceRoleConfigured() ? createAdminClient() : null;
    const lista = await Promise.all(
      (membros.data ?? []).map(async (m) => {
        const u = admin ? (await admin.auth.admin.getUserById(m.user_id as string)).data?.user : null;
        const nome = (u?.user_metadata?.full_name as string | undefined) ?? null;
        return {
          user_id: m.user_id as string,
          nome: nome ?? "Sem nome",
          papel: m.role as string,
          nivel: m.role === "admin" ? "admin" : (nivelDe.get(m.user_id as string) ?? "nenhum"),
        };
      }),
    );
    return ok(lista, { requestId });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "gestao_financeira_acessos" });
  if (!authz.ok) return authz.response;
  const lido = acessoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_gf_acesso_definir", { p_org: authz.org.orgId, p_user: lido.data.user_id, p_nivel: lido.data.nivel });
  if (error) return respostaDeErro(error, requestId);
  await audit({ action: "financeiro.acesso_alterado", resourceType: "gf_acesso", resourceId: lido.data.user_id, requestId, metadata: { user_id: lido.data.user_id, nivel: lido.data.nivel } });
  return ok({ user_id: lido.data.user_id, nivel: lido.data.nivel }, { requestId });
}
