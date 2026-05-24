/**
 * PetSaúde — Netlify Function: ai.js
 * ─────────────────────────────────────────────────────────────────
 * Intermediário seguro entre o browser e a API da Groq.
 * A chave da API nunca é exposta ao cliente — lida exclusivamente
 * a partir da variável de ambiente GROQ_API_KEY do Netlify.
 *
 * Aceita pedidos POST com corpo JSON e devolve sempre HTTP 200,
 * mesmo em caso de erro, para que o browser possa mostrar o
 * fallback em linguagem humana sem interromper a experiência.
 * ─────────────────────────────────────────────────────────────────
 */

/* ─── Configuração ─────────────────────────────────────────────── */

// Endpoint e modelo da Groq a utilizar
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL    = 'llama-3.3-70b-versatile';

// Parâmetros de geração de texto
const MAX_TOKENS  = 200;
const TEMPERATURE = 0.7;

/* ─── Utilitários de formatação ─────────────────────────────────── */

/**
 * Converte o código de espécie ('dog' | 'cat') para o texto
 * por extenso em português de Portugal.
 */
function especiePorExtenso(species) {
  return species === 'dog' ? 'cão' : 'gato';
}

/**
 * Converte o código de tipo de evento ('vaccine' | 'deworming')
 * para o texto por extenso em português de Portugal.
 */
function tipoPorExtenso(type) {
  return type === 'vaccine' ? 'vacina' : 'desparasitação';
}

/**
 * Formata uma data ISO ('YYYY-MM-DD') para o formato
 * por extenso em português: "21 de maio de 2026".
 * Devolve a string original se a data for inválida.
 */
function formatarData(dataISO) {
  if (!dataISO) return 'data não disponível';
  const data = new Date(dataISO + 'T12:00:00'); // meio-dia para evitar desfasamentos de fuso
  if (isNaN(data.getTime())) return dataISO;
  return data.toLocaleDateString('pt-PT', {
    day:   'numeric',
    month: 'long',
    year:  'numeric',
  });
}

/* ─── Construção dos prompts ────────────────────────────────────── */

/**
 * Constrói os prompts (sistema + utilizador) para o modo "resumo".
 * Recebe os dados do animal e o array de eventos registados.
 */
function construirPromptResumo(animal, eventos) {
  const systemPrompt = `És um assistente do PetSaúde, uma app portuguesa de saúde animal.
Geras resumos de saúde em linguagem humana, calorosa e reconfortante, em português de Portugal.
REGRAS ABSOLUTAS: Nunca fazes diagnósticos clínicos. Nunca fazes recomendações médicas.
Nunca interpretas sintomas. Escreves sempre em português de Portugal (não do Brasil).
O tom é de cuidado e tranquilidade, nunca técnico ou clínico.
O resumo tem no máximo 2-3 frases curtas.`;

  // Formatar cada evento como linha de texto legível
  const linhasEventos = (eventos || []).map(ev => {
    const tipo   = tipoPorExtenso(ev.type);
    const nome   = ev.name || tipo;
    const aplicado = ev.appliedAt ? `aplicado em ${formatarData(ev.appliedAt)}` : '';
    const proximo  = ev.nextAt    ? `próximo em ${formatarData(ev.nextAt)}`      : '';
    const detalhe  = [aplicado, proximo].filter(Boolean).join(', ');
    return `- ${tipo} "${nome}"${detalhe ? ': ' + detalhe : ''}`;
  });

  const racaTexto = animal.breed || 'raça não especificada';
  const especieTexto = especiePorExtenso(animal.species);

  const userMessage =
    `Animal: ${animal.name}, ${especieTexto}, ${racaTexto}\n` +
    `Eventos registados:\n${linhasEventos.join('\n') || '- Nenhum evento ainda'}\n\n` +
    `Gera um resumo de saúde reconfortante para o tutor de ${animal.name}.`;

  return { systemPrompt, userMessage };
}

/**
 * Constrói os prompts (sistema + utilizador) para o modo "lembrete".
 * Recebe os dados do animal e o evento específico a lembrar.
 */
function construirPromptLembrete(animal, evento) {
  const systemPrompt = `És um assistente do PetSaúde.
Geras lembretes curtos, calorosos e reconfortantes em português de Portugal.
REGRAS ABSOLUTAS: Máximo de 2 frases. Sem urgência excessiva. Sem linguagem clínica.
Tom de cuidado tranquilo: "ainda bem que o historial está organizado".
Escreves sempre em português de Portugal.`;

  const especieTexto = especiePorExtenso(animal.species);
  const tipoTexto    = tipoPorExtenso(evento.type);
  const dataTexto    = formatarData(evento.nextAt);

  const userMessage =
    `Animal: ${animal.name} (${especieTexto})\n` +
    `Evento próximo: ${tipoTexto} "${evento.name}"\n` +
    `Data prevista: ${dataTexto}\n\n` +
    `Gera um lembrete emocional e reconfortante para o tutor.`;

  return { systemPrompt, userMessage };
}

/* ─── Chamada à API da Groq ─────────────────────────────────────── */

/**
 * Envia os prompts para a API da Groq e devolve o texto gerado.
 * Lança uma excepção em caso de erro — a gestão é feita no handler principal.
 */
async function chamarGroq(systemPrompt, userMessage) {
  const resposta = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
      max_tokens:  MAX_TOKENS,
      temperature: TEMPERATURE,
    }),
  });

  // Se a API devolver um erro HTTP, registar e lançar excepção
  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '(sem detalhe)');
    throw new Error(`Groq API ${resposta.status}: ${detalhe}`);
  }

  const dados = await resposta.json();

  // Extrair o texto da primeira escolha da resposta
  const texto = dados?.choices?.[0]?.message?.content?.trim();
  if (!texto) throw new Error('Resposta da Groq sem conteúdo utilizável.');

  return texto;
}

/* ─── Handler principal da Netlify Function ─────────────────────── */

/**
 * Ponto de entrada da Netlify Function.
 * Valida o pedido, constrói os prompts e devolve o texto gerado.
 */
exports.handler = async function (event) {

  /* 1. Apenas POST é aceite */
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ erro: 'Método não permitido. Utiliza POST.' }),
    };
  }

  /* 2. Interpretar o corpo do pedido */
  let corpo;
  try {
    corpo = JSON.parse(event.body);
  } catch (_) {
    return {
      statusCode: 400,
      body: JSON.stringify({ erro: 'Corpo do pedido inválido. Esperava JSON.' }),
    };
  }

  const { tipo, animal, eventos, evento } = corpo;

  /* 3. Validação mínima dos campos obrigatórios */
  if (!tipo || !animal || !animal.name) {
    return {
      statusCode: 400,
      body: JSON.stringify({ erro: 'Campos obrigatórios em falta: tipo, animal, animal.name.' }),
    };
  }

  /* 4. Construir os prompts conforme o tipo pedido */
  let systemPrompt, userMessage;

  try {
    if (tipo === 'resumo') {
      ({ systemPrompt, userMessage } = construirPromptResumo(animal, eventos));
    } else if (tipo === 'lembrete') {
      if (!evento || !evento.nextAt) {
        return {
          statusCode: 400,
          body: JSON.stringify({ erro: 'Para tipo "lembrete" é obrigatório o campo "evento" com "nextAt".' }),
        };
      }
      ({ systemPrompt, userMessage } = construirPromptLembrete(animal, evento));
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ erro: `Tipo desconhecido: "${tipo}". Valores aceites: "resumo" ou "lembrete".` }),
      };
    }
  } catch (erroPrompt) {
    // Erro inesperado na construção do prompt — devolver 200 com texto null
    return {
      statusCode: 200,
      body: JSON.stringify({ texto: null, erro: 'Erro ao preparar o pedido de IA.' }),
    };
  }

  /* 5. Chamar a API da Groq e devolver o texto gerado */
  try {
    const texto = await chamarGroq(systemPrompt, userMessage);
    return {
      statusCode: 200,
      body: JSON.stringify({ texto }),
    };
  } catch (erroAPI) {
    // Registar o erro no log do Netlify (visível nas Functions logs)
    console.error('[PetSaúde/ai] Erro na chamada à Groq:', erroAPI.message);

    // Devolver 200 com texto null para o browser mostrar o fallback
    // sem lançar excepções nem interromper a experiência do utilizador
    return {
      statusCode: 200,
      body: JSON.stringify({
        texto: null,
        erro:  'Não foi possível gerar o texto de IA neste momento.',
      }),
    };
  }
};
