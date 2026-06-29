# pexels-media

Endpoint remoto exclusivo para liberar midia Pexels para usuarios logados do Faber Code.

Ele nao recebe nem usa chaves de IA, projetos, arquivos, conversas ou prompts persistidos. O corpo da requisicao e usado apenas para montar a busca no Pexels e retornar o asset normalizado.

## Segredos da Edge Function

Configure no ambiente da funcao, nao no `.env` do app desktop:

- `FABER_PEXELS_API_KEY`: chave Pexels compartilhada da plataforma.
- `FABER_SESSION_SECRET`: mesmo segredo usado pelo app/backend Faber para gerar o hash HMAC das sessoes.
- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: service role usada somente dentro da Edge Function para validar `faber_sessions`.

## Contrato

Request:

```http
POST /functions/v1/pexels-media
Authorization: Bearer <session.id>
Content-Type: application/json
```

Response:

```json
{
  "ok": true,
  "media": {
    "provider": "pexels",
    "hero": null,
    "query": "professional workspace",
    "preference": "photo",
    "status": "unavailable"
  }
}
```

O token recebido no `Authorization` nunca e gravado. A funcao calcula HMAC SHA-256 com `FABER_SESSION_SECRET` e valida contra `public.faber_sessions.id`, que tambem deve conter esse HMAC.
