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

__enviar(['tipo' => 'pronto', 'versao' => PHP_VERSION, 'executavel' => PHP_BINARY, 'pandas' => false]);

$__definindo = null;
while (($__linha = fgets(STDIN)) !== false) {
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
    } elseif ($__p['tipo'] === 'definir-inicio') {
        $__definindo = ['nome' => $__p['nome'], 'colunas' => $__p['colunas'], 'linhas' => []];
    } elseif ($__p['tipo'] === 'definir-lote' && $__definindo !== null) {
        array_push($__definindo['linhas'], ...$__p['linhas']);
    } elseif ($__p['tipo'] === 'definir-fim' && $__definindo !== null) {
        $__cols = $__definindo['colunas'];
        $GLOBALS[$__definindo['nome']] = array_map(fn($l) => array_combine($__cols, $l), $__definindo['linhas']);
        __enviar(['tipo' => 'definido', 'nome' => $__definindo['nome'], 'linhas' => count($__definindo['linhas']), 'forma' => 'array']);
        $__definindo = null;
    }
}
`;
