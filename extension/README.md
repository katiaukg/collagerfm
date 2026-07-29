# Extensao companheira do collager.fm

Esta WebExtension permite que o collager.fm exclua um scrobble e gerencie
obsessoes pela sessao web do Last.fm. Para substituir metadados, o site primeiro
envia um novo scrobble corrigido pela API oficial e, somente depois, pede que a
extensao exclua o registro original.

O mesmo codigo atende Chromium e Firefox, com manifestos separados:

- Chrome e Edge usam `background.service_worker`.
- Firefox desktop e Android usam `background.scripts`.
- A extensao nao coleta nem transmite dados para armazenamento externo.

## Atividade visual no collager.fm

Ao excluir um scrobble, excluir uma obsessao ou definir uma obsessao, a extensao
envia ao collager.fm somente o andamento da operacao. O site mostra um balao
compacto com a acao atual, a faixa envolvida, as etapas recentes e o resultado.
As acoes concluidas tambem ficam em um historico local do navegador, acessivel
pelo botao circular da extensao nas collages Recentes, Curtidas e Obsessoes.
Esse historico pode ser percorrido ou apagado pelo proprio usuario.

O balao nao incorpora nem reproduz a pagina do Last.fm. Cookies, controles
internos, HTML da conta e credenciais continuam restritos a extensao.
Se a sessao precisar de atencao, o balao oferece o botao **Abrir Last.fm** em vez
de trocar automaticamente a aba atual.

Depois de atualizar os arquivos desta pasta, recarregue a extensao na pagina de
extensoes do navegador e recarregue o collager.fm.

## Chrome e Edge

1. Abra `chrome://extensions` ou `edge://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactacao**.
4. Escolha esta pasta `extension`.
5. Entre normalmente em [last.fm](https://www.last.fm) no mesmo navegador.
6. Recarregue o collager.fm depois de instalar a extensao.

## Firefox desktop

Para desenvolvimento:

1. Execute `build-firefox.cmd` nesta pasta.
2. Abra `about:debugging#/runtime/this-firefox`.
3. Clique em **Carregar extensao temporaria**.
4. Escolha `dist\firefox\manifest.json`.
5. Entre normalmente em [last.fm](https://www.last.fm) no Firefox.
6. Recarregue o collager.fm.

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
