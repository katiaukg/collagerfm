# collager.fm

Gerador interativo de collages a partir do historico de reproducao do Last.fm.

O projeto oferece layouts responsivos para desktop e mobile, personalizacao de cabecalho, quadros e textos, multiplas fontes de imagem, presets, historico de exclusoes e mesclagens, alem de exportacao em imagem e HTML.

## Executar localmente

1. Crie `.env.local` na raiz do projeto com suas credenciais de aplicativo do Last.fm:

   ```env
   LASTFM_API_KEY=sua_api_key
   LASTFM_API_SECRET=seu_shared_secret
   ```

2. Inicie o servidor completo:

   ```powershell
   node serve-local.js
   ```

3. Abra `http://127.0.0.1:8767/lastfm-collage.html`.

O `.env.local` e ignorado pelo Git. A API key e o Shared Secret ficam somente no processo local; a sessao autorizada e mantida em cookie `HttpOnly` da propria origem local.

Sem essas credenciais, a geracao ainda pode usar uma API key informada no navegador, mas curtir, descurtir, adicionar scrobbles e atualizar o tocando agora ficam indisponiveis.
