"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { centavosParaTexto, reaisParaCentavos } from "@/lib/contratos/dinheiro";

import type { Categoria } from "./_dre";
import { selectCls } from "./_comum";

export type Conta = { id: string; nome: string; saldo_cents: number };
export type Edicao = { id: string; pago: boolean; amount_cents: number; entry_date: string; description: string | null; categoriaId: string | null; contaId: string };
type Forma = "uma_vez" | "parcelado" | "mensal";
const BASE = "/api/v1/gestao-financeira";

export function LancamentoForm({ direction, edicao, categorias, contas, onFechar }: {
  direction: "in" | "out"; edicao?: Edicao; categorias: Categoria[]; contas: Conta[]; onFechar: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [valor, setValor] = useState(edicao ? centavosParaTexto(edicao.amount_cents) : "");
  const [data, setData] = useState(edicao?.entry_date ?? hoje);
  const [categoria, setCategoria] = useState(edicao?.categoriaId ?? "");
  const [conta, setConta] = useState(edicao?.contaId ?? contas[0]?.id ?? "");
  const [descricao, setDescricao] = useState(edicao?.description ?? "");
  const [forma, setForma] = useState<Forma>("uma_vez");
  const [parcelas, setParcelas] = useState("2");
  const [fim, setFim] = useState("");
  const [pago, setPago] = useState(false);
  const [dataPago, setDataPago] = useState(hoje);

  const lista = categorias.filter((c) => c.direction === direction);
  const centavos = reaisParaCentavos(valor);
  const n = Number(parcelas);
  const valido = centavos !== null && !!conta && !!descricao.trim() && (forma !== "parcelado" || (Number.isInteger(n) && n >= 2 && n <= 60));

  const salvar = useMutation({
    mutationFn: () => {
      const comum = { account_id: conta, account_plan_id: categoria || null, description: descricao.trim() };
      if (edicao) {
        const corpo = { ...comum, amount_cents: centavos, entry_date: data };
        return edicao.pago ? apiClient.post(`${BASE}/lancamentos/${edicao.id}/corrigir`, corpo) : apiClient.patch(`${BASE}/lancamentos/${edicao.id}`, corpo);
      }
      if (forma === "parcelado") return apiClient.post(`${BASE}/lancamentos`, { ...comum, direction, total_cents: centavos, parcelas: n, primeiro: data });
      if (forma === "mensal") return apiClient.post(`${BASE}/recorrencias`, { ...comum, direction, amount_cents: centavos, day_of_month: Number(data.slice(8, 10)), fim: fim || null });
      return apiClient.post(`${BASE}/lancamentos`, { ...comum, direction, amount_cents: centavos, entry_date: data, ...(pago ? { pago: true, paid_date: dataPago } : {}) });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["financeiro"] }); onFechar(); },
    onError: showApiError,
  });

  const titulo = edicao ? (edicao.pago ? t("Corrigir lançamento") : t("Editar lançamento")) : direction === "in" ? t("Nova entrada") : t("Nova saída");
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titulo}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">{forma === "parcelado" ? t("Valor total (R$)") : t("Valor (R$)")}
            <Input inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">{forma === "uma_vez" || edicao ? t("Data") : t("Primeira data")}
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">{t("Descrição")}
          <Input value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">{t("Categoria")}
            <select className={selectCls} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">—</option>
              {lista.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">{t("Conta")}
            <select className={selectCls} value={conta} onChange={(e) => setConta(e.target.value)}>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
        </div>
        {contas.length === 0 ? <p className="text-sm text-danger">{t("Cadastre uma conta em Configurações › Financeiro.")}</p> : null}
        {edicao ? null : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <select className={selectCls} value={forma} onChange={(e) => setForma(e.target.value as Forma)} aria-label={t("Forma")}>
                <option value="uma_vez">{t("Uma vez")}</option>
                <option value="parcelado">{t("Parcelado")}</option>
                <option value="mensal">{t("Todo mês")}</option>
              </select>
              {forma === "parcelado" ? (
                <label className="flex items-center gap-2">{t("em")}
                  <Input className="w-16" inputMode="numeric" value={parcelas} onChange={(e) => setParcelas(e.target.value)} />x
                </label>
              ) : null}
              {forma === "mensal" ? (
                <label className="flex items-center gap-2">{t("até")}
                  <Input type="date" className="w-40" value={fim} onChange={(e) => setFim(e.target.value)} />
                </label>
              ) : null}
            </div>
            {forma === "uma_vez" ? (
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={pago} onChange={(e) => setPago(e.target.checked)} />{t("Já pago?")}</label>
                {pago ? <Input type="date" className="w-40" value={dataPago} onChange={(e) => setDataPago(e.target.value)} /> : null}
              </div>
            ) : null}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button disabled={!valido || salvar.isPending || (!edicao && forma === "mensal" && !data)} onClick={() => salvar.mutate()}>{t("Salvar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
