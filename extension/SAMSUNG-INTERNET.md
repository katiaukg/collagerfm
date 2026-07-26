# Samsung Internet

## Situacao atual

O Samsung Internet para Android nao oferece instalacao livre de WebExtensions
por pasta, ZIP ou XPI. Extensoes de terceiros precisam:

1. Participar do programa de extensoes do Samsung Internet.
2. Ser convertidas em um aplicativo Android usando as ferramentas fornecidas
   pela Samsung aos desenvolvedores aceitos.
3. Passar pela validacao da Samsung.
4. Ser distribuidas pela Galaxy Store.

Por isso, a pasta `extension` nao pode ser instalada diretamente no Samsung
Internet como acontece no Chrome desktop ou no Firefox.

## Portabilidade do collager.fm

O codigo atual foi mantido sobre APIs WebExtensions/Chromium (`runtime`,
`tabs`, `scripting` e content scripts), o que reduz o trabalho de portabilidade
caso a Samsung aprove o projeto. O empacotamento Android e os ajustes finais
dependem do SDK e das permissoes disponibilizadas pela Samsung no programa.

Documentacao oficial:

- https://developer.samsung.com/internet/android/extension-guide.html
- https://developer.samsung.com/internet/android/extensions-dev-overview.html

Contato indicado pela Samsung para extensoes:

- browser@samsung.com
