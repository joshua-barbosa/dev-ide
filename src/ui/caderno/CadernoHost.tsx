// Liga o Query Book ao arquivo e à execução (spec 048).
//
// O caderno vive no `meta.content` da aba, como qualquer arquivo: é isso que
// faz `Ctrl+S` e `File → Save` gravarem sem caminho especial. O que muda é a
// forma do conteúdo — JSON em vez de texto solto — e quem o edita.
import { useCallback, useState } from 'react';
import { CadernoPanel } from './CadernoPanel';
import {
  alterar,
  comoRoda,
  blocosExecutaveis,
  escreverCaderno,
  inserir,
  lerCaderno,
  mover,
  remover,
  reordenar,
  type Caderno,
  type Celula,
  type TipoDeCelula,
} from '../../shared/sql/caderno';
import type { NomeDoTema } from '../../shared/temas';
import type { Vinculo } from '../../shared/sql/vinculo';
import type { Tab } from '../../shared/tabs';

export interface CadernoHostProps {
  readonly aba: Tab;
  // A aparência do bloco acompanha a do editor: o bloco é colorido pelo mesmo
  // tokenizador e com o mesmo tema (spec 050), e dois tamanhos de fonte na
  // mesma tela seria a IDE discordando de si mesma.
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  /** Grava o conteúdo novo no `meta` da aba e a marca como não salva. */
  onMudar(id: string, conteudo: string): void;
  /** Roda um bloco de SQL. Mesmo caminho do `Run` do editor (spec 038). */
  onRodar(
    modo: 'run' | 'tab' | 'json',
    sql: string,
    caminho: string | null,
    titulo: string
  ): Promise<boolean>;
  /** Roda um bloco no runner (spec 051). A saída cai no painel `Output`. */
  onRodarCodigo(linguagem: string, codigo: string): Promise<void>;
  /** Pergunta uma linguagem; `null` se o usuário desistir. */
  onPedirLinguagem(atual: string): Promise<string | null>;
  readonly vinculo: Vinculo | null;
  onTrocarVinculo(): void;
}

export function CadernoHost({
  aba, fontSize, tabSize, tema, vinculo,
  onMudar, onRodar, onRodarCodigo, onPedirLinguagem, onTrocarVinculo,
}: CadernoHostProps) {
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

  /**
   * Roda um bloco, pelo caminho que a LINGUAGEM dele pede (spec 051, D17).
   *
   * SQL vai para a conexão do vínculo; as linguagens do runner vão para o
   * runner, e a saída cai no painel `Output` como a de rodar um arquivo.
   */
  const rodarUm = async (celula: Celula, modo: 'run' | 'tab' | 'json'): Promise<void> => {
    const destino = comoRoda(celula.linguagem);
    if (destino === 'nada' || destino === 'markdown') return;

    setRodando(celula.id);
    setErro(null);
    try {
      if (destino === 'runner') {
        await onRodarCodigo(celula.linguagem, celula.conteudo);
        return;
      }
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
      fontSize={fontSize}
      tabSize={tabSize}
      tema={tema}
      onAlterar={(id, conteudo) => aplicar(alterar(caderno, id, conteudo))}
      onAcrescentar={(tipo: TipoDeCelula, fresta) => {
        aplicar(inserir(caderno, tipo, fresta, proximo));
        setProximo((n) => n + 1);
      }}
      onRemover={(id) => aplicar(remover(caderno, id))}
      onMover={(id, direcao) => aplicar(mover(caderno, id, direcao))}
      onReordenar={(id, fresta) => {
        const novo = reordenar(caderno, id, fresta);
        // `reordenar` devolve o MESMO objeto quando nada muda; comparar por
        // identidade é o que impede um arraste inócuo de sujar o arquivo.
        if (novo !== caderno) aplicar(novo);
      }}
      onRodar={(celula, modo) => void rodarUm(celula, modo)}
      onRodarTudo={() => void rodarTudo()}
      vinculo={vinculo}
      onTrocarVinculo={onTrocarVinculo}
      onEscolherLinguagem={(id) => {
        const celula = caderno.celulas.find((c) => c.id === id);
        if (celula === undefined) return;
        void onPedirLinguagem(celula.linguagem).then((nova) => {
          if (nova !== null && nova !== celula.linguagem) {
            aplicar({
              celulas: caderno.celulas.map((c) =>
                c.id === id ? { ...c, linguagem: nova } : c
              ),
            });
          }
        });
      }}
    />
  );
}
