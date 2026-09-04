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
import { escolherArquivoDeTexto } from '../arquivos/transferencia';

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
      const escolhido = await escolherArquivoDeTexto(['json']);
      if (escolhido === null) return;
      const texto = escolhido.texto;

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
