// A largura das colunas de UMA grade (spec 062, fase C).
//
// O arrasto vive num `ref`, e não em estado: mover o mouse dispara dezenas de
// eventos por segundo, e repintar a tabela inteira a cada um deles engasga numa
// página de 500 linhas. O estado só muda quando a largura muda de verdade.
import { useCallback, useRef, useState } from 'react';
import {
  aoArrastar, definir, esquecer, larguraDoConteudo, type Larguras,
} from '../../shared/grade/larguras';

export interface ControleDeLarguras {
  readonly larguras: Larguras;
  /**
   * A largura ESCOLHIDA daquela coluna, ou `undefined` se ninguém a escolheu.
   *
   * `undefined` de propósito: quem desenha sabe o conteúdo e calcula a largura
   * automática; o gancho só guarda o que o usuário decidiu.
   */
  larguraDe(coluna: string): number | undefined;
  /** Começa a arrastar a alça daquela coluna, partindo da largura na tela. */
  comecar(coluna: string, xInicial: number, larguraPintada: number): void;
  /** Duplo clique na alça: ajusta ao conteúdo visível. */
  ajustar(coluna: string, textos: readonly string[], porCaractere: number): void;
}

export function useLarguras(): ControleDeLarguras {
  const [larguras, setLarguras] = useState<Larguras>({});
  const arrasto = useRef<{ coluna: string; x: number; inicial: number } | null>(null);
  // O estado mais recente, para os ouvintes de `window` não lerem uma cópia
  // velha — eles são registrados uma vez e sobrevivem a várias renderizações.
  const atuais = useRef<Larguras>(larguras);
  atuais.current = larguras;

  const comecar = useCallback((coluna: string, xInicial: number, larguraPintada: number) => {
    arrasto.current = {
      coluna,
      x: xInicial,
      // Sem largura escolhida, o arrasto parte da que está PINTADA — senão a
      // coluna daria um salto no primeiro pixel de movimento.
      inicial: atuais.current[coluna] ?? larguraPintada,
    };

    const mover = (e: MouseEvent): void => {
      const a = arrasto.current;
      if (a === null) return;
      // `preventDefault` porque arrastar sobre uma tabela seleciona texto, e
      // texto selecionado sob o cursor pinta a tela inteira de azul.
      e.preventDefault();
      setLarguras((atual) => definir(atual, a.coluna, aoArrastar(a.inicial, e.clientX - a.x)));
    };
    const soltar = (): void => {
      arrasto.current = null;
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    // Em `window`, e não na alça: o mouse anda mais rápido que o navegador
    // repinta, e sai de cima da alça no meio do arrasto. Ouvir só nela faria a
    // coluna "escapar" do cursor.
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
    // O cursor de redimensionar vale para a tela inteira enquanto arrasta.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return {
    larguras,
    larguraDe: (coluna) => larguras[coluna],
    comecar,
    ajustar: (coluna, textos, porCaractere) =>
      setLarguras((atual) => {
        const cabe = larguraDoConteudo(textos, porCaractere);
        // Duplo clique numa coluna já ajustada devolve o automático: é o
        // desfazer natural do gesto, e sem ele não haveria como voltar.
        return atual[coluna] === cabe ? esquecer(atual, coluna) : definir(atual, coluna, cabe);
      }),
  };
}
