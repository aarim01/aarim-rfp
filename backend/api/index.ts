import serverless = require('serverless-http');
import { createApp } from '../src/main';

let cachedHandler: ReturnType<typeof serverless> | undefined;

export default async function handler(request: any, response: any) {
  if (!cachedHandler) {
    const app = await createApp();
    cachedHandler = serverless(app.getHttpAdapter().getInstance());
  }

  return cachedHandler(request, response);
}
