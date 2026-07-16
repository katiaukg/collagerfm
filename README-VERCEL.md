# Publicar o collager.fm na Vercel

O site e a Function do Last.fm podem ser publicados juntos no mesmo projeto Vercel. A API key fica somente nas variaveis de ambiente da Function e nunca e enviada ao navegador.

## Pelo painel da Vercel

1. Envie este diretorio para um repositorio GitHub.
2. Na Vercel, escolha **Add New > Project** e importe o repositorio.
3. Se o repositorio tiver outras pastas, defina **Root Directory** como `work/site-preview`.
4. Use **Framework Preset: Other**. Nao e necessario Build Command.
5. Em **Settings > Environment Variables**, crie `LASTFM_API_KEY` e marque Production, Preview e Development.
6. Faca um novo deploy depois de adicionar ou alterar a variavel.

O endereco `/` abre `lastfm-collage.html`, e o navegador usa automaticamente a Function `/api/lastfm`.

O Shared Secret do Last.fm nao e necessario para as consultas de leitura usadas pelo gerador e nao deve ser configurado.

## Frontend em outro dominio

Se no futuro o HTML ficar no GitHub Pages e somente a Function ficar na Vercel, configure `ALLOWED_ORIGIN` com a origem exata, por exemplo `https://usuario.github.io`. Nesse caso, o HTML tambem precisara apontar para a URL absoluta da Function.
