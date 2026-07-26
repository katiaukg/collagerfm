# Extensao companheira do collager.fm

Esta WebExtension permite que o collager.fm exclua um scrobble e gerencie
obsessoes pela sessao web do Last.fm. Para substituir metadados, o site primeiro
envia um novo scrobble corrigido pela API oficial e, somente depois, pede que a
extensao exclua o registro original.

O mesmo codigo atende Chromium e Firefox:

- Chrome e Edge usam `background.service_worker`.
- Firefox desktop e Android usam `background.scripts`.
- A extensao nao coleta nem transmite dados para armazenamento externo.

## Chrome e Edge

1. Abra `chrome://extensions` ou `edge://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactacao**.
4. Escolha esta pasta `extension`.
5. Entre normalmente em [last.fm](https://www.last.fm) no mesmo navegador.
6. Recarregue o collager.fm depois de instalar a extensao.

## Firefox desktop

Para desenvolvimento:

1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em **Carregar extensao temporaria**.
3. Escolha o arquivo `manifest.json` desta pasta.
4. Entre normalmente em [last.fm](https://www.last.fm) no Firefox.
5. Recarregue o collager.fm.

A instalacao temporaria termina ao fechar o Firefox. Para instalacao permanente,
o pacote precisa ser assinado e publicado no
[addons.mozilla.org](https://addons.mozilla.org/developers/).

## Firefox para Android

O manifesto ja declara compatibilidade com Firefox Android. Para instalar de
forma permanente no celular, publique e assine a extensao no AMO; depois ela
podera ser instalada pelo gerenciador de extensoes do Firefox Android.

## Samsung Internet

O Samsung Internet nao aceita esta pasta ou um arquivo `.xpi` diretamente. Suas
extensoes sao aplicativos Android validados pela Samsung e distribuidos pela
Galaxy Store. Consulte [SAMSUNG-INTERNET.md](SAMSUNG-INTERNET.md) para o caminho
de portabilidade e publicacao.

## Seguranca e limitacoes

- Cookies, senha e token CSRF do Last.fm nunca sao enviados ao collager.fm nem a Vercel.
- A extensao aceita comandos somente de `collagerfm.vercel.app` e do servidor local na porta `8767`.
- Substituir significa criar o scrobble corrigido e excluir o original; nao e uma edicao atomica.
- Se a exclusao falhar depois do novo envio, o site avisa que existe um duplicado para ser removido manualmente.
- O Last.fm normalmente aceita reenvio com timestamp antigo somente por cerca de 14 dias.
- A exclusao usa uma rota interna do site do Last.fm. Uma mudanca no site pode exigir atualizacao da extensao.
- Criar ou excluir uma obsessao tambem depende dos controles internos exibidos pelo site do Last.fm.
