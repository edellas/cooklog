// @ts-nocheck
// Supabase Edge Function
// Nome: generate-recipe-from-image
// Percorso suggerito: supabase/functions/generate-recipe-from-image/index.ts

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type RequestBody = {
  imageUrl?: string;
  notes?: string;
  language?: 'it';
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!OPENAI_API_KEY) {
      return json(500, { error: 'Secret OPENAI_API_KEY mancante.' });
    }

    const body = (await req.json()) as RequestBody;
    if (!body.imageUrl || typeof body.imageUrl !== 'string') {
      return json(400, { error: 'imageUrl obbligatorio.' });
    }
    if (body.language && body.language !== 'it') {
      return json(400, { error: 'language deve essere \"it\".' });
    }

    const prompt =
      'Analizza questa immagine di un piatto cucinato. Genera una ricetta plausibile in italiano. ' +
      'Se non sei sicuro degli ingredienti, usa formulazioni ragionevoli ma non inventare ingredienti troppo specifici. ' +
      'Mantieni la ricetta semplice, domestica, realistica. Restituisci solo JSON valido, senza markdown.';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Sei un assistente di ricette. Rispondi solo con JSON valido.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'text', text: `Note utente: ${body.notes ?? 'nessuna'}` },
              { type: 'image_url', image_url: { url: body.imageUrl } },
            ],
          },
        ],
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      return json(502, { error: `Provider AI non disponibile: ${text}` });
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return json(502, { error: 'Risposta AI non valida.' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return json(502, { error: 'Il provider ha restituito JSON non valido.' });
    }

    const result = parsed as Record<string, unknown>;
    if (
      typeof result.title !== 'string' ||
      typeof result.description !== 'string' ||
      typeof result.category !== 'string' ||
      typeof result.cookingTimeMinutes !== 'number' ||
      typeof result.servings !== 'number' ||
      !Array.isArray(result.ingredients) ||
      !Array.isArray(result.steps) ||
      !Array.isArray(result.interests)
    ) {
      return json(502, { error: 'Schema risposta AI incompleto.' });
    }

    return json(200, result);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return json(504, { error: 'Timeout della funzione AI.' });
    }
    return json(500, { error: `Errore interno: ${(err as Error).message}` });
  }
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
