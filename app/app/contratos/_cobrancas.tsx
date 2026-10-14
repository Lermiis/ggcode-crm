"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { hojeNoFuso, situacaoExibida } from "@/lib/contratos/regras";
import type { Cobranca } from "@/lib/contratos/tipos";
import { formatCents } from "@/lib/money";

import type { Filtro } from "./_client";

const dataBR = (d: string) => d.split("-").reverse().join("/");

export function ListaDeCobrancas({ filtro, onFiltro, cobrancas, carregando, podeGerenciar, semFiltros }: {
  filtro: Filtro; onFiltro: (f: Filtro) => void; cobrancas: Cobranca[]; carregando: boolean; podeGerenciar: boolean; semFiltros?: boolean;
}) {
  const t = useT();
  const [recebendo, setRecebendo] = useState<Cobranca | null>(null);
  const hoje = hojeNoFuso();
  const FILTROS: Array<[Filtro, string]> = [["atrasadas", t("Atrasadas")], ["mes", t("Este mês")], ["proximas", t("Próximas")], ["recebidas", t("Recebidas")]];
  return (
    <div className="flex flex-col gap-3">
      {semFiltros ? null : (
        <div className="flex flex-wrap gap-2">
          {FILTROS.map(([f, r]) => (
            <Button key={f} size="sm" variant={filtro === f ? "default" : "outline"} onClick={() => onFiltro(f)}>{r}</Button>
          ))}
        </div>
      )}
      {carregando ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : cobrancas.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nada aqui.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {cobrancas.map((c) => {
            const s = situacaoExibida(c, hoje);
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.cliente}</div>
                  <div className="truncate text-xs text-text-muted">{c.descricao} · {c.contrato_titulo}</div>
                </div>
                <div className={`text-right text-xs ${s === "atrasada" ? "text-danger" : "text-text-muted"}`}>
                  {s === "recebida" && c.recebida_em ? `${t("Recebida")} ${dataBR(c.recebida_em)}` : `${s === "atrasada" ? t("Venceu") : t("Vence")} ${dataBR(c.vencimento)}`}
                </div>
                <div className="w-28 text-right text-sm font-semibold tabular-nums">{formatCents(c.valor_cents, "BRL")}</div>
                {podeGerenciar && c.situacao === "a_receber" ? (
                  <Button size="sm" onClick={() => setRecebendo(c)}>{t("Recebido")}</Button>
                ) : <span className="w-[84px]" />}
              </li>
            );
          })}
        </ul>
      )}
      {recebendo ? <DialogReceber cobranca={recebendo} onFechar={() => setRecebendo(null)} /> : null}
    </div>
  );
}

type Conta = { id: string; name: string };
const CHAVE_CONTA = "contratos:ultima-conta";

function DialogReceber({ cobranca, onFechar }: { cobranca: Cobranca; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const contas = useQuery({
    queryKey: ["financeiro", "contas"],
    queryFn: async () => (await apiClient.get<{ data: Conta[] }>("/api/v1/financeiro/catalogo/contas")).data,
  });
  const inicial = (() => { try { return localStorage.getItem(CHAVE_CONTA) ?? ""; } catch { return ""; } })();
  const [conta, setConta] = useState(inicial);
  const [data, setData] = useState(hojeNoFuso());
  const contaEscolhida = conta || contas.data?.[0]?.id || "";

  const receber = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/contratos/cobrancas/${cobranca.id}/receber`, { account_id: contaEscolhida, recebida_em: data }),
    onSuccess: () => {
      try { localStorage.setItem(CHAVE_CONTA, contaEscolhida); } catch { /* sem storage, segue */ }
      void qc.invalidateQueries({ queryKey: ["contratos"] });
      onFechar();
    },
    onError: showApiError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Registrar recebimento")}</DialogTitle></DialogHeader>
        <p className="text-sm">{cobranca.cliente} · {cobranca.descricao} · <b>{formatCents(cobranca.valor_cents, "BRL")}</b></p>
        <label className="flex flex-col gap-1 text-sm">{t("Entrou na conta")}
          <select className="rounded-md border border-border bg-transparent px-2 py-2" value={contaEscolhida} onChange={(e) => setConta(e.target.value)}>
            {(contas.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {contas.data && contas.data.length === 0 ? (
          <p className="text-sm text-danger">{t("Cadastre uma conta em Configurações › Financeiro.")}</p>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">{t("Data")}
          <input type="date" className="rounded-md border border-border bg-transparent px-2 py-2" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button disabled={!contaEscolhida || receber.isPending} onClick={() => receber.mutate()}>{t("Confirmar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
