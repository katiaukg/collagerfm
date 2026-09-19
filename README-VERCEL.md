# Publicar o collager.fm na Vercel

O site e a Function do Last.fm podem ser publicados juntos no mesmo projeto Vercel. A API key fica somente nas variaveis de ambiente da Function e nunca e enviada ao navegador.

## Pelo painel da Vercel

1. Envie este diretorio para um repositorio GitHub.
2. Na Vercel, escolha **Add New > Project** e importe o repositorio.
3. Se o repositorio tiver outras pastas, defina **Root Directory** como `work/site-preview`.
4. Use **Framework Preset: Other**. Nao e necessario Build Command.
5. Em **Settings > Environment Variables**, crie `LASTFM_API_KEY` e `LASTFM_API_SECRET` e marque Production, Preview e Development.
6. No Marketplace da Vercel, conecte um banco **Upstash Redis** ao projeto. A integracao deve fornecer `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
7. Faca um novo deploy depois de adicionar ou alterar as variaveis.

O endereco `/` abre `lastfm-collage.html`, e o navegador usa automaticamente a Function `/api/lastfm`.

O Shared Secret nao e usado nas consultas de leitura, mas e necessario para autorizar curtidas, remocoes de curtidas, novos scrobbles e atualizacoes de tocando agora. Ele permanece somente no servidor. Edicao e exclusao de scrobbles e gerenciamento de obsessoes continuam sendo feitos pela extensao, pois nao existem na API publica do Last.fm.

## Protecao da chave do Last.fm

O endpoint aplica quatro protecoes:

- fila com intervalo global entre chamadas;
- cache persistente no Redis;
- deduplicacao de requisicoes iguais, inclusive entre instancias;
- recuo automatico quando o Last.fm retorna limite de uso.

Sem Redis, o site continua funcionando com cache, fila e deduplicacao em memoria, mas cada instancia da Vercel tera seu proprio estado. Para uma unica chave atender todos os visitantes com protecao compartilhada, mantenha o Redis conectado.

Autorizacao, escritas na conta e envio de bugs em producao exigem Redis disponivel para aplicar limites compartilhados. Se essa protecao falhar, essas operacoes respondem com 503 em vez de prosseguir sem limite. No servidor local, sem Redis configurado, os limites usam memoria do processo.

Configure tambem `SESSION_SECRET` com pelo menos 32 caracteres aleatorios, exclusivo desta aplicacao, para separar a criptografia das sessoes do segredo do Last.fm. Sem essa variavel, a chave e derivada do segredo do Last.fm. Nunca coloque esses valores no HTML, no Git ou nas capturas de tela. A mudanca para cookies criptografados exige que usuarios autorizem o Last.fm novamente; trocar `SESSION_SECRET` tambem invalida sessoes anteriores.

As permissoes e limites reais das contas Vercel, Redis e Discord precisam ser conferidos nos paineis: este repositorio nao configura MFA, permissoes de equipe, limites de gastos nem retencao dos logs. Veja `SECURITY-AUDIT.md` para o escopo da revisao e as verificacoes restantes.

Os valores opcionais `LASTFM_MIN_INTERVAL_MS` e `LASTFM_MAX_QUEUE_WAIT_MS` controlam o ritmo. Os padroes sao, respectivamente, `1100` e `12000` milissegundos.

## Frontend em outro dominio

Se no futuro o HTML ficar no GitHub Pages e somente a Function ficar na Vercel, configure `ALLOWED_ORIGIN` com a origem exata, por exemplo `https://usuario.github.io`. Nesse caso, o HTML tambem precisara apontar para a URL absoluta da Function.
