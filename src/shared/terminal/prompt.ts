// Quando o shell está pronto para receber um comando (spec 061).
//
// Puro e testado porque é uma heurística, e heurística sem teste é palpite. A
// versão anterior era "a primeira saída é o prompt" — verdade num shell local,
// que começa imprimindo o prompt, e **falso no SSH**, onde a primeira saída é o
// banner de login (`Last login: …`, mensagem do dia, aviso de nvm).
//
// O resultado disso apareceu no servidor do usuário: o `cd` da raiz era enviado
// durante o banner, o TTY o ecoava, e ele NÃO executava. O prompt continuava no
// home com o comando na tela, parecendo que tinha rodado.

/** Os finais de prompt que sobrevivem a qualquer `PS1` razoável. */
const FIM_DE_PROMPT = /[$#%>]$/;

/** `[…m`, `[?2004h` — cor, cursor, colagem entre colchetes. */
const CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * `]0;título` — o que muda o nome da janela.
 *
 * Precisa ser removido junto com o CSI: um prompt do `starship` termina com uma
 * destas DEPOIS do `$`, e sem removê-la o fim do texto não é o `$` — foi assim
 * que a primeira versão desta função deixou de reconhecer o prompt local, e o
 * comando salvo (spec 039) nunca era digitado.
 */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** O que sobra de controle: BEL, retorno de carro, tabulação. */
/**
 * `ESC ( B`, `ESC =`, `ESC M` — escapes de dois caracteres, que não são CSI.
 *
 * O `ESC ( B` (voltar ao conjunto ASCII) é emitido pelo prompt DEPOIS do `$`, e
 * foi o que sobrou na limpeza e fez a heurística não reconhecer o prompt local.
 * Capturado de um shell de verdade, e não deduzido.
 */
const ESCAPE_CURTO = /\u001b[()#%][0-9A-Za-z]|\u001b[=><]|\u001b[@-Z\\-_]/g;

/** O que sobra de controle: BEL, retorno de carro, tabulação. */
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * O shell parou de falar e está esperando?
 *
 * O critério é o FIM do que foi recebido até agora: um prompt é a última coisa
 * impressa antes de o shell ceder o teclado. Procurar `$` em qualquer lugar
 * casaria com `$HOME` no meio do banner.
 */
export function pareceProntoParaComando(recebido: string): boolean {
  const limpo = recebido
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(ESCAPE_CURTO, '')
    .replace(/\r/g, '')
    .replace(CONTROLE, '');
  // A última linha com conteúdo: o prompt pode ter mais de uma, e as vazias
  // depois dele não dizem nada.
  const linhas = limpo.split('\n').map((l) => l.trimEnd());
  const ultima = [...linhas].reverse().find((l) => l.trim() !== '');
  return ultima !== undefined && FIM_DE_PROMPT.test(ultima);
}
