# MCP Discord

Este bot de Discord funciona como um "MCP para Discord". Você descreve em linguagem natural o servidor que quer, e o Claude (`claude-sonnet-5-5`, com esforço `high` e raciocínio adaptativo) monta tudo por tool use: cargos, categorias, canais, permissões, mensagens e configurações.

```
/montar descricao: servidor de comunidade de Valorant com staff, regras, cargos de rank e salas de voz
/editar pedido: crie uma categoria de eventos com um canal de anúncios e uma sala de palco
```

**Fluxo:**
1. O Claude lê a estrutura atual do servidor.
2. Ele monta um **plano**, que aparece num embed com os botões **Confirmar** e **Cancelar**. Até aqui nada é alterado.
3. Depois que você confirma, o bot executa o plano e mostra o progresso numa mensagem que vai sendo atualizada.
4. No final aparece um resumo do que foi feito.

## Setup

Requisitos: Node.js 20 ou superior.

```bash
npm install
cp .env.example .env   # preencha DISCORD_TOKEN, CLIENT_ID e ANTHROPIC_API_KEY
npm run check          # teste local, sem rede
npm start
```

1. Crie uma aplicação em <https://discord.com/developers/applications>. Na aba **Bot**, gere o token. Na aba **General Information**, copie o **Application ID**: esse é o `CLIENT_ID`.
2. Para desenvolver, defina `GUILD_ID` no `.env` para os comandos aparecerem na hora. Sem ele, os comandos são registrados globalmente e podem levar alguns minutos para aparecer.
3. Convide o bot usando o link abaixo.
4. Em **Configurações do Servidor → Cargos**, **arraste o cargo do bot para o topo**. O bot só consegue criar, editar e ordenar cargos que fiquem abaixo do cargo dele.

## Link de convite

Troque `SEU_CLIENT_ID` pelo seu Application ID (o link também aparece no log quando o bot inicia).

- **Recomendado (Administrador):**
  `https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=8&scope=bot%20applications.commands`
- **Mínimo** (Gerenciar Cargos, Gerenciar Canais, Gerenciar Servidor, Ver Canais, Enviar Mensagens, Inserir Links, Gerenciar Mensagens, Ver Histórico):
  `https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=268528688&scope=bot%20applications.commands`

O Discord não deixa um bot conceder, em cargos ou permissões de canal, uma permissão que ele próprio não tem. Por isso o convite com Administrador é o mais prático: assim o Claude consegue montar cargos de staff com permissões de moderação.

## Intents e permissões

- **Intents:** só `Guilds`. Não é preciso ativar nenhum *Privileged Gateway Intent*.
- **Quem pode usar:** o dono do servidor ou quem tem **Administrador**. Os comandos já ficam ocultos para os outros membros, e o bot confere essa regra de novo em cada uso.
- **Bot:** precisa no mínimo de `ManageRoles` e `ManageChannels`. O bot verifica isso antes de começar, e o Claude recebe a posição do cargo do bot e as permissões que faltam para planejar dentro desses limites.

## Segurança e robustez

- **Plano antes de tudo:** durante o planejamento, o bot bloqueia as tools de escrita. Elas só funcionam depois que você clica em Confirmar.
- **Exclusões:** só são feitas se o ID do item estiver listado no plano aprovado (seção "⚠️ Será EXCLUÍDO"). Quando o plano inclui exclusões, o botão vira **Confirmar (inclui exclusões)**, em vermelho. O canal em que o comando foi usado nunca é excluído.
- **Erros do Discord** (hierarquia, limites, validação) voltam ao Claude como `tool_result` com `is_error: true`, para que ele corrija e tente de novo.
- **Rate limits:** as ações rodam numa fila serial por servidor, com uma pausa entre elas (`ACTION_DELAY_MS`), além do controle de rate limit que o próprio discord.js já faz.
- **Limites:** o número de iterações do loop é limitado (`MAX_PLAN_ITERATIONS` e `MAX_EXEC_ITERATIONS`), e só roda uma sessão por servidor de cada vez.
- **Logs:** cada ação, com o input e o resultado ou erro, é registrada no console e em `logs/actions.log` (um JSON por linha).
- **Recusas:** se o Claude recusar um pedido por política, a API tenta de novo automaticamente num modelo substituto (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).

## Estilo: símbolos, emojis e idioma

Os dois comandos têm duas opções de estilo, ambas opcionais:

| Opção | O que faz |
|---|---|
| `simbolos` | Os símbolos decorativos que você quer, ex.: `・ ┃ 「 」 ✦`. O Claude usa **só esses** e distribui entre separador de canal, moldura de categoria, separador de cargo e marcador. Escreva `criativo` (ou "seja criativo", "livre", "você escolhe") para o Claude montar um kit sozinho. Se deixar vazio, o Claude também escolhe, a menos que o próprio pedido fale de símbolos. |
| `idioma` | O idioma do conteúdo do servidor, ex.: `português`, `English`, `español`. Se deixar vazio, vale o idioma em que o pedido foi escrito. |

Os **emojis**, as cores, os nomes e os textos ficam sempre por conta do Claude, combinando com o tema, a menos que você peça algo específico no texto (ex.: "sem emojis").

```
/montar descricao: servidor de anime fofo simbolos: criativo
/montar descricao: servidor de RPG medieval simbolos: ⊱ ⊰ ❧ ☩ idioma: português
/editar pedido: crie uma categoria de eventos simbolos: 「 」 ・
```

O plano sempre começa com a seção **🎨 Estilo**, que mostra o idioma, o kit de símbolos e exemplos de nomes, para você conferir antes de confirmar.

O guia completo fica na seção `# GUIA DE ESTILO` de [`src/prompts/system.md`](src/prompts/system.md). Ele inclui uma **biblioteca com centenas de símbolos Unicode** (separadores, molduras, linhas, estrelas, marcadores, números e letras estilizadas) e **kits prontos** (minimalista, elegante, fofo, gamer, medieval, celestial, corporativo, anime). No fim do guia há o espaço **"Regras fixas do dono do bot"**: use-o para escrever um padrão que valha sempre, como "toda categoria usa 「 」".

## Estrutura

```
src/
  index.js            client, registro dos slash commands e roteamento
  config.js           variáveis de ambiente
  agent.js            loop agêntico (plano → aprovação → execução)
  session.js          fluxo do comando: autorização, plano, botões, progresso, resumo
  queue.js            fila com delay para as ações no Discord
  logger.js           logs no console e em arquivo
  commands/           /montar e /editar
  tools/              uma tool por arquivo (schema + execução) e helpers
  ui/embeds.js        embeds e botões
  prompts/system.md   system prompt e guia de estilo
scripts/selftest.js   teste local do loop e das tools (sem rede)
```
