# Extensao companheira do collager.fm

Esta extensao Chromium permite que o collager.fm exclua um scrobble pela sessao web do Last.fm. Para substituir metadados, o site primeiro envia um novo scrobble corrigido pela API oficial e, somente depois, pede que a extensao exclua o registro original.

## Instalar para desenvolvimento

1. Abra `chrome://extensions` ou `edge://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactacao**.
4. Escolha esta pasta `extension`.
5. Entre normalmente em [last.fm](https://www.last.fm) no mesmo navegador.
6. Recarregue o collager.fm depois de instalar a extensao.

## Seguranca e limitacoes

- Cookies, senha e token CSRF do Last.fm nunca sao enviados ao collager.fm nem a Vercel.
- A extensao aceita comandos somente de `collagerfm.vercel.app` e do servidor local na porta `8767`.
- Substituir significa criar o scrobble corrigido e excluir o original; nao e uma edicao atomica.
- Se a exclusao falhar depois do novo envio, o site avisa que existe um duplicado para ser removido manualmente.
- O Last.fm normalmente aceita reenvio com timestamp antigo somente por cerca de 14 dias.
- A exclusao usa uma rota interna do site do Last.fm. Uma mudanca no site pode exigir atualizacao da extensao.
