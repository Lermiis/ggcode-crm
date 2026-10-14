"use client";
import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";

import { AbaAcesso } from "./_acesso";
import { AbaDre } from "./_dre";
import { AbaFluxo } from "./_fluxo";
import { AbaLancamentos } from "./_lancamentos";
import { AbaMetricas } from "./_metricas";
import { AbaVisao } from "./_visao";

type Aba = "visao" | "lancamentos" | "fluxo" | "dre" | "metricas" | "acesso";

export function Financeiro({ podeVer, podeEditar, ehAdmin }: { podeVer: boolean; podeEditar: boolean; ehAdmin: boolean }) {
  const t = useT();
  const [aba, setAba] = useState<Aba>("visao");
  if (!podeVer) {
    return <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">{t("Você não tem acesso ao Financeiro. Peça a um administrador.")}</p>;
  }
  const abas: Array<[Aba, string]> = [
    ["visao", t("Visão geral")], ["lancamentos", t("Lançamentos")], ["fluxo", t("Fluxo de caixa")], ["dre", t("DRE")], ["metricas", t("Métricas")],
    ...(ehAdmin ? ([["acesso", t("Acesso")]] as Array<[Aba, string]>) : []),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <h1 className="text-xl font-semibold">{t("Financeiro")}</h1>
      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {abas.map(([a, r]) => (
          <button key={a} role="tab" aria-selected={aba === a} onClick={() => setAba(a)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${aba === a ? "border-primary text-text" : "border-transparent text-text-muted"}`}>
            {r}
          </button>
        ))}
      </div>
      {aba === "visao" ? <AbaVisao /> : null}
      {aba === "lancamentos" ? <AbaLancamentos podeEditar={podeEditar} /> : null}
      {aba === "fluxo" ? <AbaFluxo /> : null}
      {aba === "dre" ? <AbaDre podeEditar={podeEditar} /> : null}
      {aba === "metricas" ? <AbaMetricas /> : null}
      {aba === "acesso" ? <AbaAcesso /> : null}
    </div>
  );
}
