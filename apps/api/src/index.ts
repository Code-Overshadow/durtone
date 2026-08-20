import { Elysia } from 'elysia';

const port = Number(process.env.PORT ?? 3000);

const app = new Elysia()
  .get('/health', () => ({ status: 'ok', service: 'durtone-api' }))
  .get('/', () => ({ name: 'DurtOne Control Plane', status: 'running' }))
  .listen(port);

console.log(`DurtOne API listening on http://localhost:${app.server?.port}`);