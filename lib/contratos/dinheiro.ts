/** Texto digitado em reais -> centavos. Com vírgula: pontos são milhar. Sem vírgula: um ponto + 1-2 dígitos no fim é decimal. */
export function reaisParaCentavos(texto: string): number | null {
  let s = texto.replace(/R\$|\s/g, "");
  if (!/^[\d.,]+$/.test(s)) return null;
  if (s.includes(",")) {
    if (s.indexOf(",") !== s.lastIndexOf(",")) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (!/^\d+\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  return Number.isSafeInteger(c) && c > 0 ? c : null;
}

export function centavosParaTexto(c: number): string {
  return (c / 100).toFixed(2).replace(".", ",");
}
