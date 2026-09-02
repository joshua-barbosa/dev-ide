// Baixar uma pasta remota inteira, em zip (T089).
//
// A decisão dele: *"zip do lado do navegador, com progresso e cancelar"*. Foi a
// escolha certa por um motivo que só apareceu ao implementar — o servidor não
// precisa de rota nova nenhuma para juntar arquivos, nem de espaço em disco
// para o zip temporário. Ele continua servindo um arquivo por vez, como já faz.
//
// As duas partes difíceis são puras e testadas sem navegador: a varredura
// (`shared/baixar-pasta.ts`) e a montagem do zip (`shared/zip.ts`). Aqui fica o
// que é mesmo de interface: o estado da barra, o cancelar e o salvar.
import { useCallback, useRef, useState } from 'react';
import { Api } from '../api';
import { varrerPasta, type ArquivoAchado } from '../../shared/baixar-pasta';
import { montarZip, nomeDoZip, type EntradaDeZip } from '../../shared/zip';

export type FaseDoDownload = 'parado' | 'varrendo' | 'baixando' | 'compactando';

export interface EstadoDoDownload {
  readonly fase: FaseDoDownload;
  /** O que está acontecendo agora, para a linha embaixo da barra. */
  readonly detalhe: string;
  readonly feitos: number;
  readonly total: number;
  readonly erro: string | null;
}

const PARADO: EstadoDoDownload = {
  fase: 'parado',
  detalhe: '',
  feitos: 0,
  total: 0,
  erro: null,
};

export interface ControleDeDownload {
  readonly estado: EstadoDoDownload;
  /** Baixa a pasta e salva o `.zip`. */
  baixar(conexaoId: string, pastaRemota: string): Promise<void>;
  cancelar(): void;
  limpar(): void;
}

export function useDownloadDePasta(
  onErro: (erro: unknown) => void
): ControleDeDownload {
  const [estado, setEstado] = useState<EstadoDoDownload>(PARADO);
  /**
   * O pedido de cancelar.
   *
   * Em `ref`, e não em estado: as funções puras consultam isto DENTRO do laço,
   * e um `useState` seria lido com o valor de quando o laço começou — o botão
   * de cancelar não faria nada até o download terminar sozinho.
   */
  const cancelado = useRef(false);

  const baixar = useCallback(
    async (conexaoId: string, pastaRemota: string): Promise<void> => {
      cancelado.current = false;
      setEstado({ ...PARADO, fase: 'varrendo', detalhe: pastaRemota });

      try {
        // 1. Descobrir o que existe lá dentro.
        const { arquivos, pastasVazias } = await varrerPasta(
          pastaRemota,
          (caminho) => Api.listarRemoto(conexaoId, caminho),
          {
            cancelado: () => cancelado.current,
            aoAndar: (achados, pasta) =>
              setEstado((s) => ({ ...s, detalhe: `${achados} arquivos · ${pasta}` })),
          }
        );

        if (arquivos.length === 0 && pastasVazias.length === 0) {
          setEstado({ ...PARADO, erro: 'Esta pasta está vazia.' });
          return;
        }

        // 2. Buscar os bytes, um a um.
        //
        // Um de cada vez, e não em paralelo: o SFTP tem UM canal por sessão, e
        // cem leituras simultâneas viram cem pedidos que se atropelam no mesmo
        // canal. É a mesma nota do upload, e pelo mesmo motivo.
        setEstado({
          fase: 'baixando',
          detalhe: '',
          feitos: 0,
          total: arquivos.length,
          erro: null,
        });

        const entradas: EntradaDeZip[] = pastasVazias.map((relativo) => ({
          caminho: relativo,
          dados: new Uint8Array(),
        }));

        for (const [i, arquivo] of arquivos.entries()) {
          if (cancelado.current) throw new Error('O download foi cancelado.');
          setEstado((s) => ({ ...s, feitos: i, detalhe: arquivo.relativo }));
          entradas.push(await buscar(conexaoId, arquivo));
        }

        // 3. Montar o zip.
        setEstado((s) => ({ ...s, fase: 'compactando', feitos: arquivos.length, detalhe: '' }));
        const zip = await montarZip(entradas, {
          cancelado: () => cancelado.current,
          aoProgredir: (feitos, total, caminho) =>
            setEstado((s) => ({ ...s, feitos, total, detalhe: caminho })),
        });

        salvar(zip, nomeDoZip(pastaRemota));
        setEstado(PARADO);
      } catch (erro) {
        const mensagem = (erro as Error).message;
        // Cancelar é escolha dele, e não falha: some da tela sem alarde. Já um
        // erro de verdade fica à vista, porque diz o que fazer.
        if (cancelado.current) setEstado(PARADO);
        else {
          setEstado({ ...PARADO, erro: mensagem });
          onErro(erro);
        }
      }
    },
    [onErro]
  );

  return {
    estado,
    baixar,
    cancelar: () => {
      cancelado.current = true;
    },
    limpar: () => setEstado(PARADO),
  };
}

/** Um arquivo remoto como bytes, pronto para entrar no zip. */
async function buscar(conexaoId: string, arquivo: ArquivoAchado): Promise<EntradaDeZip> {
  const dados = await Api.lerBytesRemotos(conexaoId, arquivo.caminho);
  return {
    caminho: arquivo.relativo,
    dados,
    ...(arquivo.modificadoEm === undefined ? {} : { modificadoEm: arquivo.modificadoEm }),
  };
}

/**
 * Entrega o `.zip` ao navegador.
 *
 * `revokeObjectURL` depois de um tempo, e não na hora: revogar antes de o
 * download começar cancela o próprio download em alguns navegadores. Sem
 * revogar nunca, o zip inteiro fica na memória até a aba fechar.
 */
function salvar(zip: Uint8Array, nome: string): void {
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
