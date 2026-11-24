// next dev compiles each route on its first visit and then reloads every open page. Visiting
// them all once before the tests (the web server is already up) keeps tests from being
// bounced back mid-navigation. Unknown slug: the route still compiles, the page is a 404.
const ROUTES = ["", "/clientes", "/ventas", "/catalogo", "/aprendido", "/whatsapp", "/configuracion/agente", "/configuracion/tablero", "/configuracion/negocio"];

export default async function warmUp(): Promise<void> {
  await fetch("http://localhost:3100/");
  for (const r of ROUTES) await fetch(`http://localhost:3100/t/warm-up${r}`);
}
