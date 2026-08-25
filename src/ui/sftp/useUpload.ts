// Arrastar de fora para dentro (spec 060).
//
// Ler uma PASTA de um arraste só é possível por uma API não padronizada —
// `webkitGetAsEntry` — que o Chrome, o Edge e o Firefox implementam e nenhuma
// especificação obriga. Não há alternativa: o `File` que o `dataTransfer.files`
// entrega para uma pasta é um objeto vazio, sem conteúdo e sem filhos.
//
// Por isso a leitura fica isolada aqui, e a parte que decide caminho é pura e
// testada em `shared/remoto/upload.ts`.
import { useCallback, useState } from 'react';
import { Api } from '../api';
import { destinosDe, seguros, totalDeBytes, type ArquivoParaSubir } from '../../shared/remoto/upload';

/** Teto de arquivos por arraste. Uma `node_modules` tem centenas de milhares. */
export const MAX_ARQUIVOS_POR_ARRASTE = 2_000;

interface ArquivoLido extends ArquivoParaSubir {
  readonly file: File;
}

/** O que o `webkitGetAsEntry` devolve, sem depender de tipos do DOM que variam. */
interface EntradaDoArraste {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  file?(pronto: (f: File) => void, erro: (e: unknown) => void): void;
  createReader?(): {
    readEntries(pronto: (e: EntradaDoArraste[]) => void, erro: (x: unknown) => void): void;
  };
}

function comoArquivo(entrada: EntradaDoArraste): Promise<File | null> {
  return new Promise((resolver) => {
    if (typeof entrada.file !== 'function') {
      resolver(null);
      return;
    }
    entrada.file(resolver, () => resolver(null));
  });
}

/**
 * Lê uma pasta inteira.
 *
 * `readEntries` devolve **em lotes** — historicamente 100 por chamada —, e
 * parar no primeiro lote é o engano clássico: uma pasta com 150 arquivos subiria
 * 100 e ninguém notaria os outros 50. Por isso o laço até vir vazio.
 */
async function lerPasta(entrada: EntradaDoArraste): Promise<EntradaDoArraste[]> {
  const leitor = entrada.createReader?.();
  if (leitor === undefined) return [];
  const tudo: EntradaDoArraste[] = [];
  for (;;) {
    const lote = await new Promise<EntradaDoArraste[]>((resolver) => {
      leitor.readEntries(resolver, () => resolver([]));
    });
    if (lote.length === 0) break;
    tudo.push(...lote);
  }
  return tudo;
}

async function percorrer(
  entrada: EntradaDoArraste,
  prefixo: string,
  achados: ArquivoLido[]
): Promise<void> {
  if (achados.length >= MAX_ARQUIVOS_POR_ARRASTE) return;
  const relativo = prefixo === '' ? entrada.name : `${prefixo}/${entrada.name}`;

  if (entrada.isFile) {
    const file = await comoArquivo(entrada);
    if (file !== null) achados.push({ relativo, bytes: file.size, file });
    return;
  }
  if (!entrada.isDirectory) return;
  for (const filho of await lerPasta(entrada)) {
    await percorrer(filho, relativo, achados);
  }
}

export interface EstadoDoUpload {
  readonly enviando: boolean;
  readonly enviados: number;
  readonly total: number;
  readonly bytesTotais: number;
  readonly recusados: readonly string[];
  readonly erro: string | null;
}

const PARADO: EstadoDoUpload = {
  enviando: false,
  enviados: 0,
  total: 0,
  bytesTotais: 0,
  recusados: [],
  erro: null,
};

export interface ControleDeUpload {
  readonly estado: EstadoDoUpload;
  /** Trata o `drop`. Devolve quantos arquivos subiram. */
  soltar(e: React.DragEvent, conexaoId: string, pastaRemota: string): Promise<number>;
  limpar(): void;
}

export function useUpload(aoTerminar: () => void): ControleDeUpload {
  const [estado, setEstado] = useState<EstadoDoUpload>(PARADO);

  const soltar = useCallback(
    async (e: React.DragEvent, conexaoId: string, pastaRemota: string): Promise<number> => {
      const itens = [...e.dataTransfer.items]
        .map((i) => (i as unknown as { webkitGetAsEntry?: () => EntradaDoArraste | null })
          .webkitGetAsEntry?.() ?? null)
        .filter((x): x is EntradaDoArraste => x !== null);
      if (itens.length === 0) return 0;

      const achados: ArquivoLido[] = [];
      for (const item of itens) await percorrer(item, '', achados);

      const { ok, recusados } = seguros(destinosDe(pastaRemota, achados), pastaRemota);
      const porRelativo = new Map(achados.map((a) => [a.relativo, a.file]));

      setEstado({
        enviando: true,
        enviados: 0,
        total: ok.length,
        bytesTotais: totalDeBytes(achados),
        recusados,
        erro: null,
      });

      let enviados = 0;
      try {
        for (const alvo of ok) {
          const file = porRelativo.get(alvo.relativo);
          if (file === undefined) continue;
          // Um de cada vez, e não todos em paralelo: o SFTP e o FTP têm um
          // canal só, e cem gravações simultâneas viram cem canais que o
          // servidor recusa — ou aceita e engasga.
          await Api.enviarArquivoRemoto(conexaoId, alvo.destino, await file.arrayBuffer());
          enviados += 1;
          setEstado((s) => ({ ...s, enviados }));
        }
        setEstado((s) => ({ ...s, enviando: false }));
      } catch (erro) {
        // O que já subiu, subiu: dizer quantos foram é mais útil que dizer que
        // "falhou", porque o usuário precisa saber o que refazer.
        setEstado((s) => ({ ...s, enviando: false, erro: (erro as Error).message }));
      }
      aoTerminar();
      return enviados;
    },
    [aoTerminar]
  );

  return { estado, soltar, limpar: () => setEstado(PARADO) };
}
