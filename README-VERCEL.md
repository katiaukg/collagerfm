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

O Shared Secret nao e usado nas consultas de leitura, mas e necessario para autorizar edicoes e exclusoes de scrobbles. Ele permanece somente no servidor.

## Protecao da chave do Last.fm

O endpoint aplica quatro protecoes:

- fila com intervalo global entre chamadas;
- cache persistente no Redis;
- deduplicacao de requisicoes iguais, inclusive entre instancias;
- recuo automatico quando o Last.fm retorna limite de uso.

Sem Redis, o site continua funcionando com cache, fila e deduplicacao em memoria, mas cada instancia da Vercel tera seu proprio estado. Para uma unica chave atender todos os visitantes com protecao compartilhada, mantenha o Redis conectado.

Os valores opcionais `LASTFM_MIN_INTERVAL_MS` e `LASTFM_MAX_QUEUE_WAIT_MS` controlam o ritmo. Os padroes sao, respectivamente, `1100` e `12000` milissegundos.

## Frontend em outro dominio

Se no futuro o HTML ficar no GitHub Pages e somente a Function ficar na Vercel, configure `ALLOWED_ORIGIN` com a origem exata, por exemplo `https://usuario.github.io`. Nesse caso, o HTML tambem precisara apontar para a URL absoluta da Function.
