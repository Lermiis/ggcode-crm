import { z } from "zod";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD");
const centavos = z.number().int().min(1).max(10_000_000_00);

export const formaSchema = z
  .object({
    tipo: z.enum(["implantacao", "mensalidade", "evento", "avulso"]),
    valor_cents: centavos,
    parcelas: z.number().int().min(1).max(60).optional(),
    primeiro_vencimento: data.optional(),
    dia_vencimento: z.number().int().min(1).max(31).optional(),
    descricao: z.string().trim().max(120).optional(),
  })
  .refine((f) => f.tipo !== "mensalidade" || f.dia_vencimento != null, { message: "Mensalidade precisa do dia de vencimento." })
  .refine((f) => !["implantacao", "avulso"].includes(f.tipo) || f.primeiro_vencimento != null, { message: "Informe o vencimento." });

export const criarContratoSchema = z
  .object({
    lead_id: z.string().uuid(),
    titulo: z.string().trim().min(1).max(120),
    inicio: data,
    fim: data.nullish(),
    formas: z.array(formaSchema).min(1, "Adicione ao menos uma forma de cobrança.").max(10),
  })
  .refine((c) => !c.fim || c.fim >= c.inicio, { message: "O fim não pode ser antes do início." });
export type CriarContrato = z.infer<typeof criarContratoSchema>;

export const lancarEventoSchema = z.object({
  forma_id: z.string().uuid(),
  data,
  titulo: z.string().trim().min(1).max(120),
  valor_cents: centavos.optional(),
});

export const receberSchema = z.object({ account_id: z.string().uuid(), recebida_em: data.optional() });
export const alterarContratoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.enum(["encerrar", "cancelar"]), cancelar_futuras: z.boolean().default(true) }),
  z
    .object({ acao: z.literal("editar"), titulo: z.string().trim().min(1).max(120), inicio: data, fim: data.nullish() })
    .refine((c) => !c.fim || c.fim >= c.inicio, { message: "O fim não pode ser antes do início." }),
]);
export const editarFormaSchema = z.object({
  valor_cents: centavos.optional(),
  dia_vencimento: z.number().int().min(1).max(31).optional(),
  descricao: z.string().trim().min(1).max(120).optional(),
  vencimento: data.optional(),
  aplicar_futuras: z.boolean().default(false),
});
export const refazerParcelamentoSchema = z.object({ parcelas: z.number().int().min(1).max(60), primeiro_vencimento: data });
export const filtroSchema = z.enum(["atrasadas", "mes", "proximas", "recebidas"]).catch("mes");
