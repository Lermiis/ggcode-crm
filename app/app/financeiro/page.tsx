import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

import { Financeiro } from "./_client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const supabase = await createClient();
  const pode = async (nivel: "ver" | "editar") => {
    const { data, error } = await supabase.rpc("fn_gf_pode", { p_org: org.orgId, p_nivel: nivel });
    // Erro da RPC (ex.: módulo ausente) não é "sem acesso": a tela mostra o aviso do módulo e a API recusa escrita.
    return error ? { erro: true, ok: nivel === "ver" } : { erro: false, ok: data === true };
  };
  const [ver, editar] = await Promise.all([pode("ver"), pode("editar")]);
  return <Financeiro podeVer={ver.ok} podeEditar={!editar.erro && editar.ok} ehAdmin={org.role === "admin"} />;
}
