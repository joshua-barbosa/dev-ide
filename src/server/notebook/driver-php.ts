// O programa que roda DENTRO do PHP do notebook (spec 112, etapa 3).
//
// Ele pediu PHP *"(consegue pegar da vendor que estiver no projeto e/ou usar
// classes que tem no próprio projeto talvez)"*: o motor passa o caminho do
// `vendor/autoload.php` mais próximo, e — só se ele LIGAR a opção — o
// `bootstrap/app.php` do Laravel, para `Model::` e facades funcionarem como no
// `tinker`.
//
// O laço de leitura mora no ESCOPO GLOBAL do script, de propósito: `eval`
// herda o escopo de onde é chamado, e é assim que a variável de uma célula
// existe na próxima.
//
// Última expressão: se a célula termina SEM `;`, o último comando é avaliado e
// mostrado (como no `tinker`). Quem acha o fim do último comando é o
// tokenizador do PHP — contar `;` na mão quebraria num texto como "a;b".
//
// Parar: com `pcntl` (Linux/Mac), o SIGINT vira exceção DENTRO da célula e as
// variáveis ficam. Sem `pcntl` (Windows), não há como interromper um `eval` no
// meio, e a rede de segurança do motor encerra o kernel.
//
// Nada de dólar-chave neste texto: o `String.raw` o trataria como interpolação.
export const DRIVER_PHP = String.raw`<?php
$__marca = "\x1eBRNB\x1f";

function __enviar($d) {
    global $__marca;
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
    $json = json_encode($d, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    fwrite(STDOUT, $__marca . $json . "\n");
    fflush(STDOUT);
}

ini_set('display_errors', 'stderr');
ini_set('log_errors', '0');
error_reporting(E_ALL);
set_error_handler(function ($no, $msg, $arq, $linha) {
    __enviar(['tipo' => 'texto', 'fluxo' => 'erro', 'texto' => "Aviso: $msg (linha $linha)\n"]);
    return true;
});

$__executando = false;
if (function_exists('pcntl_async_signals')) {
    pcntl_async_signals(true);
    pcntl_signal(SIGINT, function () {
        if ($GLOBALS['__executando']) {
            throw new \RuntimeException('__braytech_interrompido__');
        }
    });
}

if (!empty($argv[1])) {
    require_once $argv[1];
}
if (!empty($argv[2])) {
    $__app = require $argv[2];
    $__app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
}

/** Separa a célula em [corpo, última expressão | null], pelo tokenizador. */
function __separar($codigo) {
    $aparado = rtrim($codigo);
    if ($aparado === '' || in_array(substr($aparado, -1), [';', '}'], true)) {
        return [$codigo, null];
    }
    $tokens = token_get_all('<?php ' . $aparado);
    $fim = 0;
    $pos = 0;
    $nivel = 0;
    foreach ($tokens as $t) {
        $texto = is_array($t) ? $t[1] : $t;
        if ($texto === '(' || $texto === '[' || $texto === '{') {
            $nivel++;
        } elseif ($texto === ')' || $texto === ']' || $texto === '}') {
            $nivel--;
        }
        $pos += strlen($texto);
        if ($nivel === 0 && ($texto === ';' || $texto === '}')) {
            $fim = $pos;
        }
    }
    $fim = max(0, $fim - 6);
    return [substr($aparado, 0, $fim), substr($aparado, $fim)];
}

/** mostrar_imagem($bytes, 'image/png'): o PHP não tem a convenção do Jupyter. */
function mostrar_imagem($bytes, $mime = 'image/png') {
    __enviar(['tipo' => 'resultado', 'exec' => $GLOBALS['__exec'] ?? null,
        'saida' => ['tipo' => 'imagem', 'mime' => $mime, 'dados' => base64_encode($bytes)]]);
}

function __tabela($v) {
    if (is_object($v) && method_exists($v, 'toArray')) {
        $v = $v->toArray();
    }
    if (!is_array($v) || $v === [] || !array_is_list($v)) {
        return null;
    }
    $colunas = [];
    foreach ($v as $linha) {
        if (is_object($linha)) {
            $linha = (array) $linha;
        }
        if (!is_array($linha) || array_is_list($linha)) {
            return null;
        }
        foreach (array_keys($linha) as $k) {
            if (!in_array($k, $colunas, true)) {
                $colunas[] = $k;
            }
        }
    }
    $linhas = [];
    foreach (array_slice($v, 0, 500) as $linha) {
        $linha = (array) $linha;
        $linhas[] = array_map(fn($c) => $linha[$c] ?? null, $colunas);
    }
    return ['tipo' => 'tabela', 'colunas' => array_map('strval', $colunas), 'linhas' => $linhas, 'total' => count($v)];
}

function __mostrar($exec, $valor) {
    $saida = __tabela($valor);
    if ($saida === null) {
        $texto = (is_scalar($valor) || $valor === null) ? var_export($valor, true) : print_r($valor, true);
        if (strlen($texto) > 200000) {
            $texto = substr($texto, 0, 200000) . "\n… (cortado)";
        }
        $saida = ['tipo' => 'texto', 'fluxo' => 'saida', 'texto' => rtrim($texto) . "\n"];
    }
    __enviar(['tipo' => 'resultado', 'exec' => $exec, 'saida' => $saida]);
}

// ---- A cascata entre linguagens (spec 113) ----
// O motor pede "o que mudou?" (exportar) e entrega o que outra linguagem mudou
// (importar). Só DADO passa: escalares, arrays, stdClass e datas. Uma lista
// de arrays associativos viaja como tabela (colunas + linhas). A impressão
// digital (sha1 do JSON) diz o que mudou, inclusive por dentro.
const __TABELA = '__braytech_tabela__';
$__impressoes = [];

function __dado($v, $nivel = 0) {
    if ($nivel > 64) {
        throw new \InvalidArgumentException('fundo demais');
    }
    if ($v === null || is_bool($v) || is_int($v) || is_string($v)) {
        return $v;
    }
    if (is_float($v)) {
        return is_finite($v) ? $v : null;
    }
    if ($v instanceof \DateTimeInterface) {
        return $v->format(DATE_ATOM);
    }
    if (is_array($v)) {
        $r = [];
        foreach ($v as $k => $x) {
            $r[$k] = __dado($x, $nivel + 1);
        }
        return $r;
    }
    if ($v instanceof \stdClass) {
        $r = new \stdClass();
        foreach (get_object_vars($v) as $k => $x) {
            $r->$k = __dado($x, $nivel + 1);
        }
        return $r;
    }
    throw new \InvalidArgumentException('objeto');
}

function __eh_registro($x) {
    return (is_array($x) && $x !== [] && !array_is_list($x)) || $x instanceof \stdClass;
}

function __exportavel($v) {
    if (is_array($v) && $v !== [] && array_is_list($v) && count(array_filter($v, '__eh_registro')) === count($v)) {
        $colunas = [];
        foreach ($v as $linha) {
            foreach (array_keys((array) $linha) as $k) {
                if (!in_array((string) $k, $colunas, true)) {
                    $colunas[] = (string) $k;
                }
            }
        }
        $linhas = [];
        foreach ($v as $linha) {
            $linha = (array) $linha;
            $linhas[] = array_map(fn($c) => __dado($linha[$c] ?? null), $colunas);
        }
        return [__TABELA => true, 'colunas' => $colunas, 'linhas' => $linhas];
    }
    return __dado($v);
}

function __serializado($nome) {
    if (!array_key_exists($nome, $GLOBALS)) {
        return null;
    }
    try {
        $json = json_encode(__exportavel($GLOBALS[$nome]),
            JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
        return $json;
    } catch (\Throwable $e) {
        return null;
    }
}

function __lembrar($nome) {
    $s = __serializado($nome);
    if ($s !== null) {
        $GLOBALS['__impressoes'][$nome] = sha1($s);
    }
}

function __exportar($pedido) {
    $partes = [];
    foreach (array_keys($GLOBALS) as $nome) {
        if (in_array($nome, $GLOBALS['__iniciais'], true) || str_starts_with((string) $nome, '_')) {
            continue;
        }
        $s = __serializado($nome);
        if ($s === null) {
            continue;
        }
        $h = sha1($s);
        if (($GLOBALS['__impressoes'][$nome] ?? null) === $h) {
            continue;
        }
        $GLOBALS['__impressoes'][$nome] = $h;
        $partes[] = json_encode((string) $nome) . ':' . $s;
    }
    // Montado à mão: o valor já é JSON, e serializar de novo dobraria o custo.
    fwrite(STDOUT, $GLOBALS['__marca'] . '{"tipo":"exportado","pedido":' . (int) $pedido
        . ',"valores":{' . implode(',', $partes) . '}}' . "\n");
    fflush(STDOUT);
}

function __de_tabela($v) {
    if (is_array($v) && ($v[__TABELA] ?? null) === true) {
        $cols = $v['colunas'];
        return array_map(fn($l) => array_combine($cols, $l), $v['linhas']);
    }
    return $v;
}

function __importar($pedido, $valores) {
    foreach ($valores as $nome => $v) {
        $GLOBALS[$nome] = __de_tabela($v);
        __lembrar($nome);
    }
    __enviar(['tipo' => 'importado', 'pedido' => $pedido]);
}

// ---- sql() dentro do kernel (spec 114, C) ----
// O motor executa pela conexão do notebook e responde pelo canal. O PHP não
// tem thread: sql() LÊ o canal até a resposta dele, e o que chegar no meio
// fica guardado para o laço principal. Cada sql() vale sozinho; tudo-ou-nada
// só com sql_transacao(function () { ... }).
$__pendentes = [];
$__sql_proximo = 1;
$__sql_transacao = null;

function __pedir_ao_motor($dados) {
    $pedido = $GLOBALS['__sql_proximo']++;
    $dados['pedido'] = $pedido;
    __enviar($dados);
    while (($linha = fgets(STDIN)) !== false) {
        $m = json_decode($linha, true);
        if (is_array($m) && ($m['tipo'] ?? null) === 'sql-resposta' && ($m['pedido'] ?? null) === $pedido) {
            if (!empty($m['erro'])) {
                throw new \RuntimeException($m['erro']);
            }
            return $m;
        }
        $GLOBALS['__pendentes'][] = $linha;
    }
    throw new \RuntimeException('O canal com o motor fechou.');
}

function sql($texto, $params = []) {
    $r = __pedir_ao_motor(['tipo' => 'sql', 'texto' => (string) $texto, 'params' => array_values((array) $params),
        'transacao' => $GLOBALS['__sql_transacao']]);
    if (empty($r['colunas'])) {
        return ['linhasAfetadas' => $r['linhasAfetadas'] ?? null];
    }
    $cols = $r['colunas'];
    return array_map(fn($l) => array_combine($cols, $l), $r['linhas']);
}

function sql_transacao(callable $bloco) {
    // Dentro de outra: faz parte da mesma (não existe meia transação).
    if ($GLOBALS['__sql_transacao'] !== null) {
        return $bloco();
    }
    $id = __pedir_ao_motor(['tipo' => 'sql-transacao', 'acao' => 'comecar'])['transacao'];
    $GLOBALS['__sql_transacao'] = $id;
    try {
        $valor = $bloco();
        $GLOBALS['__sql_transacao'] = null;
        __pedir_ao_motor(['tipo' => 'sql-transacao', 'acao' => 'confirmar', 'transacao' => $id]);
        return $valor;
    } catch (\Throwable $e) {
        $GLOBALS['__sql_transacao'] = null;
        try {
            __pedir_ao_motor(['tipo' => 'sql-transacao', 'acao' => 'desfazer', 'transacao' => $id]);
        } catch (\Throwable $ignorado) {
        }
        throw $e;
    }
}

// O que já existe antes da primeira célula não é do usuário.
$__iniciais = array_keys($GLOBALS);
$__iniciais[] = '__iniciais';
__enviar(['tipo' => 'pronto', 'versao' => PHP_VERSION, 'executavel' => PHP_BINARY, 'pandas' => false]);

$__definindo = null;
while (($__linha = (count($__pendentes) > 0 ? array_shift($__pendentes) : fgets(STDIN))) !== false) {
    $__p = json_decode($__linha, true);
    if (!is_array($__p) || !isset($__p['tipo'])) {
        continue;
    }
    if ($__p['tipo'] === 'executar') {
        $__exec = $__p['exec'];
        $__ok = false;
        $__codigo = preg_replace('/^\s*<\?php/', '', (string) ($__p['codigo'] ?? ''));
        [$__corpo, $__expr] = __separar($__codigo);
        try {
            $__executando = true;
            if (trim($__corpo) !== '') {
                eval($__corpo);
            }
            if ($__expr !== null && trim($__expr) !== '') {
                $__valor = eval('return ' . $__expr . ';');
                __mostrar($__exec, $__valor);
            }
            $__ok = true;
        } catch (\Throwable $__e) {
            $__msg = $__e->getMessage() === '__braytech_interrompido__'
                ? 'Interrompido.'
                : get_class($__e) . ': ' . $__e->getMessage() . ' (linha ' . $__e->getLine() . ')';
            __enviar(['tipo' => 'erro', 'exec' => $__exec, 'mensagem' => $__msg]);
        } finally {
            $__executando = false;
            __enviar(['tipo' => 'fim', 'exec' => $__exec, 'ok' => $__ok]);
        }
    } elseif ($__p['tipo'] === 'obter') {
        $__valores = [];
        $__faltando = [];
        foreach ($__p['nomes'] ?? [] as $__nome) {
            if (!array_key_exists($__nome, $GLOBALS)) {
                $__faltando[] = $__nome;
                continue;
            }
            $__v = $GLOBALS[$__nome];
            if (is_object($__v) && method_exists($__v, 'toArray')) {
                $__v = $__v->toArray();
            }
            $__valores[$__nome] = $__v;
        }
        __enviar(['tipo' => 'valores', 'pedido' => $__p['pedido'] ?? null,
            'valores' => (object) $__valores, 'faltando' => $__faltando, 'erros' => (object) []]);
    } elseif ($__p['tipo'] === 'exportar') {
        __exportar($__p['pedido'] ?? 0);
    } elseif ($__p['tipo'] === 'importar') {
        __importar($__p['pedido'] ?? null, is_array($__p['valores'] ?? null) ? $__p['valores'] : []);
    } elseif ($__p['tipo'] === 'definir-inicio') {
        $__definindo = ['nome' => $__p['nome'], 'colunas' => $__p['colunas'], 'linhas' => []];
    } elseif ($__p['tipo'] === 'definir-lote' && $__definindo !== null) {
        array_push($__definindo['linhas'], ...$__p['linhas']);
    } elseif ($__p['tipo'] === 'definir-fim' && $__definindo !== null) {
        $__cols = $__definindo['colunas'];
        $GLOBALS[$__definindo['nome']] = array_map(fn($l) => array_combine($__cols, $l), $__definindo['linhas']);
        // Chegou igual em todas as linguagens: não é "mudança" a exportar.
        __lembrar($__definindo['nome']);
        __enviar(['tipo' => 'definido', 'nome' => $__definindo['nome'], 'linhas' => count($__definindo['linhas']), 'forma' => 'array']);
        $__definindo = null;
    }
}
`;
