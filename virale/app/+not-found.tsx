import { Redirect } from 'expo-router';

/** Un indirizzo che non esiste (link vecchio o sbagliato) porta alla Copertina invece che a una pagina d'errore. */
export default function NotFound() {
  return <Redirect href="/" />;
}
