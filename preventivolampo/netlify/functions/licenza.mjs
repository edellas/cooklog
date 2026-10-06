// Netlify Functions: risponde su /api/licenza.
import { gestisciRichiesta } from "../../lib/licenza.mjs";

export default async (req) => gestisciRichiesta(req, process.env);

export const config = { path: "/api/licenza" };
