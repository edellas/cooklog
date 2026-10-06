// Cloudflare Pages Functions: risponde su /api/licenza.
import { gestisciRichiesta } from "../../lib/licenza.mjs";

export const onRequest = ({ request, env }) => gestisciRichiesta(request, env);
