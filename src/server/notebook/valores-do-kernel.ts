// Ler e entregar valores do kernel do notebook — o que as células SQL (spec
// 112–114) e HTTP (spec 120) fazem igual: `{{nome}}` lê de quem mudou o nome
// por último (a cascata), e o resultado vai para CADA linguagem do notebook.
import type { GerenteDeKernels } from './gerente';
import type { Kernel } from './kernel';
import type { Kernel as LinguagemDoKernel } from '../../shared/notebook/modelo';

/** Os valores dos `{{ }}`, de quem mudou cada nome por último. */
export async function lerValoresDoKernel(
  gerente: GerenteDeKernels, caminho: string, nomes: readonly string[], comoTabela: readonly string[] = []
): Promise<Record<string, unknown>> {
  const valores: Record<string, unknown> = {};
  if (nomes.length === 0) return valores;
  const vivos = gerente.sessoesDe(caminho);
  if (vivos.length === 0) {
    throw new Error(`{{${nomes[0]}}} precisa do kernel rodando: rode antes a célula que cria a variável.`);
  }
  const cascata = gerente.cascata(caminho);
  await cascata.sincronizar(gerente.kernelsDe(caminho));
  for (const nome of nomes) {
    const origem = cascata.origemDe(nome) ?? cascata.ultima;
    const ordem = [...vivos].sort((a, b) => Number(b.familia === origem) - Number(a.familia === origem));
    let achou = false;
    for (const s of ordem) {
      const r = await s.kernel.obter([nome], comoTabela.includes(nome) ? [nome] : []);
      const erro = r.erros[nome];
      if (erro !== undefined) throw new Error(`{{${nome}}} ${erro}.`);
      if (!r.faltando.includes(nome)) {
        valores[nome] = r.valores[nome];
        achou = true;
        break;
      }
    }
    if (!achou) throw new Error(`{{${nome}}}: a variável "${nome}" não existe no kernel. Rode antes a célula que a cria.`);
  }
  return valores;
}

const ROTULO_DA_FAMILIA = { node: 'Node', python: 'Python', php: 'PHP' } as const;

/**
 * Um valor vira variável em CADA linguagem do notebook, subindo o kernel que
 * faltar. Um kernel que não sobe vira aviso: o resto recebe mesmo assim.
 */
export async function entregarAosKernels(
  gerente: GerenteDeKernels,
  p: {
    readonly caminho: string;
    readonly nome: string;
    readonly linguagens: readonly LinguagemDoKernel[];
    readonly raiz: string | null;
    /** Como o valor chega a um kernel; devolve o que dizer dele (linhas, forma…). */
    readonly entregar: (kernel: Kernel) => Promise<Record<string, unknown>>;
  }
): Promise<{ variavel: Record<string, unknown> | null; avisos: string[] }> {
  const avisos: string[] = [];
  if (p.linguagens.length === 0) {
    return { variavel: null, avisos: [`O kernel não está rodando: a variável ${p.nome} não foi criada.`] };
  }
  const entregues: string[] = [];
  let primeira: Record<string, unknown> | null = null;
  const familias = new Set<string>();
  for (const linguagem of p.linguagens) {
    const s = gerente.sessao(p.caminho, linguagem);
    if (s !== undefined && familias.has(s.familia)) continue;
    try {
      const alvo = s ?? (await gerente.garantir({ caminho: p.caminho, linguagem, raiz: p.raiz }));
      if (familias.has(alvo.familia)) continue;
      familias.add(alvo.familia);
      const d = await p.entregar(alvo.kernel);
      primeira ??= d;
      entregues.push(ROTULO_DA_FAMILIA[alvo.familia]);
    } catch (e) {
      avisos.push(`${linguagem}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Chegou a todas: é o valor mais novo, e a versão velha da cascata não volta por cima.
  gerente.cascata(p.caminho).aoDefinir(p.nome);
  return { variavel: primeira === null ? null : { nome: p.nome, ...primeira, linguagens: entregues }, avisos };
}
