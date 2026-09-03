export const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.env.VERCEL_ENV === 'production' ||
  Boolean(process.env.VERCEL);

export const redisEnabled = !isProduction || Boolean(process.env.REDIS_URL);