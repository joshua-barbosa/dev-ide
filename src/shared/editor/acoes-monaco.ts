// Nossos ids de comando → ids de ação do Monaco.
//
// Mora em `shared` e não na interface porque é dado puro: dois textos, nenhum
// import do Monaco. E é o que permite o teste que cruza este mapa com
// `ATENDIDOS_PELO_EDITOR` — sem isso, as duas listas divergiriam em silêncio.
//
// Existe porque estes comandos são atendidos pelo EDITOR, e não pelo mapa de
// ações do App. O atalho já chega ao Monaco sozinho; o que faltava era o clique
// no menu — sem este mapa, o item ficaria habilitado e não faria nada, que é
// pior que dizer "em breve".
export const ACAO_DO_MONACO: Readonly<Record<string, string>> = {
  'edit.find': 'actions.find',
  'edit.replace': 'editor.action.startFindReplaceAction',
  'edit.toggleComment': 'editor.action.commentLine',
  'edit.toggleBlockComment': 'editor.action.blockComment',
  'selection.expand': 'editor.action.smartSelect.expand',
  'selection.shrink': 'editor.action.smartSelect.shrink',
  'selection.copyLineUp': 'editor.action.copyLinesUpAction',
  'selection.copyLineDown': 'editor.action.copyLinesDownAction',
  'selection.moveLineUp': 'editor.action.moveLinesUpAction',
  'selection.moveLineDown': 'editor.action.moveLinesDownAction',
  'selection.duplicate': 'editor.action.duplicateSelection',
  'selection.addCursorAbove': 'editor.action.insertCursorAbove',
  'selection.addCursorBelow': 'editor.action.insertCursorBelow',
  'selection.cursorsToLineEnds': 'editor.action.insertCursorAtEndOfEachLineSelected',
  'selection.addNextOccurrence': 'editor.action.addSelectionToNextFindMatch',
  'selection.addPrevOccurrence': 'editor.action.addSelectionToPreviousFindMatch',
  'selection.allOccurrences': 'editor.action.selectHighlights',
};

// `view.wordWrap` saiu daqui na spec 011: a ação do Monaco alterna e esquece, e
// o usuário espera que a escolha sobreviva a recarregar a página. Agora ela vira
// preferência, e quem aplica é o `EditorHost` — o editor obedece, não decide.
