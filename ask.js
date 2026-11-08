// Função de servidor (Vercel). Guarda a chave da IA e aplica os temas permitidos.
// Variável necessária no painel da Vercel: ANTHROPIC_API_KEY
const RISK_RE = /(machuc|me bate|bateu em mim|me toc|abus|segredo|sangue|\barmas?\b|me matar|quero morrer|suicid|veneno|remedio|nao conte|nao conta|nao pode contar|ninguem pode saber)/;
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MODEL = 'claude-haiku-5-5';
const DAILY_LIMIT = 40; // por IP, por dia. Um teto de gasto também deve ser definido no painel do provedor.
const counts = new Map(); // zera quando a função reinicia; é uma proteção básica

const SYS = [
  'Você responde a uma criança de 7 anos, em português do Brasil, como o personagem Enrico, um programa de computador.',
  'Regras:',
  '- Use frases curtas, palavras simples e no máximo três frases.',
  '- Responda somente sobre estes temas: ciência simples (céu, plantas, corpo, animais, tempo), histórias infantis, leitura e escrita, brincadeiras, emoções e calma.',
  '- Se a pergunta estiver fora desses temas, responda somente com a palavra OFFTOPIC.',
  '- Se perguntarem se você é uma pessoa, diga que é um programa de computador.',
  '- Nunca peça nome, endereço, escola, fotos ou segredos.',
  '- Não dê diagnóstico, remédio, dose ou conselho médico. Diga para conversar com um adulto de casa.',
  '- Se a pergunta falar de perigo, machucado, medo de alguém, algo sexual ou violento, responda somente: Conte agora para um adulto de confiança.'
].join('\n');

function clientKey(req){
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'anon';
}

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({error: 'method'});

  const q = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, 200) : '';
  if(!q) return res.status(400).json({error: 'empty'});
  if(RISK_RE.test(norm(q))) return res.status(200).json({blocked: true});

  const day = new Date().toISOString().slice(0, 10);
  const key = day + ':' + clientKey(req);
  const used = counts.get(key) || 0;
  if(used >= DAILY_LIMIT) return res.status(429).json({error: 'limit'});
  counts.set(key, used + 1);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if(!apiKey) return res.status(503).json({error: 'not_configured'});

  try{
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: MODEL, max_tokens: 220, system: SYS, messages: [{role: 'user', content: q}]})
    });
    if(!r.ok) return res.status(502).json({error: 'upstream'});
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if(!text) return res.status(502).json({error: 'empty_answer'});
    if(text === 'OFFTOPIC' || text.startsWith('OFFTOPIC')) return res.status(200).json({offtopic: true});
    if(RISK_RE.test(norm(text))) return res.status(200).json({blocked: true});
    return res.status(200).json({answer: text.slice(0, 400)});
  }catch(e){
    // Não registra a pergunta nem a resposta: só o erro genérico.
    return res.status(502).json({error: 'network'});
  }
}
