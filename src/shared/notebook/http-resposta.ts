// A resposta da célula HTTP como se LÊ (spec 120, etapa 1): "Pretty" do
// Postman, tamanho e nome do arquivo para salvar. Puro, para testar sem tela.
import { ehJson } from './http';

const ehXml = (tipo: string): boolean => /[/+]xml\b/i.test(tipo);
const ehHtml = (tipo: string): boolean => /text\/html/i.test(tipo);

/** XML uma tag por linha; `<b>texto</b>` curto fica numa linha só. */
function formatarXml(xml: string): string {
  const pedacos = xml.replace(/>\s+</g, '><').split(/(?=<)|(?<=>)/).filter((p) => p.trim() !== '');
  const linhas: string[] = [];
  let nivel = 0;
  for (let i = 0; i < pedacos.length; i += 1) {
    const p = pedacos[i];
    const recuo = '  '.repeat(nivel);
    if (p.startsWith('</')) {
      nivel = Math.max(0, nivel - 1);
      linhas.push(`${'  '.repeat(nivel)}${p}`);
    } else if (p.startsWith('<?') || p.startsWith('<!') || p.endsWith('/>')) {
      linhas.push(`${recuo}${p}`);
    } else if (p.startsWith('<')) {
      const texto = pedacos[i + 1];
      const fecha = pedacos[i + 2];
      if (texto !== undefined && !texto.startsWith('<') && fecha?.startsWith('</')) {
        linhas.push(`${recuo}${p}${texto}${fecha}`);
        i += 2;
      } else {
        linhas.push(`${recuo}${p}`);
        nivel += 1;
      }
    } else {
      linhas.push(`${recuo}${p.trim()}`);
    }
  }
  return linhas.join('\n');
}

/** O "Pretty": JSON e XML indentados; o resto, como chegou. */
export function formatarCorpo(corpo: string, tipoDeConteudo: string): string {
  if (ehJson(tipoDeConteudo)) {
    try {
      return JSON.stringify(JSON.parse(corpo), null, 2);
    } catch {
      return corpo;
    }
  }
  if (ehXml(tipoDeConteudo)) {
    try {
      return formatarXml(corpo);
    } catch {
      return corpo;
    }
  }
  return corpo;
}

/** Com que linguagem colorir o corpo (o vocabulário da IDE). */
export function linguagemDoCorpo(tipoDeConteudo: string): string {
  if (ehJson(tipoDeConteudo)) return 'json';
  if (ehHtml(tipoDeConteudo)) return 'html';
  if (ehXml(tipoDeConteudo)) return 'xml';
  return 'plain';
}

export function tamanhoLegivel(bytes: number): string {
  const um = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${um(Math.round((bytes / 1024) * 10) / 10)} KB`;
  return `${um(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB`;
}

const EXTENSOES: Record<string, string> = {
  'application/json': 'json', 'application/xml': 'xml', 'text/xml': 'xml', 'text/html': 'html',
  'text/plain': 'txt', 'text/csv': 'csv', 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/zip': 'zip',
};

/** O nome sugerido no "Salvar": o fim da URL, ou `resposta.<extensão>`. */
export function nomeParaSalvar(url: string, tipoDeConteudo: string): string {
  const mime = tipoDeConteudo.split(';')[0].trim().toLowerCase();
  const extensao = EXTENSOES[mime] ?? (ehJson(mime) ? 'json' : 'bin');
  let fim = '';
  try {
    fim = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    fim = '';
  }
  if (fim === '') return `resposta.${extensao}`;
  return fim.includes('.') ? fim : `${fim}.${extensao}`;
}
