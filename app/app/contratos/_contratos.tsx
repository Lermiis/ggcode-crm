"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { Cobranca, Contrato, Forma } from "@/lib/contratos/tipos";
import { formatCents } from "@/lib/money";

import { ListaDeCobrancas } from "./_cobrancas";
import { EditarContrato } from "./_editar";
import { LancarEvento } from "./_evento";

function Erro({ onTentar }: { onTentar: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 text-sm text-danger">
      {t("Não foi possível carregar.")}
      <Button size="sm" variant="outline" onClick={onTentar}>{t("Tentar de novo")}</Button>
    </div>
  );
}

const SIT: Record<Contrato["situacao"], string> = { ativo: "Ativo", encerrado: "Encerrado", cancelado: "Cancelado" };
const dataBR = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export function ListaDeContratos({ podeGerenciar }: { podeGerenciar: boolean }) {
  const t = useT();
  const [aberto, setAberto] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ["contratos", "lista"],
    queryFn: async () => (await apiClient.get<{ data: Contrato[] }>("/api/v1/contratos")).data,
  });
  if (lista.isError) return <Erro onTentar={() => void lista.refetch()} />;
  if (lista.isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (!lista.data?.length) return <p className="text-sm text-text-muted">{t("Nenhum contrato ainda.")}</p>;
  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {lista.data.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-elevated" onClick={() => setAberto(c.id)}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.cliente}</div>
                <div className="truncate text-xs text-text-muted">{c.titulo} · {t(SIT[c.situacao])}</div>
              </div>
              <div className="text-right text-xs text-text-muted">{c.proximo_vencimento ? `${t("Próximo")} ${dataBR(c.proximo_vencimento)}` : ""}</div>
              <div className="w-32 text-right text-sm font-semibold tabular-nums">{c.mensal_cents ? `${formatCents(c.mensal_cents, "BRL")}/${t("mês")}` : "—"}</div>
            </button>
          </li>
        ))}
      </ul>
      {aberto ? <Ficha id={aberto} podeGerenciar={podeGerenciar} onFechar={() => setAberto(null)} /> : null}
    </>
  );
}

const ROTULO_FORMA: Record<Forma["tipo"], string> = { implantacao: "Implantação", mensalidade: "Mensalidade", evento: "Por evento", avulso: "Avulso" };
function resumoForma(f: Forma, t: (s: string) => string): string {
  const v = formatCents(f.valor_cents, "BRL");
  if (f.tipo === "implantacao") return `${v}${(f.parcelas ?? 1) > 1 ? ` · ${f.parcelas}x` : ""}`;
  if (f.tipo === "mensalidade") return `${v} · ${t("dia")} ${f.dia_vencimento}`;
  if (f.tipo === "evento") return `${v} ${t("por evento")}`;
  return `${v} · ${f.descricao ?? ""}`;
}

function Ficha({ id, podeGerenciar, onFechar }: { id: string; podeGerenciar: boolean; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [evento, setEvento] = useState<Forma | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [editando, setEditando] = useState(false);
  const ficha = useQuery({
    queryKey: ["contratos", "ficha", id],
    queryFn: async () => (await apiClient.get<{ data: { contrato: Contrato & { contact_id: string | null }; formas: Forma[]; cobrancas: Cobranca[] } }>(`/api/v1/contratos/${id}`)).data,
  });
  const encerrar = useMutation({
    mutationFn: (acao: "encerrar" | "cancelar") => apiClient.patch(`/api/v1/contratos/${id}`, { acao, cancelar_futuras: true }),
    onSuccess: () => { setConfirmando(false); void qc.invalidateQueries({ queryKey: ["contratos"] }); },
    onError: showApiError,
  });
  const d = ficha.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{d ? `${d.contrato.cliente} · ${d.contrato.titulo}` : t("Contrato")}</DialogTitle></DialogHeader>
        {d ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
              <span>{dataBR(d.contrato.inicio)} → {dataBR(d.contrato.fim)}</span>
              <span>{t(SIT[d.contrato.situacao])}</span>
              <a className="underline" href={`/app/leads/${d.contrato.lead_id}`}>{t("Abrir negócio")}</a>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {d.formas.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div><div className="text-xs text-text-muted">{t(ROTULO_FORMA[f.tipo])}</div><div className="text-sm font-medium">{resumoForma(f, t)}</div></div>
                  {podeGerenciar && f.tipo === "evento" && d.contrato.situacao === "ativo" ? (
                    <Button size="sm" variant="outline" onClick={() => setEvento(f)}>{t("Lançar evento")}</Button>
                  ) : null}
                </div>
              ))}
            </div>
            <ListaDeCobrancas filtro="mes" onFiltro={() => {}} carregando={false} cobrancas={d.cobrancas} podeGerenciar={podeGerenciar} semFiltros />
            {podeGerenciar && d.contrato.situacao === "ativo" ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditando(true)}>{t("Editar")}</Button>
                <Button variant="outline" onClick={() => setConfirmando(true)}>{t("Encerrar contrato")}</Button>
              </div>
            ) : null}
          </div>
        ) : ficha.isError ? <Erro onTentar={() => void ficha.refetch()} /> : <p className="text-sm text-text-muted">{t("Carregando…")}</p>}
        {confirmando ? (
          <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("Encerrar contrato?")}</DialogTitle></DialogHeader>
              <p className="text-sm">{t("As cobranças futuras a receber serão canceladas.")}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmando(false)}>{t("Voltar")}</Button>
                <Button variant="outline" disabled={encerrar.isPending} onClick={() => encerrar.mutate("cancelar")}>{t("Cancelar contrato")}</Button>
                <Button disabled={encerrar.isPending} onClick={() => encerrar.mutate("encerrar")}>{t("Encerrar")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
        {editando && d ? <EditarContrato contrato={d.contrato} formas={d.formas} cobrancas={d.cobrancas} onFechar={() => setEditando(false)} /> : null}
        {evento ? <LancarEvento contratoId={id} forma={evento} onFechar={() => setEvento(null)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
