# Módulo Financeiro — especificação

Data: 14/10/2026 · Sistema de gestão GG Code (fork DeskcommCRM, `Lermiis/ggcode-crm`) · depende do módulo Contratos (v1.80.0-gg.1)

## 1. Objetivo

O sistema é um **sistema de gestão completo**, não só CRM. O Financeiro é um dos pilares, e vale para **todas as empresas** da instalação, configurável por cada uma. O dono abre uma área e sabe:
- se a empresa dá lucro;
- quanto entrou, quanto foi faturado e quanto custou;
- o que vem pela frente;
- quanto custa conquistar um cliente e quanto um cliente vale.

**Aprovado pelo Guilherme (conversa de 14/10):**
- Cinco abas: Visão geral, Lançamentos, Fluxo de caixa, DRE e Métricas. Mais a aba Acesso.
- Métricas no padrão de mercado: MRR, ticket médio, churn, CAC, LTV, LTV/CAC, payback, ROI da empresa, ROI de marketing e ponto de equilíbrio.
- O gasto com anúncios entra **à mão**, de qualquer plataforma (Meta, Google, TikTok, LinkedIn e outros).
- Permissões definidas **por cada empresa**, numa aba fácil. Administrador sempre tem acesso. Cada pessoa fica como Sem acesso, Só vê, ou Vê e edita. A regra vale também para Contratos.
- **Editar contrato**, incluindo refazer o parcelamento do que ainda não foi pago.
- Fica para a fase 2: importação automática de anúncios, orçamento e metas, OFX, centro de custo, nota fiscal.

**Sucesso:**
- A Visão geral responde "lucrei quanto este mês?" sem cálculo manual.
- Lançar uma assinatura recorrente leva menos de 30 segundos.
- As métricas aparecem com uma explicação de uma linha e uma referência ("acima de 3 é saudável"). Sem dados, aparece "—" com o que falta lançar, nunca zero.
- Quem não tem acesso não vê o Financeiro nem os Contratos, e as rotas recusam.

## 2. Base: o caixa que já existe

O Deskcomm já tem o **caixa núcleo**. O Financeiro **não cria um segundo caixa**: ele lê e escreve nessas tabelas.

| Tabela | O que é |
|---|---|
| `financial_accounts` | contas (banco, caixa), com saldo inicial |
| `account_plans` | categorias (`name`, `direction` in/out, `is_active`) |
| `financial_entries` | lançamentos: `direction`, `amount_cents`, `entry_date` (competência/vencimento), `status` pending/paid, `paid_at`, `account_plan_id`, `origin` |
| `recurring_entries` | moldes mensais (`day_of_month`, `is_active`). A rotina diária gera o lançamento pendente do mês |

Regra do núcleo: **lançamento pago é imutável** em valor, conta, direção e data (trigger `fn_lancamento_pago_e_imutavel`). A correção é por contra-lançamento (`reverses_entry_id`).

O "Recebido" dos Contratos já cria `financial_entries` (in, paid). As comandas também.

## 3. Dados novos (módulo `financeiro`, migration 9002, ADR-0002)

⚠️ O slug `financeiro` **já existe** no upstream: é o módulo de Comandas. O nosso módulo usa o slug **`gestao_financeira`**, com provisionadora `fn_gestao_financeira_provisionar()` e tabelas com prefixo `gf_`.

| Tabela | Campos | Para quê |
|---|---|---|
| `gf_categorias` | `account_plan_id` (PK, FK account_plans), `organization_id`, `grupo` (`receita`·`imposto`·`custo_variavel`·`pessoal`·`assinaturas`·`marketing`·`estrutura`·`outras_despesas`), `conta_cac` bool | onde a categoria entra na DRE e se conta para o CAC |
| `gf_recorrencias` | `recurring_entry_id` (PK, FK), `organization_id`, `fim` date null | "se repete até quando" (o núcleo não tem fim) |
| `gf_parcelamentos` | `id`, `organization_id`, `descricao`, `total_cents`, `parcelas` int | agrupa um parcelado |
| `gf_parcelas` | `entry_id` (PK, FK financial_entries), `parcelamento_id`, `numero` | "3/6" |
| `gf_acessos` | `organization_id`, `user_id`, `nivel` (`ver`·`editar`), PK (org, user) | permissão por pessoa |

- Nenhuma coluna casa com a régua de PII. Nenhuma FK para `contacts`.
- **Função `fn_gf_pode(p_org uuid, p_nivel text) returns boolean`** (security definer, stable): verdadeiro se o usuário é `admin` da org (`fn_role_at_least(org,'admin')`) ou tem linha em `gf_acessos` com nível suficiente (`editar` ⊇ `ver`).
- **RLS das tabelas `gf_*`:**
  - leitura exige `fn_gf_pode(org,'ver')`;
  - escrita exige `fn_gf_pode(org,'editar')`;
  - `gf_acessos` é lido e escrito só por admin.
- **Contratos** (migration 9002 altera as policies da 9001): leitura passa a exigir `fn_gf_pode(org,'ver')` e escrita `fn_gf_pode(org,'editar')`. A RPC de recebimento passa a checar `fn_gf_pode(org,'editar')`.
- **Comportamento padrão:** sem nenhuma linha em `gf_acessos`, só administradores acessam. A GG Code fica exatamente assim: Guilherme e Gabriel como admins.
- **Limite declarado:** as tabelas do **núcleo** (`financial_*`, `account_plans`, `recurring_entries`) mantêm a RLS do Deskcomm, porque as Comandas dependem dela para atendentes. As **telas e rotas** do Financeiro aplicam `fn_gf_pode`. Fechar o acesso direto via API ao núcleo fica na fase 2.

**Categorias padrão.** Criadas por organização na primeira abertura do Financeiro (idempotente), em `account_plans` + `gf_categorias`:
- **Receita:** Serviços, Mensalidades, Vendas, Outras receitas.
- **Imposto:** Impostos sobre vendas.
- **Custo variável:** Custos variáveis, Taxas de pagamento.
- **Pessoal:** Salários, Pró-labore, Freelancers.
- **Assinaturas:** Assinaturas e ferramentas.
- **Marketing**, todas com `conta_cac` = true: Meta Ads, Google Ads, TikTok Ads, LinkedIn Ads, Outros anúncios, Comissões de venda.
- **Estrutura:** Aluguel, Contas (luz, água, internet), Contabilidade.
- **Outras despesas.**

Categorias do núcleo sem linha em `gf_categorias` entram como `receita` (direction in) ou `outras_despesas` (out).

## 4. Regras de cálculo

Datas civis em `America/Sao_Paulo`. Dinheiro em centavos.

**Visão geral (mês M):**
| Número | Regra |
|---|---|
| Faturado | entradas com `entry_date` em M (pagas + pendentes) + cobranças de contratos com vencimento em M (exceto canceladas). Cobrança já recebida não conta duas vezes: o lançamento do recebimento é ignorado se a cobrança do contrato já foi contada |
| Recebido | entradas pagas com `paid_at` em M |
| Custos | saídas com `entry_date` em M (pagas + pendentes) |
| Lucro (caixa) | Recebido − saídas pagas com `paid_at` em M |
| Margem | Lucro ÷ Recebido |
| A receber / Atrasado | entradas pendentes + cobranças a receber, a vencer / vencidas |
| A pagar | saídas pendentes |
| Saldo em conta | Σ saldo inicial das contas ativas + entradas pagas − saídas pagas |
| Gráfico 12 meses | receita (recebido), custos (saídas pagas), lucro |

**Fluxo de caixa:**
- Meses passados: realizado (`paid_at`).
- Próximos 6 meses: projetado = pendentes futuros + mensalidades ativas dos contratos (até o `fim`) + recorrências ativas (até `gf_recorrencias.fim`), sem contar duas vezes o que já virou lançamento pendente.
- Saldo previsto acumulado a partir do saldo atual.

**DRE (competência, `entry_date`):**
1. Receita bruta (grupo receita).
2. − Impostos = Receita líquida.
3. − Custos variáveis = **Margem de contribuição** (e %).
4. − Pessoal, Assinaturas, Marketing, Estrutura e Outras despesas = **Resultado**.
5. Cada linha mostra o valor e o % da receita bruta.

**Métricas** (mês, 3, 6 e 12 meses):
| Métrica | Regra | Referência |
|---|---|---|
| MRR | Σ mensalidades ativas dos contratos ativos no fim do período | — |
| Ticket médio | Recebido ÷ clientes distintos que pagaram (contrato ou lançamento com negócio) | — |
| Churn | contratos encerrados ou cancelados no período ÷ contratos ativos no início | < 3% ao mês |
| Clientes novos | contratos criados no período. Sem contratos: negócios ganhos no período | — |
| CAC | Σ saídas de categorias com `conta_cac` ÷ clientes novos | — |
| LTV | receita média mensal por cliente × permanência média (1 ÷ churn mensal; sem churn, duração média dos contratos; sem nada, "—") | — |
| LTV/CAC | LTV ÷ CAC | ≥ 3 saudável |
| Payback | CAC ÷ receita média mensal por cliente | < 12 meses |
| ROI empresa | (Receita − Custos) ÷ Custos | > 0 |
| ROI marketing | (receita recebida dos clientes novos do período − gasto marketing) ÷ gasto marketing | > 0 |
| Ponto de equilíbrio | despesas fixas (pessoal + assinaturas + estrutura + marketing + outras) ÷ (margem de contribuição %) | — |

Divisão por zero ou ausência de base gera **"—"** com o motivo curto. Exemplos: "lance os gastos de marketing", "nenhum cliente novo no período".

## 5. Edição

- **Lançamento pendente:** edita tudo.
- **Lançamento pago:** botão **Corrigir** = contra-lançamento + lançamento novo com os valores certos (dois `financial_entries`, ligados por `reverses_entry_id`).
- **Recorrência:** "só este mês" edita o lançamento gerado. "Daqui pra frente" edita o molde e o `fim`. "Encerrar" = `is_active=false`.
- **Parcelado:** cria N lançamentos pendentes mês a mês (sobra de centavos na 1ª) e o grupo `gf_parcelamentos`. Editar o parcelamento redistribui só as parcelas pendentes.
- **Contrato (editar):** título, início, fim e valores das formas. **Refazer parcelamento da implantação:** apaga as parcelas `a_receber` da forma e recria N novas sobre o saldo (total − recebidas), com competências `parcela-k` sem colisão (numeração continua depois das recebidas). Mensalidade com valor novo vale para as cobranças ainda não geradas, e opcionalmente para as `a_receber` futuras.

## 6. Telas

- Menu **Financeiro** (grupo Análise › Dinheiro, hub, como Contratos). Visível só para quem `fn_gf_pode(org,'ver')`.
- Abas: **Visão geral · Lançamentos · Fluxo de caixa · DRE · Métricas · Acesso** (a última só para admin).
- Princípio: **números primeiro, pouco texto**. Botões claros: "+ Entrada", "+ Saída".
- Tema claro e escuro pelos tokens. Gráficos com **recharts** (já é dependência do projeto), seguindo o padrão de gráficos que o repositório já usa.

## 7. Fora do escopo (fase 2)

- Importação de gasto de anúncios.
- Orçamento e metas.
- OFX e conciliação.
- Centro de custo.
- Nota fiscal.
- Endurecer a RLS do núcleo.
- Multimoeda: só BRL na v1. O núcleo suporta moeda, mas as telas assumem BRL.

## 8. Esteira (com Docker local)

O PC agora tem Docker Desktop. Por isso:
- **Testes:** `pnpm test:db` (invariantes do banco) e a suíte de unitários rodam **localmente**, antes de cada envio. O GitHub Actions deixa de ser obrigatório.
- **Imagens:** montadas localmente (`docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build`, só app, worker e scheduler, amd64) e enviadas à VPS por SSH (`docker save | ssh docker load`), com as tags `ghcr.io/lermiis/<imagem>:<versão>`. O `update.sh` é rodado com as imagens já presentes. Conferir na tarefa de publicação se o preflight do `update.sh` exige o registro. Se exigir, empurrar ao GHCR com token de pacote, ou usar a opção de imagem local do kit.
- **Depois disso:** repositório e pacotes podem voltar a **privado**, decisão já combinada.

## 9. Testes

- **Unitários:** regras puras de todos os números (Visão geral, fluxo projetado, DRE, cada métrica com "—"), parcelamento, refazer parcelamento do contrato.
- **Invariantes (CI):**
  - RLS de `gf_*`: viewer sem acesso não lê; `ver` lê e não escreve; `editar` escreve; admin sempre.
  - Contratos sob a nova regra.
  - `gf_acessos` só admin.
  - Cross-org.
  - Varreduras ADR-0002, LGPD e definer.
- **Manual na VPS:**
  - lançar assinatura recorrente, parcelado e custo de anúncio;
  - conferir DRE, fluxo e métricas;
  - dar e tirar acesso de um usuário de teste.
