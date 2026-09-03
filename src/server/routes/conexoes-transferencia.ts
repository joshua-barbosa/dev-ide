// Levar conexões de uma máquina para outra: exportar e importar (N001).
//
// Saiu de `connections.ts` porque é a única parte daquele arquivo que trata o
// segredo ao contrário do resto: aqui a senha SAI em claro, de propósito, para
// caber num arquivo que o dono leva no pendrive. Isolar deixa essa exceção
// visível em vez de perdida no meio de cinquenta rotas.
import { Router } from 'express';
import { lerArquivoDeConexoes, planoDeImportacao } from '../../shared/importar-conexoes';
import type { DriverRegistry } from '../connections/registry';
import type { Vault } from '../connections/vault';
import type { FieldValue } from '../connections/types';
import { wrap } from '../http/handlers';

const ok = (data: unknown) => ({ success: true, data, error: null });

/**
 * Monta as rotas de exportação e importação sobre o cofre.
 *
 * As duas exigem o cofre destrancado — quem chama monta este router depois do
 * middleware que cobra isso.
 */
export function criarRotasDeTransferencia(registry: DriverRegistry, vault: Vault): Router {
  const router = Router();

  /**
   * TODAS as conexões, com as senhas, em JSON claro (N001).
   *
   * Ele escolheu claro, sabendo o que é: um arquivo com credencial de produção
   * legível. A IDE não decide onde ele fica — quem baixa é o navegador dele.
   *
   * O aviso vai dentro do próprio arquivo porque é lá que alguém vai
   * reencontrá-lo daqui a seis meses.
   */
  router.post('/export-all', wrap(async (_req, res) => {
    const conexoes = vault.list().map((c) => {
      const campos: Record<string, unknown> = { ...c.fields };
      for (const campo of vault.camposSecretos(c.id)) {
        campos[campo] = vault.revelar(c.id, campo);
      }
      return {
        type: c.type, label: c.label, group: c.group, readOnly: c.readOnly, fields: campos,
      };
    });
    res.json(ok({
      exportadoEm: new Date().toISOString(),
      aviso: 'Este arquivo contém SENHAS EM CLARO.',
      conexoes,
    }));
  }));

  /**
   * IMPORTA conexões do arquivo que a exportação gera (N001).
   *
   * Recebe a lista já lida do arquivo; a validação e o plano moram em
   * `shared/importar-conexoes.ts`, testados sem cofre nenhum. Aqui só se aplica,
   * e aplicar é a parte que não tem volta.
   */
  router.post('/import', wrap((req, res) => {
    const corpo = req.body as { conexoes?: unknown; politica?: unknown };
    const politica =
      corpo.politica === 'substituir' || corpo.politica === 'pular'
        ? corpo.politica
        : 'manter-as-duas';

    // Revalida no SERVIDOR, e não confia no que a tela mandou: a rota é
    // alcançável sem passar por ela.
    const lido = lerArquivoDeConexoes(
      JSON.stringify({ conexoes: corpo.conexoes }),
      registry.list().map((d) => d.type)
    );
    if ('erro' in lido) throw new Error(lido.erro);

    const plano = planoDeImportacao(
      vault.list().map((c) => ({ id: c.id, label: c.label, group: c.group })),
      lido.conexoes,
      politica
    );

    let criadas = 0;
    let substituidas = 0;
    let puladas = 0;
    for (const destino of plano) {
      const { conexao } = destino;
      const entrada = {
        type: conexao.type,
        label: conexao.label,
        group: conexao.group,
        readOnly: conexao.readOnly,
        fields: conexao.fields as Record<string, FieldValue>,
      };
      const secretos = registry.secretFields(conexao.type);
      if (destino.acao === 'pular') {
        puladas += 1;
      } else if (destino.acao === 'substituir' && destino.idExistente !== undefined) {
        vault.update(destino.idExistente, entrada, secretos);
        substituidas += 1;
      } else {
        vault.add(entrada, secretos);
        criadas += 1;
      }
    }

    res.json(ok({ criadas, substituidas, puladas }));
  }));

  return router;
}
