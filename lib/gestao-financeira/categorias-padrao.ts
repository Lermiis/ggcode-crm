import type { Grupo } from "./tipos";

type Cat = { nome: string; direction: "in" | "out"; grupo: Grupo; conta_cac: boolean };
const c = (grupo: Grupo, nomes: string[], conta_cac = false): Cat[] =>
  nomes.map((nome) => ({ nome, direction: grupo === "receita" ? "in" : "out", grupo, conta_cac }));

export const CATEGORIAS_PADRAO: ReadonlyArray<Cat> = [
  ...c("receita", ["Serviços", "Mensalidades", "Vendas", "Outras receitas"]),
  ...c("imposto", ["Impostos sobre vendas"]),
  ...c("custo_variavel", ["Custos variáveis", "Taxas de pagamento"]),
  ...c("pessoal", ["Salários", "Pró-labore", "Freelancers"]),
  ...c("assinaturas", ["Assinaturas e ferramentas"]),
  ...c("marketing", ["Meta Ads", "Google Ads", "TikTok Ads", "LinkedIn Ads", "Outros anúncios", "Comissões de venda"], true),
  ...c("estrutura", ["Aluguel", "Contas (luz, água, internet)", "Contabilidade"]),
  ...c("outras_despesas", ["Outras despesas"]),
];
