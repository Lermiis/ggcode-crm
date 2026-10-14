# Módulo Contratos e receitas — especificação

Data: 14/10/2026 · Projeto: CRM GG Code (fork do DeskcommCRM v1.80.0) · Parte 1 de 4

## 1. Objetivo

Quem administra a empresa precisa saber, sem ler muito, **quanto cada cliente paga, o que vai entrar, o que já entrou e o que está atrasado**. Hoje isso não existe no CRM. A aba Carteira do painel n8n é um paliativo baseado em campos do negócio.

**O que o Guilherme pediu e aprovou:**
- Modelos de cobrança: **implantação** (parcelável), **mensalidade**, **por evento** e **avulso**. Um contrato combina vários. Exemplos: Juliana = implantação R$ 1.000 + R$ 500 por evento; cliente de site = implantação R$ 1.000 + mensalidade R$ 500.
- O recebimento é **marcado à mão** ("Recebido"). O Asaas fica para depois.
- Abordagem 1: **módulo novo e próprio**, em arquivos nossos, seguindo o padrão de módulos do Deskcomm (ADR-0002). As atualizações do Deskcomm continuam sendo recebidas.
- O código vale para a instalação inteira. Cada empresa liga ou desliga o recurso.

**Sucesso:**
- Em uma tela, ver o total a receber no mês, o recebido e o atrasado.
- Marcar um recebimento em 2 cliques, e ele aparece no Faturamento.
- A mensalidade nasce sozinha todo mês.
- O evento da Juliana é lançado em menos de 30 segundos.

## 2. Escopo

**Dentro:**
- Contratos, formas de cobrança, cobranças, recebimento, lançar evento, encerrar e cancelar contrato.
- Telas próprias.
- Rotina diária das mensalidades.
- Integração com o caixa (Faturamento).

**Fora (agora):**
- Reajuste anual, multa e juros, nota fiscal, cobrança automática (Asaas), envio de cobrança ao cliente.
- Desfazer recebimento: usar o estorno do Faturamento, que já existe.
- Cartão do contrato dentro da ficha do negócio, porque mexe em tela do Deskcomm. Fica para a parte 4.
- Custos e assinaturas: parte 2. Tela inicial: parte 3. Menu e contatos: parte 4.

## 3. Pré-requisito: o nosso próprio código publicado

Hoje o servidor roda as **imagens prontas do Deskcomm** (GHCR do upstream). Para rodar código nosso:

1. **Repositório privado da GG Code no GitHub**, cópia do DeskcommCRM. A branch `main` fica igual ao upstream e a branch `ggcode` guarda as nossas mudanças.
2. O workflow `publish-image.yml`, que já vem no repositório, constrói as 4 imagens nos servidores do GitHub e publica no **GHCR da GG Code**. O build pesado nunca roda na VPS.
3. Na VPS, `APP_IMAGE`, `WORKER_IMAGE` e `SCHEDULER_IMAGE` passam a apontar para as imagens da GG Code com número de versão (ex.: `1.80.0-gg.1`).
4. **Atualizar o Deskcomm daqui pra frente:**
   1. Juntar a tag nova do upstream na branch `ggcode`.
   2. Resolver conflitos e rodar os testes.
   3. Criar a tag `vX.Y.Z-gg.N`.
   4. O CI publica as imagens.
   5. Rodar `update.sh` na VPS apontando para a nossa versão.
5. **Custo:** zero no plano gratuito do GitHub, que basta para o volume atual. O GHCR privado tem cota grátis de armazenamento e o Actions tem 2.000 min/mês. Cada build leva em torno de 15–25 min. Se a cota apertar, as imagens podem ser públicas, porque o código é MIT e não guarda segredos.

**Precisa do Guilherme:** uma conta ou organização GitHub da GG Code, e me dar acesso para criar o repositório. Nada é comprado.

## 4. Dados

Seguem a ADR-0002:
- Uma função `public.fn_contratos_provisionar()` cria as tabelas quando o módulo é instalado.
- A função entra pela tripla migration + apêndice do `baseline.sql` + MANIFEST.
- RLS por operação no molde do módulo Honorários (migration 0480).

### `contratos`
| campo | tipo | regra |
|---|---|---|
| id | uuid | |
| organization_id | uuid | obrigatório, RLS |
| contact_id | uuid → contacts | obrigatório (o cliente); `on delete restrict` |
| lead_id | uuid → crm_leads | opcional (o negócio fechado); `on delete set null` |
| nome | text | ex.: "Sistema de ingressos PEC" |
| inicio | date | obrigatório |
| fim | date | opcional |
| situacao | text | `ativo` · `encerrado` · `cancelado` |
| observacoes | text | opcional |

### `contrato_formas` (formas de cobrança)
| campo | tipo | regra |
|---|---|---|
| id, organization_id, contrato_id | | |
| tipo | text | `implantacao` · `mensalidade` · `evento` · `avulso` |
| valor_cents | bigint > 0 | implantação: total; mensalidade: por mês; evento: valor padrão; avulso: valor |
| parcelas | int ≥ 1 | só implantação (padrão 1) |
| primeiro_vencimento | date | implantação e avulso |
| dia_vencimento | int 1–31 | só mensalidade |
| descricao | text | opcional (avulso) |
| ativa | bool | mensalidade desligada para de gerar |

### `contrato_cobrancas`
| campo | tipo | regra |
|---|---|---|
| id, organization_id, contrato_id, forma_id | | |
| competencia | text | identifica a cobrança dentro da forma: `parcela-1`, `2026-10`, `evento-<uuid>`, `avulso` |
| descricao | text | ex.: "Mensalidade out/26", "Evento: Espetáculo de fim de ano" |
| vencimento | date | |
| valor_cents | bigint > 0 | |
| situacao | text | `a_receber` · `recebida` · `cancelada` |
| recebida_em | date | quando recebida |
| financial_entry_id | uuid → financial_entries | o lançamento no caixa |

- **Índice único `(forma_id, competencia)`:** é a garantia de que a rotina rodando duas vezes não duplica mensalidade. É o mesmo desenho dos lançamentos recorrentes.
- **"Atrasada" não é gravada.** Ela é calculada: `a_receber` com vencimento antes de hoje, no fuso da organização. Assim nunca fica desatualizada.
- Dinheiro sempre em centavos (`bigint`), como no resto do CRM.

## 5. Regras

- **Criar contrato:** as formas de implantação e avulso geram as cobranças na hora. Implantação em N parcelas = valor ÷ N. A sobra de centavos vai na 1ª parcela. As parcelas vencem mês a mês a partir do 1º vencimento. Mensalidade gera a do mês corrente, se o vencimento ainda não passou, e as seguintes ficam com a rotina.
- **Rotina diária** (`/api/v1/cron/contratos-mensalidades`, no mesmo esquema de `recurring-entries`):
  - Para cada mensalidade ativa de contrato ativo, cria a cobrança do **mês corrente e do mês seguinte**, para "o que vem por aí" já aparecer.
  - Dia 31 em mês curto vira o último dia do mês, reaproveitando `competenciaDoMes`.
  - Não gera nada depois do `fim` do contrato.
- **Lançar evento:** informa data, nome e valor (sugere o valor padrão). Cria uma cobrança que vence na data informada.
- **Recebido:** uma função no banco faz tudo de uma vez:
  - trava a cobrança;
  - confere se está `a_receber`;
  - cria o `financial_entries` (entrada, conta escolhida, origem `manual`);
  - marca `recebida`.

  Dois cliques seguidos não lançam em dobro. É o mesmo desenho de `fn_honorarios_parcela_pagar`.
- **Cancelar cobrança:** só se estiver `a_receber`.
- **Encerrar contrato** (ou cancelar): para de gerar mensalidades. Pergunta se as cobranças futuras `a_receber` devem ser canceladas. O padrão é sim.
- **Permissões:** quem tem só leitura vê. Criar, receber, lançar evento e encerrar exigem gerente ou admin, a mesma régua do Honorários e do Financeiro.
- **LGPD:** o contrato só aponta para o contato e não copia nome, CPF ou telefone. A anonimização do contato continua valendo. O teste de cascata da LGPD precisa continuar passando.

## 6. Telas

Princípio: **números primeiro, pouco texto, uma ação por linha.**

**Menu:** item **"Contratos"** no grupo Dinheiro, visível na barra lateral para quem tem o módulo ligado.

**`/app/contratos`, tela principal**
- Topo com 3 números grandes: **A receber no mês** · **Recebido no mês** · **Atrasado** (em vermelho, com a quantidade).
- Duas abas:
  - **Cobranças:** lista por vencimento, com filtro rápido *Atrasadas · Este mês · Próximas · Recebidas*. Cada linha mostra cliente, descrição, vencimento, valor e o botão **Recebido**. O clique pede só a conta, já sugerindo a última usada.
  - **Contratos:** lista de clientes com nome do contrato, receita mensal, situação e próximo vencimento. Botão **Novo contrato**.

**Ficha do contrato** (abre ao clicar)
- Cabeçalho: cliente (link para o contato e o negócio), período e situação.
- Formas de cobrança em cartões curtos, ex.: "Implantação R$ 1.000 · 2x" e "Por evento R$ 500 · **Lançar evento**".
- Lista de cobranças do contrato, a mesma linha da aba Cobranças.
- Ações: Editar, Encerrar.

**Novo contrato** (uma janela)
1. Cliente: o mesmo seletor de contato da criação de lead (`SeletorDeContato`), com "Criar contato" ali mesmo. O negócio é opcional.
2. Nome e início.
3. "+ Forma de cobrança": escolhe o tipo, e só aparecem os campos daquele tipo.
4. Salvar.

Os textos ficam curtos, sem parágrafos explicativos na tela. Os componentes são os do design system do CRM (shadcn), funcionando no tema claro e no escuro, como o resto.

## 7. Arquivos (todos novos, exceto onde indicado)

- `supabase/migrations/2026101400xxxx_ggcode_contratos.sql` + apêndice no `baseline.sql` + MANIFEST
- `lib/contratos/` (regras puras: parcelas, competência, totais; validação zod)
- `app/api/v1/contratos/...` (contratos, formas, cobranças, receber, cancelar, lançar evento)
- `app/api/v1/cron/contratos-mensalidades/route.ts` + agendamento no scheduler
- `app/app/contratos/` (página, abas, ficha, formulário)
- `lib/modulos/catalogo.ts` (**alterado:** uma entrada no catálogo)
- `lib/navigation/catalogo.ts` (**alterado:** um item de menu)

Só duas alterações em arquivos do Deskcomm, ambas de uma linha de lista. O resto é arquivo nosso, então juntar atualizações deve dar pouco conflito.

## 8. Testes

- **Unitários** (vitest, padrão do repositório):
  - divisão de parcelas e sobra de centavos;
  - competência de mês curto;
  - geração idempotente da rotina;
  - totais "a receber / recebido / atrasado";
  - "atrasada" calculada no fuso.
- **Rotas:** permissão (viewer não recebe), módulo não instalado devolve mensagem clara, recebimento duplo não duplica o caixa.
- **Invariantes que já existem e precisam passar:** varredura de RLS, `security definer`, cascata da LGPD e o CI completo (`ci.yml`) antes de publicar imagem.
- **Na VPS, depois de publicar:**
  - instalar o módulo;
  - criar o contrato real da Juliana;
  - lançar um evento;
  - marcar recebido;
  - conferir no Faturamento.

## 9. Riscos

- **Atualização do upstream que mexe em `catalogo.ts` ou no baseline:** conflito pequeno, resolvido na junção. O teste do CI pega o erro antes de publicar.
- **Cota do GitHub:** builds de 15–25 min. Atualizar a cada 15 dias cabe no plano grátis.
- **Primeira troca para imagens próprias:** fazer à noite, com backup, e manter a variável antiga anotada para voltar às imagens do Deskcomm se algo falhar.

## 10. Depois deste módulo

- A aba Carteira do painel n8n passa a ler os contratos em vez dos campos do negócio, ou é aposentada quando a tela inicial (parte 3) existir.
- Parte 2 (custos e assinaturas) reaproveita os lançamentos recorrentes de saída do Financeiro.
