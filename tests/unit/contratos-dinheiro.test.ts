import { describe, expect, it } from "vitest";

import { centavosParaTexto, reaisParaCentavos } from "@/lib/contratos/dinheiro";

describe("reaisParaCentavos", () => {
  it.each([
    ["1.000,50", 100050], ["1000,50", 100050], ["1000.50", 100050], ["1000", 100000],
    ["R$ 1.000,50", 100050], ["1.000", 100000], ["1.500.000", 150000000], ["1500.5", 150050], ["0,99", 99],
  ])("%s", (t, c) => expect(reaisParaCentavos(t)).toBe(c));
  it.each(["abc", "", "0", "0,00", "-5", "1,2,3"])("invalido %s", (t) => expect(reaisParaCentavos(t)).toBeNull());
  it("texto", () => expect(centavosParaTexto(150050)).toBe("1500,50"));
});
