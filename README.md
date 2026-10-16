# collager.fm

Gerador interativo de collages a partir do historico de reproducao do Last.fm.

O projeto oferece layouts responsivos para desktop e mobile, personalizacao de cabecalho, quadros e textos, multiplas fontes de imagem, presets, historico de exclusoes e mesclagens, alem de exportacao em imagem e HTML.

## Capas e sessao local

Capas escolhidas, coladas ou arrastadas ficam no IndexedDB deste navegador, associadas ao artista, ao par artista/album ou ao par artista/faixa. Elas acompanham o item em outros periodos e modos. "Restaurar Imagem" remove a capa preservada; o historico permite desfazer essa remocao.

Em "Neste navegador", a opcao "Continuar de onde parei" salva a ultima collage com capas, textos, configuracoes e edicoes. O salvamento da sessao vem desativado; desativa-lo apaga a sessao salva e mantem as capas. O painel informa o espaco usado por esses dados e permite exportar/importar um backup com as imagens. Esse backup nao inclui chaves de API, tokens ou cookies. Presets continuam guardando apenas a personalizacao.

Os dados ficam neste navegador e nesta origem. Limpar os dados do site pode remove-los; localhost e o site de producao possuem armazenamentos separados. A sessao reabre como uma copia local, sem executar acoes na conta Last.fm.

O idioma inicial usa o pais informado pela Vercel: Brasil recebe portugues e os demais paises recebem ingles. Em ambiente local ou sem essa informacao, a regiao configurada no navegador serve de alternativa. Uma escolha manual no menu de idiomas prevalece nas proximas visitas.

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
