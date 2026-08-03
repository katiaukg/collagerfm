'use strict';

(() => {
  const STORAGE_KEY = 'collager.fm.extension-language.v1';
  const EN = {
    'Entrar em collager.fm': 'Open collager.fm',
    'Idioma': 'Language',
    'Em breve': 'Coming soon',
    'Histórico manual': 'Manual history',
    'Histórico automatizado': 'Automatic history',
    'Alterados automatizado': 'Automatically changed',
    'Apagados automatizado': 'Automatically deleted',
    'Posição padrão popup extensão': 'Default extension popup position',
    'Posição padrão': 'Default position',
    'Abaixo à esquerda': 'Bottom left',
    'Abaixo à direita': 'Bottom right',
    'Acima à esquerda': 'Top left',
    'Acima à direita': 'Top right',
    'Histórico da extensão - collager.fm': 'Extension history - collager.fm',
    'Extensão collager.fm': 'collager.fm extension',
    'Atividade e regras automáticas': 'Activity and automatic rules',
    'Excluir histórico': 'Delete history',
    'Manual': 'Manual',
    'Automático': 'Automatic',
    'Ambos': 'Both',
    'manual': 'manual',
    'automático': 'automatic',
    'completo': 'full',
    'alteração automática': 'automatic change',
    'exclusão automática': 'automatic deletion',
    'Seções da extensão': 'Extension sections',
    'Histórico': 'History',
    'Alterados': 'Changed',
    'Apagados': 'Deleted',
    'Operações': 'Operations',
    'Histórico completo': 'Full history',
    'Tipo de histórico': 'History type',
    'Todos': 'All',
    'Regras automáticas': 'Automatic rules',
    'Metadatas alterados': 'Changed metadata',
    'Metadatas apagados': 'Deleted metadata',
    'Ação da extensão': 'Extension action',
    'Concluída': 'Completed',
    'Erro': 'Error',
    'Este scrobble foi recolocado no Last.fm.': 'This scrobble was restored on Last.fm.',
    'Ativada': 'Enabled',
    'Desativada': 'Disabled',
    'Metadata sem nome': 'Unnamed metadata',
    'A extensão ainda não registrou nenhuma ação neste filtro.': 'The extension has not recorded any actions in this filter yet.',
    'Nenhuma correção automática foi configurada.': 'No automatic correction has been configured.',
    'Nenhuma exclusão automática foi configurada.': 'No automatic deletion has been configured.',
    'Abra o collager.fm em outra aba para alterar esta regra.': 'Open collager.fm in another tab to change this rule.',
    'Abra o collager.fm em outra aba para excluir esta regra.': 'Open collager.fm in another tab to delete this rule.',
    'Histórico da extensão': 'Extension history',
    'Configurações da extensão': 'Extension settings',
    'Nenhuma ação registrada': 'No recorded actions',
    'A extensão ainda não registrou nenhuma ação.': 'The extension has not recorded any actions yet.',
    'Abrir histórico da extensão': 'Open extension history',
    'Abrir visão completa': 'Open full view',
    'Página anterior': 'Previous page',
    'Próxima página': 'Next page',
    'Ação anterior': 'Previous action',
    'Ação seguinte': 'Next action',
    'RECOLOCAR SCROBBLE': 'RESTORE SCROBBLE',
    'RECOLOCANDO...': 'RESTORING...',
    'Scrobble excluído': 'Scrobble deleted',
    'Obsessão excluída': 'Obsession deleted',
    'Obsessão atualizada': 'Obsession updated',
    'Edição salva': 'Edit saved',
    'Edição incompleta': 'Incomplete edit',
    'Correção automática aplicada': 'Automatic correction applied',
    'Correção automática incompleta': 'Incomplete automatic correction',
    'O scrobble corrigido foi salvo e o registro original foi removido.': 'The corrected scrobble was saved and the original record was removed.',
    'A extensão não concluiu esta ação.': 'The extension did not complete this action.',
    'Recolocar este scrobble no Last.fm com os dados e horário originais?': 'Restore this scrobble on Last.fm with its original data and timestamp?',
    'Scrobble recolocado com sucesso.': 'Scrobble restored successfully.',
    'Não foi possível recolocar o scrobble.': 'Could not restore the scrobble.',
    'O scrobble nao possui usuario, artista, faixa e horario validos.': 'The scrobble does not have a valid user, artist, track and timestamp.',
    'O endereco desta obsessao e invalido.': 'This obsession address is invalid.',
    'A obsessao nao pertence ao usuario informado.': 'The obsession does not belong to the specified user.',
    'Informe usuario, artista e faixa para definir a obsessao.': 'Enter a user, artist and track to set the obsession.',
    'O Last.fm demorou demais para abrir.': 'Last.fm took too long to open.',
    'O Last.fm demorou demais para concluir esta ação.': 'Last.fm took too long to complete this action.',
    'Conferindo os dados do scrobble...': 'Checking scrobble data...',
    'Procurando uma sessão aberta do Last.fm...': 'Looking for an open Last.fm session...',
    'Abrindo o Last.fm em segundo plano...': 'Opening Last.fm in the background...',
    'Sessão do Last.fm localizada.': 'Last.fm session found.',
    'Aguardando o Last.fm ficar pronto...': 'Waiting for Last.fm to be ready...',
    'Localizando e excluindo o registro...': 'Finding and deleting the record...',
    'O Last.fm nao confirmou a exclusao.': 'Last.fm did not confirm the deletion.',
    'Exclusão confirmada pelo Last.fm.': 'Deletion confirmed by Last.fm.',
    'Scrobble excluído com sucesso.': 'Scrobble deleted successfully.',
    'Conferindo os dados da obsessão...': 'Checking obsession data...',
    'Abrindo a obsessão em segundo plano...': 'Opening the obsession in the background...',
    'Localizando e excluindo a obsessão...': 'Finding and deleting the obsession...',
    'O Last.fm nao confirmou a exclusao da obsessao.': 'Last.fm did not confirm the obsession deletion.',
    'Obsessão excluída com sucesso.': 'Obsession deleted successfully.',
    'Conferindo a faixa escolhida...': 'Checking the selected track...',
    'Abrindo a faixa em segundo plano...': 'Opening the track in the background...',
    'Enviando a nova obsessão...': 'Sending the new obsession...',
    'O Last.fm nao confirmou a nova obsessao.': 'Last.fm did not confirm the new obsession.',
    'Alteração confirmada pelo Last.fm.': 'Change confirmed by Last.fm.',
    'Obsessão atualizada com sucesso.': 'Obsession updated successfully.',
    'Preparando a extensão...': 'Preparing the extension...',
    'A extensão começou a operação.': 'The extension started the operation.',
    'Não foi possível abrir a visão completa.': 'Could not open the full view.',
    'Origem nao autorizada.': 'Unauthorized origin.',
    'Acao nao permitida.': 'Action not allowed.',
    'A extensão não concluiu a operação.': 'The extension did not complete the operation.',
    'A extensao nao concluiu a operacao.': 'The extension did not complete the operation.',
    'Site está temporariamente inacessível.': 'The site is temporarily unavailable.',
    'O Last.fm demorou demais para responder.': 'Last.fm took too long to respond.',
    'Dados do scrobble invalidos.': 'Invalid scrobble data.',
    'Entre na sua conta no Last.fm nesta aba e tente novamente.': 'Sign in to your Last.fm account in this tab and try again.',
    'Sua sessao do Last.fm expirou. Entre novamente e repita a operacao.': 'Your Last.fm session expired. Sign in again and repeat the operation.',
    'O Last.fm limitou as exclusoes temporariamente. Aguarde alguns segundos e tente novamente.': 'Last.fm temporarily limited deletions. Wait a few seconds and try again.',
    'O Last.fm nao confirmou a exclusao do scrobble.': 'Last.fm did not confirm the scrobble deletion.',
    'Endereco da obsessao invalido.': 'Invalid obsession address.',
    'Entre na conta dona desta obsessao no Last.fm e tente novamente.': 'Sign in to the Last.fm account that owns this obsession and try again.',
    'O Last.fm limitou a exclusao temporariamente. Aguarde alguns segundos e tente novamente.': 'Last.fm temporarily limited deletion. Wait a few seconds and try again.',
    'O Last.fm manteve a obsessao depois da tentativa de exclusao.': 'Last.fm kept the obsession after the deletion attempt.',
    'Dados da faixa invalidos.': 'Invalid track data.',
    'O Last.fm não exibiu o controle de obsessão. A página da faixa foi aberta para você concluir a ação.': 'Last.fm did not show the obsession control. The track page was opened so you can complete the action.',
    'Sua sessão do Last.fm expirou. Entre novamente e repita a operação.': 'Your Last.fm session expired. Sign in again and repeat the operation.',
    'O Last.fm limitou esta ação temporariamente. Aguarde alguns segundos e tente novamente.': 'Last.fm temporarily limited this action. Wait a few seconds and try again.',
    'Falha ao excluir o scrobble.': 'Failed to delete the scrobble.',
    'Falha ao excluir a obsessao.': 'Failed to delete the obsession.',
    'Falha ao definir a obsessao.': 'Failed to set the obsession.'
  };

  const normalizeLocale = value => String(value || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
  let locale = 'en-US';
  const patterns = [
    [/^(\d+) de (\d+)$/, '$1 of $2'],
    [/^Ativa desde (.+)$/, 'Active since $1'],
    [/^Álbum: (.+)$/, 'Album: $1'],
    [/^Mesmo metadata de (.+)$/, 'Same metadata as $1'],
    [/^Excluir operação de (.+)$/, 'Delete operation for $1'],
    [/^Ativar ou desativar (.+)$/, 'Enable or disable $1'],
    [/^Deseja excluir o histórico (.+) da extensão\?$/, 'Do you want to delete the extension $1 history?'],
    [/^Deseja excluir a operação de (.+) para (.+)\?$/, 'Do you want to delete the $1 operation for $2?'],
    [/^Aguardando a vez da extensão — posição (\d+)\.$/, 'Waiting for the extension — queue position $1.'],
    [/^O Last\.fm respondeu (\d+) ao excluir o scrobble\.$/, 'Last.fm returned $1 while deleting the scrobble.'],
    [/^O Last\.fm respondeu (\d+) ao abrir a obsessão\.$/, 'Last.fm returned $1 while opening the obsession.'],
    [/^O Last\.fm respondeu (\d+) ao excluir a obsessão\.$/, 'Last.fm returned $1 while deleting the obsession.'],
    [/^O Last\.fm respondeu (\d+) ao abrir a faixa\.$/, 'Last.fm returned $1 while opening the track.'],
    [/^O Last\.fm respondeu (\d+) ao definir a obsessão\.$/, 'Last.fm returned $1 while setting the obsession.']
  ];

  function t(value, forcedLocale = locale) {
    const text = String(value ?? '');
    if (normalizeLocale(forcedLocale) !== 'en-US') return text;
    if (EN[text]) return EN[text];
    for (const [pattern, replacement] of patterns) if (pattern.test(text)) return text.replace(pattern, replacement);
    return text;
  }

  function apply(root = typeof document !== 'undefined' ? document : null) {
    if (!root || typeof document === 'undefined') return;
    if (document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(node => {
      const translated = t(node.dataset.i18nTitle);
      node.title = translated;
      node.setAttribute('aria-label', translated);
    });
  }

  function setLocale(value, persist = true) {
    locale = normalizeLocale(value);
    if (persist && globalThis.chrome?.storage?.local) chrome.storage.local.set({ [STORAGE_KEY]: locale });
    apply();
    return locale;
  }

  function init(preferredLocale) {
    if (preferredLocale) return Promise.resolve(setLocale(preferredLocale, false));
    if (!globalThis.chrome?.storage?.local) return Promise.resolve(setLocale(locale, false));
    return new Promise(resolve => chrome.storage.local.get(STORAGE_KEY, result => {
      resolve(setLocale(result?.[STORAGE_KEY] || locale, false));
    }));
  }

  globalThis.ExtI18n = { STORAGE_KEY, t, apply, init, setLocale, get locale() { return locale; } };
})();
