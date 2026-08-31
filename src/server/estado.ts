// O estado da sessão em disco: `state.json`.
//
// Fica ao lado do `config.json`, na mesma raiz de dados, mas é outro arquivo —
// preferência é escolha do usuário, estado é histórico gerado pela IDE. Ver a
// decisão registrada na spec 012.
import {
  abrirPasta, acrescentarPasta, esquecerPasta, fecharPasta, normalizarEstado, removerPasta,
  type EstadoDaSessao,
} from '../shared/estado';
import { gravarJsonAtomico, lerJsonTolerante } from './arquivo-json';
import { arquivoDeDados } from './paths';

export class EstadoStore {
  constructor(private readonly caminho: string) {}

  static defaultPath(): string {
    return arquivoDeDados('state.json');
  }

  /** Relê a cada chamada: o arquivo é pequeno e pode mudar por fora. */
  ler(): EstadoDaSessao {
    return normalizarEstado(lerJsonTolerante(this.caminho));
  }

  abrir(pasta: string): EstadoDaSessao {
    return this.gravar(abrirPasta(this.ler(), pasta));
  }

  /** Soma uma raiz ao espaço de trabalho, sem tirar as outras (T004). */
  acrescentar(pasta: string): EstadoDaSessao {
    return this.gravar(acrescentarPasta(this.ler(), pasta));
  }

  /** Tira UMA raiz, deixando as demais (T004). */
  remover(pasta: string): EstadoDaSessao {
    return this.gravar(removerPasta(this.ler(), pasta));
  }

  fechar(): EstadoDaSessao {
    return this.gravar(fecharPasta(this.ler()));
  }

  esquecer(pasta: string): EstadoDaSessao {
    return this.gravar(esquecerPasta(this.ler(), pasta));
  }

  private gravar(estado: EstadoDaSessao): EstadoDaSessao {
    gravarJsonAtomico(this.caminho, {
      pastas: [...estado.pastas],
      recentes: [...estado.recentes],
    });
    return estado;
  }
}
