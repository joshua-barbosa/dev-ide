// Liga o Query Book ao arquivo e à execução (spec 048).
//
// O caderno vive no `meta.content` da aba, como qualquer arquivo: é isso que
// faz `Ctrl+S` e `File → Save` gravarem sem caminho especial. O que muda é a
// forma do conteúdo — JSON em vez de texto solto — e quem o edita.
import { useCallback, useState } from 'react';
import { CadernoPanel } from './CadernoPanel';
import {
  acrescentar,
  alterar,
  blocosExecutaveis,
  escreverCaderno,
  lerCaderno,
  mover,
  remover,
  type Caderno,
  type Celula,
  type TipoDeCelula,
} from '../../shared/sql/caderno';
import type { Tab } from '../../shared/tabs';

export interface CadernoHostProps {
  readonly aba: Tab;
  /** Grava o conteúdo novo no `meta` da aba e a marca como não salva. */
  onMudar(id: string, conteudo: string): void;
  /** Roda um bloco. Mesmo caminho do `Run` do editor (spec 038). */
  onRodar(
    modo: 'run' | 'tab' | 'json',
    sql: string,
    caminho: string | null,
    titulo: string
  ): Promise<boolean>;
}

export function CadernoHost({ aba, onMudar, onRodar }: CadernoHostProps) {
  const meta = aba.meta as { content?: string; path?: string | null };
  const caderno = lerCaderno(meta.content ?? '');

  const [rodando, setRodando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Contador só para dar id a bloco novo. Nasce do tamanho para não colidir com
  // os que vieram do arquivo, que são `c0`, `c1`, …
  const [proximo, setProximo] = useState(caderno.celulas.length);

  const aplicar = useCallback(
    (novo: Caderno) => onMudar(aba.id, escreverCaderno(novo)),
    [aba.id, onMudar]
  );

  const rodarUm = async (celula: Celula, modo: 'run' | 'tab' | 'json'): Promise<void> => {
    setRodando(celula.id);
    setErro(null);
    try {
      // O erro já vira aba de resultado e entra em `Problems`; aqui só se marca
      // que este bloco não passou.
      if (!(await onRodar(modo, celula.conteudo, meta.path ?? null, aba.title))) {
        setErro('O bloco falhou — veja o resultado ou a aba Problems.');
      }
    } finally {
      setRodando(null);
    }
  };

  /**
   * Roda os blocos em ordem, parando no primeiro erro.
   *
   * Um caderno é uma sequência: o bloco 5 costuma depender do 4. Seguir depois
   * de falhar produziria resultados que não querem dizer nada — e o pior tipo
   * de resultado é o que parece certo.
   */
  const rodarTudo = async (): Promise<void> => {
    setErro(null);
    for (const celula of blocosExecutaveis(caderno)) {
      setRodando(celula.id);
      const deuCerto = await onRodar('tab', celula.conteudo, meta.path ?? null, aba.title);
      if (!deuCerto) {
        setErro(
          `Parou no bloco "${celula.conteudo.slice(0, 40)}…". ` +
            'Veja o resultado dele ou a aba Problems.'
        );
        break;
      }
    }
    setRodando(null);
  };

  return (
    <CadernoPanel
      caderno={caderno}
      rodando={rodando}
      erro={erro}
      onAlterar={(id, conteudo) => aplicar(alterar(caderno, id, conteudo))}
      onAcrescentar={(tipo: TipoDeCelula, depoisDe) => {
        aplicar(acrescentar(caderno, tipo, depoisDe, proximo));
        setProximo((n) => n + 1);
      }}
      onRemover={(id) => aplicar(remover(caderno, id))}
      onMover={(id, direcao) => aplicar(mover(caderno, id, direcao))}
      onRodar={(celula, modo) => void rodarUm(celula, modo)}
      onRodarTudo={() => void rodarTudo()}
    />
  );
}
