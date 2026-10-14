/**
 * Mensalidades dos contratos (GG Code, migration 9001). Diária.
 * Para cada forma `mensalidade` ativa de contrato ativo: garante a cobrança do mês corrente e
 * do seguinte. Idempotência é do índice único (forma_id, competencia): 23505 = já existia.
 * Nasce A RECEBER, nunca recebida — quem marca é uma pessoa.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { moduloAusente } from "@/lib/contratos/modulo";
import { ok, fail } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { hojeNoFuso, mensalidadesDevidas } from "@/lib/contratos/regras";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  const db = createAdminClient();
  const hoje = hojeNoFuso();

  const { data, error } = await db.from("contrato_formas")
    .select("id, organization_id, contrato_id, valor_cents, dia_vencimento, contratos!inner(inicio, fim, situacao)")
    .eq("tipo", "mensalidade").eq("ativa", true).eq("contratos.situacao", "ativo");
  if (error) {
    if (moduloAusente(error)) return ok({ geradas: 0, modulo: "nao_instalado" }, { requestId });
    logger.error("contratos-mensalidades: leitura falhou", { requestId, error: error.message });
    return fail("internal_error", error.message, 500, { requestId });
  }

  let geradas = 0;
  for (const f of data ?? []) {
    const k = f.contratos as unknown as { inicio: string; fim: string | null };
    for (const c of mensalidadesDevidas({ dia_vencimento: f.dia_vencimento!, valor_cents: f.valor_cents }, k, hoje)) {
      const { error: e } = await db.from("contrato_cobrancas").insert({
        ...c, organization_id: f.organization_id, contrato_id: f.contrato_id, forma_id: f.id,
      });
      if (!e) geradas++;
      else if (e.code !== "23505") logger.warn("contratos-mensalidades: insert falhou", { requestId, forma: f.id, error: e.message });
    }
  }
  return ok({ geradas }, { requestId });
}

export const GET = handle;
export const POST = handle;
