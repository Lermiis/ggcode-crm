import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { respostaDeErro } from "../../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contrato_cobrancas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("contrato_cobrancas")
    .update({ situacao: "cancelada", updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", authz.org.orgId).eq("situacao", "a_receber").select("id, situacao").maybeSingle();
  if (error) return respostaDeErro(error, requestId);
  if (!data) return fail("conflict", "Só dá para cancelar cobrança a receber.", 409, { requestId });
  await audit({ action: "contratos.cobranca_cancelada", resourceType: "contrato_cobranca", resourceId: id, requestId });
  return ok(data, { requestId });
}
