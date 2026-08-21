// As ações da caixa de comandos salvos (spec 018).
//
// Saiu do `App` quando ele passou de mil linhas — o teto do Artigo IV é 800, e
// eu o estourei um item de cada vez. O critério do corte: cada arquivo daqui
// junta os fluxos de **um assunto**, com as dependências recebidas de fora. Nada
// de estado próprio; o estado continua nos ganchos de sempre.
import { Api } from '../api';
import type { QuickInputController } from '../useQuickInput';

export interface ComandosAcoesDeps {
  readonly qi: QuickInputController;
  avisar(mensagem: string, titulo?: string): Promise<void>;
  /** Abre um terminal no painel e roda o comando nele. */
  rodarNoTerminal(comando: string): void;
}

export interface ComandosAcoes {
  /** A caixa do `Run Task…`: descobertos, salvos e a gestão. */
  abrir(): Promise<void>;
}

export function useComandosAcoes(deps: ComandosAcoesDeps): ComandosAcoes {
  const { qi, avisar, rodarNoTerminal } = deps;

  /**
   * A caixa de comandos salvos — o que era `Run Task…`.
   *
   * Descobertos e salvos na mesma lista, mais duas entradas de gestão. Uma tela
   * de gerenciamento seria mais interface que conteúdo: o usuário tem poucos
   * comandos.
   */
  const abrir = async (): Promise<void> => {
    const { salvos, descobertos } = await Api.commands();

    const escolhido = await qi.pedir({
      titulo: 'Comandos',
      placeholder: 'Escolha um comando',
      opcoes: [
        ...descobertos.map((c) => ({
          valor: `rodar:shell:${c.comando}`,
          rotulo: c.nome,
          detalhe: `${c.comando}  ·  ${c.origem}`,
          icone: 'lucide:play',
        })),
        ...salvos.map((c) => ({
          valor: `rodar:shell:${c.comando}`,
          rotulo: c.nome,
          detalhe: c.comando,
          icone: 'lucide:square-terminal',
          sufixo: 'salvo',
        })),
        { valor: 'novo:', rotulo: 'Salvar um comando novo…', icone: 'lucide:plus' },
        ...(salvos.length === 0
          ? []
          : [{ valor: 'remover:', rotulo: 'Remover um comando salvo…', icone: 'lucide:trash-2' }]),
      ],
    });
    if (escolhido === null) return;

    const separador = escolhido.indexOf(':');
    const verbo = escolhido.slice(0, separador);
    const resto = escolhido.slice(separador + 1);

    if (verbo === 'novo') return salvar();
    if (verbo === 'remover') return remover();

    // O prefixo `shell:` continua no valor por compatibilidade com o formato,
    // mas é o único destino desde a spec 039 — SQL salvo virou arquivo na pasta
    // `Query` da conexão (decisão D3).
    rodarNoTerminal(resto.slice(resto.indexOf(':') + 1));
  };

  /** Cria um comando salvo, avisando sobre senha em texto puro. */
  const salvar = async (): Promise<void> => {
    const nome = await qi.pedir({
      titulo: 'Novo comando salvo',
      placeholder: 'Nome, ex.: subir homologação',
    });
    if (nome === null) return;

    const comando = await qi.pedir({
      titulo: `Comando de "${nome}"`,
      placeholder: 'ex.: npm run deploy',
    });
    if (comando === null) return;

    // Não há mais o que perguntar sobre destino: só existe um, e um diálogo
    // com uma opção é ruído. Ver a decisão D3 na spec 039.
    await Api.createCommand(nome, comando, 'shell');
    // O aviso é o que se deve ao usuário: o `commands.json` não é o cofre.
    await avisar(
      `"${nome}" foi salvo e vale em qualquer pasta.\n\n` +
        'Atenção: comandos salvos ficam em ~/.dev-ide/commands.json em texto puro. ' +
        'Não guarde senha dentro de um.',
      'Comando salvo'
    );
  };

  const remover = async (): Promise<void> => {
    const { salvos } = await Api.commands();
    const escolhido = await qi.pedir({
      titulo: 'Remover comando salvo',
      placeholder: 'Escolha o que remover',
      opcoes: salvos.map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.comando })),
    });
    if (escolhido === null) return;
    await Api.deleteCommand(escolhido);
  };


  return { abrir };
}
