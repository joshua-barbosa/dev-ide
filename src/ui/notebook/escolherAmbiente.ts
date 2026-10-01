// A pergunta "com o quê o kernel roda?" — Python, PHP, ou Node + pacotes.
//
// Um colega dele, num notebook JavaScript: *"ele não me deixa trocar… não sei
// nem qual dos dois ele escolheu"* (um frontend e um backend no mesmo
// workspace). E ele: clicar na barra *"foi automático"*, sem pergunta. Agora
// o clique SEMPRE pergunta, com o kernel de pé ou parado, e o JS/TS mostra as
// duas escolhas numa lista: a pasta dos pacotes e o Node.
import type { AmbienteDoKernel } from '../api-notebook';
import type { Kernel } from '../../shared/notebook/modelo';

export interface EscolhaDoAmbiente {
  readonly interpretador?: string;
  readonly pacotes?: string;
}

type Opcao = { readonly valor: string; readonly rotulo: string; readonly detalhe?: string };

const OUTRO = '\u0000outro';
/** "Outra pasta de vendor/pacotes…": separada do "Outro PHP/Node…" (são coisas diferentes). */
const OUTRA_PASTA = '\u0000outra-pasta';
const PACOTES = 'p\u0000';
const NODE = 'n\u0000';

const PERGUNTA: Record<Kernel, { titulo: string; outro: string; exemplo: string }> = {
  python: {
    titulo: 'Com qual Python o notebook roda?', outro: 'Outro Python…',
    exemplo: '.venv/bin/python (a partir da pasta do notebook), ~/… ou caminho completo',
  },
  php: {
    titulo: 'Kernel PHP: de onde vem o vendor, e qual PHP?', outro: 'Outro PHP…',
    exemplo: 'o programa php, ou a pasta onde ele está (C:\\php, /opt/php/bin)',
  },
  javascript: {
    titulo: 'Kernel JavaScript: de onde vêm os pacotes, e qual Node?', outro: 'Outro Node…',
    exemplo: 'o programa node, ou a pasta onde ele está',
  },
  typescript: {
    titulo: 'Kernel TypeScript: de onde vêm os pacotes, e qual Node?', outro: 'Outro Node…',
    exemplo: 'o programa node, ou a pasta onde ele está',
  },
};

export async function escolherAmbiente(
  linguagem: Kernel,
  ambiente: AmbienteDoKernel,
  emUso: EscolhaDoAmbiente,
  escolherOpcao: (titulo: string, opcoes: readonly Opcao[]) => Promise<string | null>,
  pedirTexto: (titulo: string, placeholder: string) => Promise<string | null>
): Promise<EscolhaDoAmbiente | null> {
  const marca = (usado: boolean, detalhe: string): string => (usado ? `em uso · ${detalhe}` : detalhe);
  const ehNode = linguagem === 'javascript' || linguagem === 'typescript';
  // O PHP também escolhe de onde vem o vendor (relato de 01/10).
  const temPacotes = ehNode || linguagem === 'php';
  const nomeDosPacotes = ehNode ? 'Pacotes' : 'Vendor';
  const pastaDosPacotes = ehNode ? 'node_modules' : 'vendor';
  const pergunta = PERGUNTA[linguagem];

  const opcoes: Opcao[] = [
    ...(temPacotes
      ? ambiente.candidatosDePacotes.map((p) => ({
        valor: PACOTES + p.caminho,
        rotulo: `${nomeDosPacotes}: ${p.rotulo}`,
        detalhe: marca(p.caminho === emUso.pacotes, `${pastaDosPacotes} de ${p.caminho}`),
      }))
      : []),
    ...ambiente.candidatos.map((c) => ({
      valor: NODE + c.caminho,
      rotulo: ehNode ? `Node: ${c.rotulo}` : c.rotulo,
      detalhe: marca(c.caminho === emUso.interpretador, c.caminho),
    })),
    ...(temPacotes
      ? [{
        valor: OUTRA_PASTA,
        rotulo: `Outra pasta de ${pastaDosPacotes === 'vendor' ? 'vendor' : 'pacotes'}…`,
        detalhe: `a pasta do projeto ou a própria ${pastaDosPacotes}/ — relativa ao notebook, ~/… ou completa`,
      }]
      : []),
    { valor: OUTRO, rotulo: pergunta.outro, detalhe: 'o programa (ou a pasta onde ele está) — relativo ao notebook, ~/… ou completo' },
  ];

  const escolhido = await escolherOpcao(pergunta.titulo, opcoes);
  if (escolhido === null) return null;
  if (escolhido.startsWith(PACOTES)) return { pacotes: escolhido.slice(PACOTES.length) };
  if (escolhido.startsWith(NODE)) return { interpretador: escolhido.slice(NODE.length) };
  if (escolhido === OUTRA_PASTA) {
    const pasta = await pedirTexto(
      `Outra pasta de ${pastaDosPacotes === 'vendor' ? 'vendor' : 'pacotes'}`,
      `backend (ou backend/${pastaDosPacotes}) — relativa à pasta do notebook`
    );
    return pasta === null || pasta.trim() === '' ? null : { pacotes: pasta.trim() };
  }
  const digitado = await pedirTexto(pergunta.outro.replace('…', ''), pergunta.exemplo);
  return digitado === null || digitado.trim() === '' ? null : { interpretador: digitado.trim() };
}
