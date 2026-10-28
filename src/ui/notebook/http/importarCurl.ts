// Um cURL colado vira a requisição da célula (spec 120, etapa 3) — e o
// segredo que vier nele (Bearer, senha do -u) vai para o COFRE na hora, como
// se tivesse sido digitado na aba Authorization: o `.brnb` não o guarda.
import { lerCurl } from '../../../shared/notebook/curl';
import type { AutorizacaoHttp, CampoSecreto, RequisicaoHttp } from '../../../shared/notebook/http';
import { guardarNoCofre, novaReferencia } from './segredosPendentes';

function paraOCofre(c: CampoSecreto): CampoSecreto {
  if (!('texto' in c) || c.texto === '' || c.texto.includes('{{')) return c;
  const ref = novaReferencia();
  guardarNoCofre(ref, c.texto);
  return { cofre: ref };
}

function autorizacaoNoCofre(a: AutorizacaoHttp): AutorizacaoHttp {
  switch (a.tipo) {
    case 'bearer': return { ...a, token: paraOCofre(a.token) };
    case 'basic': return { ...a, senha: paraOCofre(a.senha) };
    case 'apikey': return { ...a, valor: paraOCofre(a.valor) };
    default: return a;
  }
}

/** Lança se não for cURL (o recado vai para a tela). */
export function importarCurl(texto: string): { requisicao: RequisicaoHttp; avisos: string[] } {
  const { requisicao, avisos } = lerCurl(texto);
  return { requisicao: { ...requisicao, autorizacao: autorizacaoNoCofre(requisicao.autorizacao) }, avisos };
}

/** Parece um cURL? (para o colar na URL importar sozinho, como no Postman) */
export const pareceCurl = (texto: string): boolean => /^\s*curl(\.exe)?\s/i.test(texto);
