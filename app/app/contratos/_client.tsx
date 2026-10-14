"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { Cobranca } from "@/lib/contratos/tipos";
import { formatCents } from "@/lib/money";

import { ListaDeCobrancas } from "./_cobrancas";
import { ListaDeContratos } from "./_contratos";
import { NovoContrato } from "./_novo";

export type Filtro = "atrasadas" | "mes" | "proximas" | "recebidas";
type Resposta = { cobrancas: Cobranca[]; totais: { aReceber: number; recebido: number; atrasado: number; qtdAtrasadas: number } };

export function Contratos({ podeGerenciar }: { podeGerenciar: boolean }) {
  const t = useT();
  const [aba, setAba] = useState<"cobrancas" | "contratos">("cobrancas");
  const [filtro, setFiltro] = useState<Filtro>("mes");
  const [novo, setNovo] = useState(false);

  const cobrancas = useQuery({
    queryKey: ["contratos", "cobrancas", filtro],
    queryFn: async () => (await apiClient.get<{ data: Resposta }>(`/api/v1/contratos/cobrancas?filtro=${filtro}`)).data,
    retry: false,
  });

  if (cobrancas.error instanceof ApiError && cobrancas.error.code === "module_not_installed") {
    return <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">{cobrancas.error.message}</p>;
  }
  const tt = cobrancas.data?.totais;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("Contratos")}</h1>
        {podeGerenciar ? <Button onClick={() => setNovo(true)}>{t("Novo contrato")}</Button> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Numero rotulo={t("A receber no mês")} valor={tt?.aReceber} />
        <Numero rotulo={t("Recebido no mês")} valor={tt?.recebido} />
        <Numero rotulo={t("Atrasado")} valor={tt?.atrasado} extra={tt?.qtdAtrasadas ? `${tt.qtdAtrasadas}` : undefined} perigo={!!tt?.atrasado}
          onClick={() => { setAba("cobrancas"); setFiltro("atrasadas"); }} />
      </div>

      <div className="flex gap-1 border-b border-border" role="tablist">
        {(["cobrancas", "contratos"] as const).map((a) => (
          <button key={a} role="tab" aria-selected={aba === a} onClick={() => setAba(a)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === a ? "border-primary text-text" : "border-transparent text-text-muted"}`}>
            {a === "cobrancas" ? t("Cobranças") : t("Contratos")}
          </button>
        ))}
      </div>

      {aba === "cobrancas" ? (
        <ListaDeCobrancas filtro={filtro} onFiltro={setFiltro} carregando={cobrancas.isLoading}
          cobrancas={cobrancas.data?.cobrancas ?? []} podeGerenciar={podeGerenciar} />
      ) : (
        <ListaDeContratos podeGerenciar={podeGerenciar} />
      )}

      {novo ? <NovoContrato onFechar={() => setNovo(false)} /> : null}
    </div>
  );
}

function Numero({ rotulo, valor, extra, perigo, onClick }: { rotulo: string; valor?: number; extra?: string; perigo?: boolean; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="rounded-lg border border-border p-4 text-left">
      <div className="text-xs font-medium text-text-muted">{rotulo}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${perigo ? "text-danger" : ""}`}>
        {valor == null ? "—" : formatCents(valor, "BRL")}
        {extra ? <span className="ml-2 text-sm font-normal">({extra})</span> : null}
      </div>
    </Tag>
  );
}
