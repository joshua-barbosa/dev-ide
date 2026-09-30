// Exportar o notebook para `.ipynb`, o formato do Jupyter (spec 112, etapa 5).
//
// Ele pediu na v1 — para abrir no Jupyter e o GitHub mostrar com as saídas. Só
// notebook de kernel PYTHON: o `.ipynb` declara uma linguagem por caderno.
//
// A célula SQL não existe no Jupyter. Ela vira uma célula de código com a
// consulta EM COMENTÁRIO e a tabela guardada como saída: quem abre vê a
// consulta e o resultado; rodar ali não refaz a consulta — o Jupyter não tem a
// conexão. Decisão tomada na etapa, dita no relatório a ele.
import type { Vinculo } from '../sql/vinculo';
import type { Notebook, Saida } from './modelo';

/** O jeito do nbformat guardar texto: linhas, cada uma com o seu `\n`, menos a última. */
function linhas(texto: string): string[] {
  if (texto === '') return [];
  const partes = texto.split('\n');
  return partes.map((l, i) => (i < partes.length - 1 ? `${l}\n` : l)).filter((l) => l !== '');
}

/** Base64 → texto, no navegador E no Node (o botão de exportar roda na tela). */
const deBase64 = (b64: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

const escapar = (v: unknown): string =>
  String(v ?? 'NULL').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tabelaHtml(s: Extract<Saida, { tipo: 'tabela' }>): string {
  const cabeca = s.colunas.map((c) => `<th>${escapar(c)}</th>`).join('');
  const corpo = s.linhas.map((l) => `<tr>${l.map((v) => `<td>${escapar(v)}</td>`).join('')}</tr>`).join('\n');
  const nota = s.total > s.linhas.length ? `\n<p>${s.linhas.length} de ${s.total} linhas.</p>` : '';
  return `<table>\n<thead><tr>${cabeca}</tr></thead>\n<tbody>\n${corpo}\n</tbody>\n</table>${nota}`;
}

function tabelaTexto(s: Extract<Saida, { tipo: 'tabela' }>): string {
  return [s.colunas.join('\t'), ...s.linhas.map((l) => l.map((v) => String(v ?? 'NULL')).join('\t'))].join('\n');
}

function saidasIpynb(saidas: readonly Saida[]): unknown[] {
  const outputs: unknown[] = [];
  for (const s of saidas) {
    if (s.tipo === 'texto') {
      const nome = s.fluxo === 'erro' ? 'stderr' : 'stdout';
      const ultima = outputs[outputs.length - 1] as { output_type?: string; name?: string; text?: string[] } | undefined;
      // Pedaços seguidos do mesmo fluxo são UM stream, como o Jupyter grava.
      if (ultima?.output_type === 'stream' && ultima.name === nome && ultima.text !== undefined) {
        ultima.text.push(...linhas(s.texto));
      } else {
        outputs.push({ output_type: 'stream', name: nome, text: linhas(s.texto) });
      }
    } else if (s.tipo === 'erro') {
      const [primeira = 'Erro'] = s.mensagem.split('\n');
      outputs.push({ output_type: 'error', ename: 'Erro', evalue: primeira, traceback: s.mensagem.split('\n') });
    } else if (s.tipo === 'tabela') {
      outputs.push({
        output_type: 'display_data',
        data: { 'text/html': linhas(tabelaHtml(s)), 'text/plain': linhas(tabelaTexto(s)) },
        metadata: {},
      });
    } else if (s.tipo === 'imagem') {
      const svg = s.mime === 'image/svg+xml';
      outputs.push({
        output_type: 'display_data',
        data: { [s.mime]: svg ? deBase64(s.dados) : s.dados },
        metadata: {},
      });
    }
  }
  return outputs;
}

export function exportarIpynb(nb: Notebook, rotuloDaConexao: (v: Vinculo) => string): string {
  if (nb.kernel !== 'python') {
    throw new Error('Exportar para .ipynb é só notebook Python: o Jupyter declara uma linguagem por caderno.');
  }
  const cells = nb.celulas.map((c) => {
    if (c.tipo === 'markdown') {
      return { cell_type: 'markdown', id: c.id, metadata: {}, source: linhas(c.conteudo) };
    }
    if (c.tipo === 'sql') {
      const conexao = c.conexao ?? nb.conexao;
      const comentario = [
        `# SQL (Braytech Code) → variável \`${c.nome ?? ''}\``,
        `# conexão: ${conexao === null ? 'nenhuma' : rotuloDaConexao(conexao)}`,
        ...c.conteudo.split('\n').map((l) => (l === '' ? '#' : `# ${l}`)),
      ].join('\n');
      return {
        cell_type: 'code', id: c.id,
        metadata: { braytech: { tipo: 'sql', nome: c.nome, conexao } },
        execution_count: c.contador, source: linhas(comentario), outputs: saidasIpynb(c.saidas),
      };
    }
    return {
      cell_type: 'code', id: c.id, metadata: {},
      execution_count: c.contador, source: linhas(c.conteudo), outputs: saidasIpynb(c.saidas),
    };
  });
  const ipynb = {
    cells,
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return `${JSON.stringify(ipynb, null, 1)}\n`;
}
