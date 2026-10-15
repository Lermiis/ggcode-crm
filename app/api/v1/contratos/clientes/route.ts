/** Negócios fechados da organização, para o seletor do Novo contrato. Contato só para exibir. */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { entrar, respostaDeErro } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const ent = await entrar("editar", "contratos", requestId);
  if (!ent.ok) return ent.response;
  const { supabase, orgId } = ent;
  const { data, error } = await supabase.from("crm_leads").select("id, title, contacts(name, display_name)")
    .eq("organization_id", orgId).eq("status", "won").order("closed_at", { ascending: false }).limit(300);
  if (error) return respostaDeErro(error, requestId);
  return ok((data ?? []).map((l) => {
    const c = l.contacts as { name?: string | null; display_name?: string | null } | null;
    return { id: l.id, title: l.title, contact_name: nomeDoContato(c) };
  }), { requestId });
}
