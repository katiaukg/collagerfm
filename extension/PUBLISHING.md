# Publicacao da extensao collager.fm

## Pacotes prontos

- Chrome e Edge: `dist/collagerfm-chrome-1.0.zip`
- Firefox desktop e Android: `dist/collagerfm-firefox-1.0.zip`

Cada ZIP tem seu proprio `manifest.json` na raiz. Nao envie o ZIP do Firefox
para a Chrome Web Store nem o ZIP do Chrome para o Firefox Add-ons.

## Primeira publicacao no Firefox

1. Entre em `https://addons.mozilla.org/developers/` com uma Mozilla Account.
2. Escolha **Submit a New Add-on**.
3. Selecione **On this site** para aparecer na loja e receber atualizacoes
   automaticas pelo Firefox.
4. Envie `dist/collagerfm-firefox-1.0.zip`.
5. Marque Firefox para desktop e Firefox para Android como plataformas.
6. O codigo nao e minificado nem ofuscado e nao exige compilacao. Quando o
   formulario perguntar se precisa enviar o codigo-fonte separado, escolha
   **No**.
7. Preencha nome, resumo, descricao, categorias, suporte e licenca.
   O texto sugerido esta em `STORE-LISTING.md` e a politica de privacidade fica
   em `https://collagerfm.vercel.app/privacy.html` depois do proximo deploy.
8. Informe aos revisores que a extensao opera apenas no collager.fm e no
   Last.fm, usando a sessao que o usuario ja abriu no navegador.
9. Envie a versao para analise.

## Primeira publicacao no Chrome

1. Entre no Chrome Web Store Developer Dashboard.
2. Conclua o cadastro de desenvolvedor e a verificacao em duas etapas.
3. Clique em **Add new item** e envie `dist/collagerfm-chrome-1.0.zip`.
4. Preencha Store Listing, Privacy, Distribution e Test instructions.
   O texto sugerido esta em `STORE-LISTING.md` e a politica de privacidade fica
   em `https://collagerfm.vercel.app/privacy.html` depois do proximo deploy.
5. Explique as permissoes:
   - `storage`: guarda idioma, historico e regras automaticas localmente.
   - `tabs`: encontra ou abre uma aba do Last.fm para executar uma acao pedida.
   - `scripting`: permite a comunicacao controlada com as paginas suportadas.
   - acesso a `last.fm`: necessario para curtir faixas, gerenciar obsessoes e
     excluir scrobbles pela sessao web do proprio usuario.
6. Envie para revisao.

## Como publicar uma atualizacao

1. Altere o codigo na pasta `extension`.
2. Aumente `version` em `manifest.json` e `manifest.firefox.json`. A nova versao
   precisa ser maior que a anterior, por exemplo: `1.0` -> `1.0.1`.
3. Execute, dentro da pasta `extension`:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-release.ps1
```

4. Teste os dois pacotes.
5. No Chrome Developer Dashboard, abra o item existente e use **Upload new
   package**. Nao crie outro item.
6. No Firefox Developer Hub, abra o complemento existente e envie uma nova
   versao. Nao crie outro complemento.
7. Depois da aprovacao, as lojas atualizam automaticamente as instalacoes dos
   usuarios.

Para uma extensao carregada manualmente durante desenvolvimento, a atualizacao
nao e automatica: use **Reload** em `chrome://extensions` ou recarregue a
extensao temporaria em `about:debugging`.
