// Rotas /api/prefs.
//
// Router próprio, e não linhas soltas no `index.ts`, pelo mesmo motivo das
// conexões: assim o teste monta a rota sobre um arquivo temporário. Se ficassem
// no `index.ts`, testá-las exigiria importar o servidor inteiro — que instancia
// o store na raiz de dados REAL do usuário. Foi exatamente esse descuido que já
// apagou o `session.json` dele uma vez.
import { Router } from 'express';
import { wrap } from '../http/handlers';
import { validarPatch } from '../../shared/prefs';
import type { PreferencesStore } from '../prefs';

export function createPrefsRouter(prefs: PreferencesStore): Router {
  const router = Router();
  const ok = (data: unknown) => ({ success: true, data, error: null });

  /** Sempre o conjunto completo: quem consome nunca precisa saber os padrões. */
  router.get('/', wrap((_req, res) => {
    res.json(ok(prefs.ler()));
  }));

  // Fronteira RÍGIDA: `validarPatch` lança com a chave e o que se esperava, e o
  // envelope de erro devolve a mensagem. A fronteira tolerante é a leitura do
  // arquivo — lá quem erra é uma pessoa digitando, e recusar custaria a IDE.
  router.patch('/', wrap((req, res) => {
    res.json(ok(prefs.gravar(validarPatch(req.body))));
  }));

  /**
   * Os temas do usuário (T012).
   *
   * Rota própria, e não dentro de `GET /`, para o contrato de preferências
   * continuar sendo "um objeto de valores simples". Uma requisição a mais no
   * arranque; em troca, nada do que já existe muda de forma.
   */
  router.get('/themes', wrap((_req, res) => {
    res.json(ok(prefs.lerTemas()));
  }));

  /**
   * O que o PROJETO sobrescreve (T002).
   *
   * A tela usa para avisar: um campo que o projeto manda continua sendo
   * mostrado, mas com a marca — mudar ali grava no arquivo do usuário e não
   * muda nada, e não avisar seria deixar a IDE parecer quebrada.
   */
  router.get('/project', wrap((_req, res) => {
    res.json(ok({
      path: prefs.caminhoDoProjeto(),
      sobrescritas: prefs.chavesSobrescritas(),
    }));
  }));

  /** Cria o `.vscode/settings.json` e devolve o caminho, para a IDE abri-lo. */
  router.post('/project/file', wrap((_req, res) => {
    res.json(ok({ path: prefs.garantirArquivoDoProjeto() }));
  }));

  /** Onde o arquivo fica — a interface precisa saber para reagir ao salvá-lo. */
  router.get('/file', wrap((_req, res) => {
    res.json(ok({ path: prefs.path }));
  }));

  /** Cria o arquivo se preciso e devolve o caminho, para a IDE abri-lo no editor. */
  router.post('/file', wrap((_req, res) => {
    res.json(ok({ path: prefs.garantirArquivo() }));
  }));

  return router;
}
