// O pote de cookies de um notebook (spec 120, etapa 3).
//
// Decisão dele (28/10): *"um cookie recebido numa célula é enviado nas
// próximas requisições para o mesmo host"* — o login numa célula, a sessão
// nas seguintes, como no Postman. As regras são as do navegador (RFC 6265),
// no que importa aqui: Domain, Path, Secure e validade.
//
// Fica na memória do motor, um pote por `.brnb`: reiniciar o motor esvazia.
import { isIP } from 'node:net';

/** Mais que isto num notebook é um servidor enchendo o pote: os mais velhos saem. */
const MAX_COOKIES = 300;

export interface Cookie {
  readonly nome: string;
  readonly valor: string;
  /** Sem ponto na frente; `soEsteHost` diz se subdomínio também recebe. */
  readonly dominio: string;
  readonly soEsteHost: boolean;
  readonly caminho: string;
  readonly seguro: boolean;
  /** Em ms; `null` = até o motor fechar. */
  readonly expira: number | null;
}

const dominioCasa = (host: string, dominio: string): boolean => host === dominio || host.endsWith(`.${dominio}`);

/** O "diretório" da URL: `/conta/login` → `/conta`. */
function caminhoPadrao(url: URL): string {
  const p = url.pathname;
  const barra = p.lastIndexOf('/');
  return barra <= 0 ? '/' : p.slice(0, barra);
}

const caminhoCasa = (pedido: string, cookie: string): boolean =>
  pedido === cookie || (pedido.startsWith(cookie) && (cookie.endsWith('/') || pedido[cookie.length] === '/'));

function lerSetCookie(url: URL, texto: string, agora: number): Cookie | null {
  const [par, ...atributos] = texto.split(';');
  const igual = par.indexOf('=');
  if (igual <= 0) return null;
  const host = url.hostname.toLowerCase();
  let dominio = host;
  let soEsteHost = true;
  let caminho = caminhoPadrao(url);
  let seguro = false;
  let expira: number | null = null;
  let temMaxAge = false;
  for (const atributo of atributos) {
    const [chave, ...resto] = atributo.split('=');
    const valor = resto.join('=').trim();
    switch (chave.trim().toLowerCase()) {
      case 'domain': {
        const d = valor.replace(/^\./, '').toLowerCase();
        // Um servidor não põe cookie para outro site; nem para um domínio
        // inteiro de um rótulo só (`com`); num IP, só para o próprio IP.
        const aceita = d === host || (isIP(host) === 0 && d.includes('.') && dominioCasa(host, d));
        if (d === '' || !aceita) return null;
        dominio = d;
        soEsteHost = false;
        break;
      }
      case 'path':
        if (valor.startsWith('/')) caminho = valor;
        break;
      case 'secure':
        seguro = true;
        break;
      case 'max-age': {
        // Vazio não é zero: `Max-Age=` sem número não apaga nada.
        const s = /^-?\d+$/.test(valor) ? Number(valor) : Number.NaN;
        if (Number.isFinite(s)) {
          expira = agora + s * 1000;
          temMaxAge = true;
        }
        break;
      }
      case 'expires':
        if (!temMaxAge) {
          const t = Date.parse(valor);
          if (!Number.isNaN(t)) expira = t;
        }
        break;
      default:
        break;
    }
  }
  // Secure chegando por http: um servidor sem TLS não pode pôr cookie de TLS.
  if (seguro && url.protocol !== 'https:') return null;
  return { nome: par.slice(0, igual).trim(), valor: par.slice(igual + 1).trim(), dominio, soEsteHost, caminho, seguro, expira };
}

export class PoteDeCookies {
  private cookies: Cookie[] = [];

  /** Os `Set-Cookie` de uma resposta. Expirado (Max-Age=0) APAGA. */
  guardar(url: URL, setCookies: readonly string[], agora: number = Date.now()): void {
    for (const texto of setCookies) {
      const c = lerSetCookie(url, texto, agora);
      if (c === null) continue;
      const outros = this.cookies.filter(
        (x) => !(x.nome === c.nome && x.dominio === c.dominio && x.caminho === c.caminho && x.soEsteHost === c.soEsteHost)
      );
      this.cookies = c.expira !== null && c.expira <= agora ? outros : [...outros, c].slice(-MAX_COOKIES);
    }
  }

  private validos(agora: number): Cookie[] {
    this.cookies = this.cookies.filter((c) => c.expira === null || c.expira > agora);
    return this.cookies;
  }

  /** O header `Cookie` para esta URL; `null` quando não há nenhum. */
  cabecalho(url: URL, agora: number = Date.now()): string | null {
    const host = url.hostname.toLowerCase();
    const vao = this.validos(agora).filter((c) =>
      (c.soEsteHost ? host === c.dominio : dominioCasa(host, c.dominio))
      && caminhoCasa(url.pathname || '/', c.caminho)
      && (!c.seguro || url.protocol === 'https:'));
    return vao.length === 0 ? null : vao.map((c) => `${c.nome}=${c.valor}`).join('; ');
  }

  lista(agora: number = Date.now()): readonly Cookie[] {
    return [...this.validos(agora)];
  }

  limpar(): void {
    this.cookies = [];
  }
}
