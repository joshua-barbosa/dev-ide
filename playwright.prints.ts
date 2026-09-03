// Os prints da documentação, contra o PROJETO DE TESTE.
//
// Rodam com `npm run prints`, e não com a suíte: eles não afirmam nada — só
// desenham a tela e salvam a imagem. Ficar junto deixaria a suíte mais lenta sem
// proteger nada, e um print que falha não quer dizer que a IDE quebrou.
//
// **Contra o projeto de teste, e nunca contra o dele.** Um print da máquina real
// carregaria os nomes dos servidores e bancos dele para dentro do repositório.
// Aqui a tela mostra `escola.db` e `demo`, que são de mentira.
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: '**/*.prints.ts',
  // Uma janela FIXA: print de documentação com tamanho variável fica
  // desalinhado na página, e trocar um deles depois viraria um retrabalho.
  use: { ...base.use, viewport: { width: 1440, height: 900 } },
});
