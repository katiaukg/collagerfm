# Auditoria de seguranca - 2026-09-19

Revisao do codigo local, com correcoes e testes de regressao. Nao e um pentest completo de producao. Nenhum scrobble nem mensagem de Discord real foi enviado nos testes.

## Arquitetura e credenciais

- Frontend HTML/JavaScript, Functions Node na Vercel, servidor HTTP local e extensao do navegador.
- Redis armazena cache, fila e contadores temporarios; nao foi encontrado banco SQL no repositorio. Comandos Redis usam argumentos separados, nao concatenacao de texto do usuario em Lua.
- `LASTFM_API_SECRET`, `DISCORD_BOT_TOKEN` e o token administrativo Redis pertencem somente ao ambiente do servidor. `SESSION_SECRET` permite uma chave separada de criptografia.
- O Client ID do Spotify e um identificador publico; o fluxo usa PKCE. Chaves e tokens salvos pelo frontend no armazenamento do navegador ainda dependem da protecao contra XSS e da seguranca do dispositivo.
- A sessao oficial do Last.fm passa pelo servidor para assinar chamadas. O sistema nao e inteiramente local nesse modo. O cookie agora e criptografado e autenticado com AES-256-GCM, HttpOnly, SameSite=Lax e Secure em HTTPS, com expiracao de 90 dias verificada pelo servidor.
- A varredura por padroes conhecidos nos arquivos versionados atuais nao encontrou credenciais embutidas. Isso nao comprova ausencia de segredos em todo o historico Git, logs, artefatos publicados ou paineis externos.

## Falhas corrigidas

| Prioridade | Falha | Correcao |
| --- | --- | --- |
| Alta | Retorno do login nao vinculado a uma tentativa do navegador | Estado aleatorio, cookie HttpOnly, validade de 10 minutos e comparacao constante antes de trocar token |
| Alta | Dados externos interpolados dentro do script de retorno | Serializacao escapa `<` e separadores Unicode; payload `</script>` deixa de encerrar o script |
| Alta | Servidor local podia expor arquivos internos e aceitar Host arbitrario | Host loopback fixo, bloqueio de diretorios internos/dotfiles, validacao de caminho real e metodos |
| Alta | Importacao podia indicar seletores de botoes e rotulos HTML | Grupos e campos permitidos pelo aplicativo, limites numericos, rotulos escapados, chaves de prototipo recusadas |
| Media | Cookie assinado legivel e sem prazo validado pelo servidor | Cookie criptografado, prazo validado, rejeicao de adulteracao, cookie malformado tratado |
| Media | Escritas sem Origin, tipos ou limites consistentes | Origin exato, application/json, limite de 32 KiB, limite de profundidade, metadados escalares e limites por campo |
| Media | Rotas alternativas contornavam intervalo de scrobbles | Mesma trava por conta em scrobble, restauracao e correcao; falha do Redis impede escrita |
| Media | Consumo excessivo de APIs e envio de bugs | Limites por IP/rota em memoria e Redis; expiracao dos contadores e teto do mapa local |
| Media | Redirect de imagem local aceitava outros hosts; SVG e resposta grande | Mesmos handlers local/producao, hosts/portas/credenciais validados, apenas tipos raster e limite durante leitura |
| Media | Corpo local podia ser truncado e caminho malformado causar erro | Rejeicao 413 sem processar corpo parcial; caminho invalido retorna 400 |

Cabecalhos adicionados: nosniff, DENY para frames, no-referrer e CSP para object-src/base-uri/frame-ancestors. A CSP ainda nao restringe script-src porque o aplicativo depende de scripts inline; essa parte exige uma migracao especifica para nonce/hash ou scripts externos.

O IP de producao usa o cabecalho fornecido pela Vercel. A [documentacao de cabecalhos da Vercel](https://vercel.com/docs/headers/request-headers) informa que ela sobrescreve X-Forwarded-For para evitar falsificacao. Outro proxy/hospedagem exige revisar essa premissa. Localmente, usamos o endereco do socket.

## Verificacoes reproduziveis

- `node --test tests/security.test.cjs`: entradas, CSRF, sessao, escape de script, proxies, limites, concorrencia e desafio do Last.fm.
- `node tests/editor-ui.cjs`: Playwright/Chrome, API simulada, edicao local e restauracao nos tres modos editor em desktop e mobile. `PLAYWRIGHT_MODULE` pode apontar para uma instalacao existente.
- Verificacoes HTTP locais: arquivos internos recusados, Host externo recusado, Origin externo recusado, corpo excessivo recusado, pagina e recursos publicos acessiveis.
- Sintaxe dos scripts e JSON dos idiomas/configuracao.

## Antes de publicar

1. Confirmar Redis conectado e com quota disponivel; autorizacao, escrita e Discord em producao falham de forma fechada se a protecao estiver indisponivel.
2. Configurar SESSION_SECRET aleatorio e manter segredos separados entre desenvolvimento e producao. Esta atualizacao exige nova autorizacao Last.fm.
3. Revisar colaboradores, MFA, permissoes minimas do bot Discord, limites de custo da Vercel/Redis e logs sem corpos/cookies/tokens.
4. Auditar historico Git e artefatos de releases antes de afirmar que nunca houve exposicao. Rotacionar imediatamente qualquer segredo que tenha sido publicado.
5. Validar login real apos o deploy, inclusive popup, cookies HTTPS e retorno do Last.fm. Nao foi realizada alteracao em paineis externos nesta revisao.

Limites restantes: rate limit nao substitui firewall/protecao DDoS; consultas publicas e proxies ainda precisam de monitoramento de custo; mapas antigos de cache nao possuem todos um teto global; roubo de um cookie valido permite seu uso ate expirar ou a chave ser trocada (nao ha revogacao individual centralizada). O escopo nao inclui teste de invasao da infraestrutura de terceiros.

## Ajustes funcionais solicitados durante a revisao

- Recentes, Curtidas e Obsessoes permitem alterar/restaurar titulo, album e artista apenas na collage; os identificadores originais continuam usados nas operacoes Last.fm.
- Obsessoes usa contexto de periodo geral. A consulta ja nao enviava filtro de datas; uma resposta HTML `Client Challenge` com status 200 causava falso resultado vazio. Essa resposta agora retorna erro 503 e nao e salva como historico vazio.
- O bloqueio de acesso do Last.fm nao e resolvido por mudar o periodo. Quando ele ocorre, nao se afirma que a conta nao tem obsessoes.
