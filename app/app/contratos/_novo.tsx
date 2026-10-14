"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { hojeNoFuso } from "@/lib/contratos/regras";
import type { TipoForma } from "@/lib/contratos/tipos";

type Cliente = { id: string; title: string; contact_name: string | null };
type FormaRascunho = { tipo: TipoForma; valor: string; parcelas: string; venc: string; dia: string; descricao: string };
const vazia = (tipo: TipoForma): FormaRascunho => ({ tipo, valor: "", parcelas: "1", venc: hojeNoFuso(), dia: "10", descricao: "" });
const centavos = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);

export function NovoContrato({ onFechar }: { onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const clientes = useQuery({
    queryKey: ["contratos", "clientes"],
    queryFn: async () => (await apiClient.get<{ data: Cliente[] }>("/api/v1/contratos/clientes")).data,
  });
  const TIPOS: Array<[TipoForma, string]> = [["implantacao", t("Implantação")], ["mensalidade", t("Mensalidade")], ["evento", t("Por evento")], ["avulso", t("Avulso")]];
  const [lead, setLead] = useState("");
  const [titulo, setTitulo] = useState("");
  const [inicio, setInicio] = useState(hojeNoFuso());
  const [formas, setFormas] = useState<FormaRascunho[]>([vazia("implantacao")]);
  const mudar = (i: number, p: Partial<FormaRascunho>) => setFormas((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));

  const criar = useMutation({
    mutationFn: () => apiClient.post("/api/v1/contratos", {
      lead_id: lead, titulo, inicio,
      formas: formas.map((f) => ({
        tipo: f.tipo, valor_cents: centavos(f.valor),
        ...(f.tipo === "implantacao" ? { parcelas: Number(f.parcelas) || 1, primeiro_vencimento: f.venc } : {}),
        ...(f.tipo === "avulso" ? { primeiro_vencimento: f.venc, descricao: f.descricao } : {}),
        ...(f.tipo === "mensalidade" ? { dia_vencimento: Number(f.dia) } : {}),
      })),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["contratos"] }); onFechar(); },
    onError: showApiError,
  });

  const campo = "rounded-md border border-border bg-transparent px-2 py-2 text-sm";
  const valido = lead && titulo.trim() && formas.length > 0 && formas.every((f) => centavos(f.valor) > 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t("Novo contrato")}</DialogTitle></DialogHeader>
        <label className="flex flex-col gap-1 text-sm">{t("Cliente (negócio fechado)")}
          <select className={campo} value={lead} onChange={(e) => {
            setLead(e.target.value);
            const c = clientes.data?.find((x) => x.id === e.target.value);
            if (c && !titulo) setTitulo(c.title);
          }}>
            <option value="">{t("Escolha…")}</option>
            {(clientes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}{c.contact_name ? ` — ${c.contact_name}` : ""}</option>)}
          </select>
        </label>
        {clientes.data && clientes.data.length === 0 ? <p className="text-sm text-text-muted">{t("Nenhum negócio fechado. Marque o negócio como ganho no funil primeiro.")}</p> : null}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label className="flex flex-col gap-1 text-sm">{t("Nome do contrato")}<input className={campo} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm">{t("Início")}<input type="date" className={campo} value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        </div>

        <div className="flex flex-col gap-2">
          {formas.map((f, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 sm:grid-cols-4">
              <select className={campo} value={f.tipo} onChange={(e) => mudar(i, vazia(e.target.value as TipoForma))}>
                {TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
              <input className={campo} inputMode="decimal" placeholder={t("Valor R$")} value={f.valor} onChange={(e) => mudar(i, { valor: e.target.value })} />
              {f.tipo === "implantacao" ? (<>
                <input className={campo} inputMode="numeric" placeholder={t("Parcelas")} value={f.parcelas} onChange={(e) => mudar(i, { parcelas: e.target.value })} />
                <input type="date" className={campo} value={f.venc} onChange={(e) => mudar(i, { venc: e.target.value })} aria-label={t("1º vencimento")} />
              </>) : null}
              {f.tipo === "mensalidade" ? (
                <input className={campo} inputMode="numeric" placeholder={t("Dia do vencimento")} value={f.dia} onChange={(e) => mudar(i, { dia: e.target.value })} />
              ) : null}
              {f.tipo === "avulso" ? (<>
                <input type="date" className={campo} value={f.venc} onChange={(e) => mudar(i, { venc: e.target.value })} aria-label={t("Vencimento")} />
                <input className={campo} placeholder={t("Descrição")} value={f.descricao} onChange={(e) => mudar(i, { descricao: e.target.value })} />
              </>) : null}
              <Button variant="ghost" size="sm" className="col-span-full justify-self-end" onClick={() => setFormas((fs) => fs.filter((_, j) => j !== i))}>{t("Remover")}</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setFormas((fs) => [...fs, vazia("mensalidade")])}>{t("+ Forma de cobrança")}</Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button disabled={!valido || criar.isPending} onClick={() => criar.mutate()}>{t("Salvar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
