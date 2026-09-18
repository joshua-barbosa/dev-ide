// Quanto texto uma página de resultado pode trazer — a escolha DELE.
//
// Mora num módulo, e não numa prop, porque o valor precisa alcançar toda
// consulta: a aba de tabela, o `Result` de SQL escrito à mão, o caderno e a
// grade da extensão passam todos pela `Api`, e enfiar o número por quatro
// camadas de props em cada caminho seria quatro chances de esquecer um.
//
// Mesmo padrão do `definirBaseDaApi`. Persistido no navegador: é escolha de
// tela, como a largura da lateral — e mudá-la não vale uma ida ao servidor.
import { ORCAMENTO_PADRAO } from '../shared/grade/cortes';

const CHAVE = 'dev-ide.grade.orcamento';

function lerGuardado(): number {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto === null) return ORCAMENTO_PADRAO;
    const valor: unknown = JSON.parse(bruto);
    return typeof valor === 'number' && Number.isFinite(valor) && valor > 0
      ? valor
      : ORCAMENTO_PADRAO;
  } catch {
    // Sem `localStorage` (modo privativo, webview restrita) vale o padrão.
    return ORCAMENTO_PADRAO;
  }
}

let atual = lerGuardado();

export function orcamentoDeCelulas(): number {
  return atual;
}

export function definirOrcamentoDeCelulas(valor: number): void {
  atual = Number.isFinite(valor) && valor > 0 ? Math.trunc(valor) : ORCAMENTO_PADRAO;
  try {
    localStorage.setItem(CHAVE, JSON.stringify(atual));
  } catch {
    // Não persistir não é motivo para a escolha não valer nesta sessão.
  }
}
