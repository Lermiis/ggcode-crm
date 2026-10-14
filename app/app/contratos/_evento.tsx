"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { hojeNoFuso } from "@/lib/contratos/regras";
import type { Forma } from "@/lib/contratos/tipos";

export function LancarEvento({ contratoId, forma, onFechar }: { contratoId: string; forma: Forma; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState(hojeNoFuso());
  const [valor, setValor] = useState((forma.valor_cents / 100).toFixed(2).replace(".", ","));
  const centavos = Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100);
  const lancar = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/contratos/${contratoId}/eventos`, { forma_id: forma.id, data, titulo, valor_cents: centavos }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["contratos"] }); onFechar(); },
    onError: showApiError,
  });
  const campo = "rounded-md border border-border bg-transparent px-2 py-2";
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Lançar evento")}</DialogTitle></DialogHeader>
        <label className="flex flex-col gap-1 text-sm">{t("Evento")}<input className={campo} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={t("Ex.: Espetáculo de fim de ano")} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">{t("Data")}<input type="date" className={campo} value={data} onChange={(e) => setData(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm">{t("Valor (R$)")}<input inputMode="decimal" className={campo} value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button disabled={!titulo.trim() || !(centavos > 0) || lancar.isPending} onClick={() => lancar.mutate()}>{t("Lançar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
