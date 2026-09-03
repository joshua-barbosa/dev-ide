// A ação de IMPORTAR conexões (N001).
//
// Saiu do `ConnectionsPanel` porque ele bateu no teto de 800 linhas do Artigo IV
// — e porque é um assunto fechado: ler um arquivo de fora, mostrar o que vai
// acontecer, e só então gravar.
//
// A leitura e o plano moram em `shared/importar-conexoes.ts`, testados sem
// navegador: é ali que se erra, porque o arquivo veio de fora.
import { AcaoDoPainel } from './AcaoDoPainel';
import { Api } from '../api';
import {
  lerArquivoDeConexoes, planoDeImportacao, resumoDoPlano,
} from '../../shared/importar-conexoes';
import type { ConnectionsController } from './useConnections';

export interface AcaoDoImportarProps {
  readonly ctrl: ConnectionsController;
  readonly confirmar: (o: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
  }) => Promise<boolean>;
  readonly avisar: (mensagem: string, titulo?: string) => Promise<void>;
  readonly onErro: (erro: unknown) => void;
}

/**
 * Pede um `.json` ao usuário e devolve o conteúdo — `null` se ele desistir.
 *
 * `<input type="file">` criado na hora e descartado: um input escondido fixo no
 * DOM guardaria o arquivo anterior, e reimportar o mesmo arquivo duas vezes não
 * dispararia o `change` na segunda vez. É um defeito clássico deste elemento.
 */
async function pedirArquivoJson(): Promise<string | null> {
  return new Promise((resolver) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const arquivo = input.files?.[0];
      if (arquivo === undefined) {
        resolver(null);
        return;
      }
      arquivo.text().then(resolver, () => resolver(null));
    };
    // `cancel` existe nos navegadores atuais; sem ele a promessa ficaria
    // pendente para sempre quando ele fechasse o diálogo.
    input.oncancel = () => resolver(null);
    input.click();
  });
}

export function AcaoDoImportar({ ctrl, confirmar, avisar, onErro }: AcaoDoImportarProps) {
  const destrancado = ctrl.estado?.vault.unlocked === true;
  const comErro = (acao: () => Promise<void>) => () => {
    acao().catch(onErro);
  };

  return (
  <AcaoDoPainel
    icone="lucide:hard-drive-upload"
    rotulo="Importar conexões de um arquivo"
    desabilitada={!destrancado}
    onClick={comErro(async () => {
      const texto = await pedirArquivoJson();
      if (texto === null) return;

      const lido = lerArquivoDeConexoes(texto, [...ctrl.drivers.keys()]);
      if ('erro' in lido) {
        await avisar(lido.erro, 'Não deu para importar');
        return;
      }

      // A PRÉVIA antes de aplicar — a regra da casa desde a spec 079.
      // Importar às cegas por cima de um cofre com conexões de produção
      // seria o pior lugar possível para uma surpresa.
      const plano = planoDeImportacao(
        ctrl.todasAsConexoes().map((c) => ({ id: c.id, label: c.label, group: c.group })),
        lido.conexoes,
        'manter-as-duas'
      );
      const conflitos = plano.filter((d) => d.idExistente !== undefined).length;

      const ok = await confirmar({
        titulo: 'Importar conexões',
        mensagem:
          `${lido.conexoes.length} conexão(ões) no arquivo — ${resumoDoPlano(plano)}.` +
          (conflitos > 0
            ? '\n\nAs repetidas entram LADO A LADO com as que já existem: ' +
              'nada é apagado. Se quiser substituir, apague as antigas depois.'
            : ''),
        rotuloConfirmar: 'importar',
      });
      if (!ok) return;

      const r = await Api.importarConexoes(lido.conexoes, 'manter-as-duas');
      await ctrl.recarregar();
      await avisar(
        `${r.criadas} importada(s)` +
          (r.substituidas > 0 ? `, ${r.substituidas} substituída(s)` : '') +
          (r.puladas > 0 ? `, ${r.puladas} pulada(s)` : '') +
          '.',
        'Conexões importadas'
      );
    })}
  />
  );
}
