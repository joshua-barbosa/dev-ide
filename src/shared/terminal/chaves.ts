// A chave dos snippets do terminal que não pertence a conexão nenhuma.
//
// Mora em `shared` porque servidor e tela precisam concordar: se a tela pedir
// `__local__` e o servidor guardar em `local`, os snippets somem entre um F5 e
// outro sem que nada dê erro.
export const TERMINAL_LOCAL = '__local__';
