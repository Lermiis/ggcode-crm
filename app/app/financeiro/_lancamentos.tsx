"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

import { Carga, SeletorMes, brl, dataBR, mesDeHoje, selectCls, useGf } from "./_comum";
import type { Categoria } from "./_dre";
import { Recorrencias } from "./_recorrencias";
import { LancamentoForm, type Conta, type Edicao } from "./_lancamento-form";

type Item = {
  id: string; direction: "in" | "out"; amount_cents: number; entry_date: string; status: "pending" | "paid"; paid_date: string | null;
  description: string | null; categoria: { id: string; nome: string } | null; conta: { id: string; nome: string };
  parcela: { numero: number; total: number } | null; recorrente: boolean; cobranca_contrato: boolean;
};
const BASE = "/api/v1/gestao-financeira";

export function AbaLancamentos({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const [mes, setMes] = useState(mesDeHoje());
  const [tipo, setTipo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [situacao, setSituacao] = useState("");
  const [novo, setNovo] = useState<"in" | "out" | null>(null);
  const [edicao, setEdicao] = useState<Item | null>(null);
  const [pagando, setPagando] = useState<Item | null>(null);
  const [excluindo, setExcluindo] = useState<Item | null>(null);
  const [recorr, setRecorr] = useState(false);

  const qs = new URLSearchParams({ mes, ...(tipo && { direction: tipo }), ...(categoria && { account_plan_id: categoria }), ...(situacao && { status: situacao }) });
  const q = useGf<{ data: Item[]; meta?: { truncado?: boolean } }>(["lancamentos", qs.toString()], `${BASE}/lancamentos?${qs}`, true);
  const cats = useGf<Categoria[]>(["categorias"], `${BASE}/categorias`);
  const contas = useGf<Conta[]>(["contas"], `${BASE}/contas`);
  const prontoParaForm = !!cats.data && !!contas.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeletorMes mes={mes} onChange={setMes} />
        <select className={selectCls} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label={t("Tipo")}>
          <option value="">{t("Entradas e saídas")}</option><option value="in">{t("Entradas")}</option><option value="out">{t("Saídas")}</option>
        </select>
        <select className={selectCls} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label={t("Categoria")}>
          <option value="">{t("Todas as categorias")}</option>
          {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className={selectCls} value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label={t("Situação")}>
          <option value="">{t("Qualquer situação")}</option><option value="pending">{t("Pendente")}</option><option value="paid">{t("Quitado")}</option>
        </select>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={!prontoParaForm} onClick={() => setRecorr(true)}>{t("Recorrências")}</Button>
        {podeEditar ? (
          <div className="flex gap-2">
            <Button disabled={!prontoParaForm} onClick={() => setNovo("in")}>{t("+ Entrada")}</Button>
            <Button disabled={!prontoParaForm} variant="outline" onClick={() => setNovo("out")}>{t("+ Saída")}</Button>
          </div>
        ) : null}
      </div>

      <Carga q={q}>
        {({ data: lista, meta }) => lista.length === 0 ? <p className="text-sm text-text-muted">{t("Nada aqui.")}</p> : (
          <>
          {meta?.truncado ? <p className="text-xs text-text-muted">{t("Mostrando os 500 mais recentes. Use os filtros.")}</p> : null}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lista.map((l) => {
              const atrasado = l.status === "pending" && l.entry_date < new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <span className={`w-20 text-xs tabular-nums ${atrasado ? "text-error" : "text-text-muted"}`}>{dataBR(l.entry_date)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {l.description || "—"}
                      {l.parcela ? <span className="ml-2 rounded-md bg-surface px-1.5 py-0.5 text-xs font-normal">{l.parcela.numero}/{l.parcela.total}</span> : null}
                      {l.recorrente ? <span className="ml-2 rounded-md bg-surface px-1.5 py-0.5 text-xs font-normal">{t("mensal")}</span> : null}
                    </div>
                    <div className="truncate text-xs text-text-muted">{l.categoria?.nome ?? "—"} · {l.conta.nome}</div>
                  </div>
                  <span className={`w-28 text-right text-sm font-semibold tabular-nums ${l.direction === "out" ? "text-error" : ""}`}>
                    {l.direction === "out" ? "−" : ""}{brl(l.amount_cents)}
                  </span>
                  <span className={`w-20 text-xs ${atrasado ? "text-error" : "text-text-muted"}`}>
                    {l.status === "paid" ? t("Quitado") : atrasado ? t("Atrasado") : t("Pendente")}
                  </span>
                  {podeEditar ? (
                    <span className="flex gap-1">
                      {l.status === "pending" ? (
                        <>
                          <Button size="sm" aria-label={`${l.direction === "in" ? t("Receber") : t("Pagar")} ${l.description ?? ""}`} onClick={() => setPagando(l)}>{l.direction === "in" ? t("Receber") : t("Pagar")}</Button>
                          <Button size="sm" variant="ghost" aria-label={`${t("Editar")} ${l.description ?? ""}`} onClick={() => setEdicao(l)}>{t("Editar")}</Button>
                          {l.recorrente ? null : <Button size="sm" variant="ghost" aria-label={`${t("Excluir")} ${l.description ?? ""}`} onClick={() => setExcluindo(l)}>{t("Excluir")}</Button>}
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" aria-label={`${t("Corrigir")} ${l.description ?? ""}`} onClick={() => setEdicao(l)}>{t("Corrigir")}</Button>
                      )}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          </>
        )}
      </Carga>

      {novo && prontoParaForm ? <LancamentoForm direction={novo} categorias={cats.data!} contas={contas.data!} onFechar={() => setNovo(null)} /> : null}
      {edicao && prontoParaForm ? (
        <LancamentoForm direction={edicao.direction} categorias={cats.data!} contas={contas.data!} onFechar={() => setEdicao(null)}
          edicao={{ id: edicao.id, pago: edicao.status === "paid", amount_cents: edicao.amount_cents, recorrente: edicao.recorrente, entry_date: edicao.entry_date, description: edicao.description,
            categoriaId: edicao.categoria?.id ?? null, contaId: edicao.conta.id } satisfies Edicao} />
      ) : null}
      {recorr && prontoParaForm ? <Recorrencias podeEditar={podeEditar} categorias={cats.data!} contas={contas.data!} onFechar={() => setRecorr(false)} /> : null}
      {pagando ? <DialogPagar item={pagando} onFechar={() => setPagando(null)} /> : null}
      {excluindo ? <DialogExcluir item={excluindo} onFechar={() => setExcluindo(null)} /> : null}
    </div>
  );
}

function DialogPagar({ item, onFechar }: { item: Item; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [data, setData] = useState(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }));
  const pagar = useMutation({
    mutationFn: () => apiClient.post(`${BASE}/lancamentos/${item.id}/pagar`, { paid_date: data }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["financeiro"] }); onFechar(); },
    onError: showApiError,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item.direction === "in" ? t("Receber") : t("Pagar")}</DialogTitle></DialogHeader>
        <p className="text-sm">{item.description} · <b>{brl(item.amount_cents)}</b></p>
        <label className="flex flex-col gap-1 text-sm">{t("Data")}<Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button disabled={!data || pagar.isPending} onClick={() => pagar.mutate()}>{t("Confirmar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogExcluir({ item, onFechar }: { item: Item; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const excluir = useMutation({
    mutationFn: () => apiClient.delete(`${BASE}/lancamentos/${item.id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["financeiro"] }); onFechar(); },
    onError: showApiError,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Excluir lançamento?")}</DialogTitle></DialogHeader>
        <p className="text-sm">{item.description} · <b>{brl(item.amount_cents)}</b></p>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Voltar")}</Button>
          <Button variant="destructive" disabled={excluir.isPending} onClick={() => excluir.mutate()}>{t("Excluir")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
