// Liga o Query Book ao arquivo e à execução (spec 048).
//
// O caderno vive no `meta.content` da aba, como qualquer arquivo: é isso que
// faz `Ctrl+S` e `File → Save` gravarem sem caminho especial. O que muda é a
// forma do conteúdo — JSON em vez de texto solto — e quem o edita.
import { useCallback, useState } from 'react';
import type { QueryResult } from '../../shared/contracts';
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
  removerResultado,
  reordenar,
  salvarResultado,
  type Caderno,
  type Celula,
  type ResultadoSalvo,
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
  ): Promise<QueryResult | null>;
  /** Roda um bloco no runner (spec 051). A saída cai no painel `Output`. */
  onRodarCodigo(linguagem: string, codigo: string): Promise<void>;
  /** Pergunta uma linguagem; `null` se o usuário desistir. */
  onPedirLinguagem(atual: string): Promise<string | null>;
  /** Pergunta o nome do resultado a salvar; `null` se ele desistir (T072). */
  onPedirNome(sqlDoBloco: string): Promise<string | null>;
  /** Abre um resultado GUARDADO numa aba de grade (T072). */
  onAbrirResultadoSalvo(titulo: string, resultado: ResultadoSalvo): void;
  readonly vinculo: Vinculo | null;
  onTrocarVinculo(): void;
}

export function CadernoHost({
  aba, fontSize, tabSize, tema, vinculo,
  onMudar, onRodar, onRodarCodigo, onPedirLinguagem, onTrocarVinculo,
  onPedirNome, onAbrirResultadoSalvo,
}: CadernoHostProps) {
  const meta = aba.meta as { content?: string; path?: string | null };
  const caderno = lerCaderno(meta.content ?? '');

  const [rodando, setRodando] = useState<string | null>(null);
  /** O último resultado de cada bloco, só na memória desta aba (T072). */
  const [ultimos, setUltimos] = useState<ReadonlyMap<string, QueryResult>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  // Contador só para dar id a bloco novo. Nasce do tamanho para não colidir com
  // os que vieram do arquivo, que são `c0`, `c1`, …
  const [proximo, setProximo] = useState(caderno.celulas.length);

  const aplicar = useCallback(
    (novo: Caderno) => onMudar(aba.id, escreverCaderno(novo)),
    [aba.id, onMudar]
  );

  /**
   * Roda um bloco, pelo caminho que a LINGUAGEM dele pede (spec 051, D19).
   *
   * SQL vai para a conexão do vínculo; as linguagens do runner vão para o
   * runner, e a saída cai no painel `Output` como a de rodar um arquivo.
   */
  const rodarUm = async (celula: Celula, modo: 'run' | 'tab' | 'json'): Promise<void> => {
    const destino = comoRoda(celula.linguagem);
    if (destino === 'nada' || destino === 'markdown') return;
    // Bloco vazio não é falha: pular aqui é o que deixa o `null` de
    // `onRodar` querer dizer uma coisa só — deu erro.
    if (celula.conteudo.trim() === '') return;

    setRodando(celula.id);
    setErro(null);
    try {
      if (destino === 'runner') {
        await onRodarCodigo(celula.linguagem, celula.conteudo);
        return;
      }
      // O erro já vira aba de resultado e entra em `Problems`; aqui só se marca
      // que este bloco não passou.
      const resultado = await onRodar(modo, celula.conteudo, meta.path ?? null, aba.title);
      if (resultado === null) {
        setErro('O bloco falhou — veja o resultado ou a aba Problems.');
        return;
      }
      // O último resultado DESTE bloco fica à mão, e é o que o "salvar no
      // caderno" guarda (T072). Na memória, e não no arquivo: salvar toda
      // execução é justamente o que ele recusou na triagem.
      setUltimos((atual) => new Map(atual).set(celula.id, resultado));
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
      temUltimoResultado={(id) => ultimos.has(id)}
      onSalvarResultado={(celula) => {
        const resultado = ultimos.get(celula.id);
        if (resultado === undefined) return;
        // O NOME é dele — foi o pedido, com todas as letras: "com um nome que
        // eu der". Sem nome não se salva; um `resultado 1` automático seria eu
        // decidindo de novo.
        void onPedirNome(celula.conteudo).then((nome) => {
          if (nome === null || nome.trim() === '') return;
          aplicar(
            salvarResultado(caderno, celula.id, {
              nome: nome.trim(),
              salvoEm: new Date().toISOString(),
              colunas: resultado.columns.map((c) => c.name),
              linhas: resultado.rows.map((l) => l.map((v) => (v === null ? null : String(v)))),
              cortado: false,
            })
          );
        });
      }}
      onAbrirResultado={(celula, nome) => {
        const r = celula.resultados.find((x) => x.nome === nome);
        if (r === undefined) return;
        onAbrirResultadoSalvo(`${aba.title} · ${nome}`, r);
      }}
      onRemoverResultado={(celula, nome) => aplicar(removerResultado(caderno, celula.id, nome))}
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
