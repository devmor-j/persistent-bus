export declare global {
  namespace NodeJS {
    interface ProcessEnv {
      [key: string]: string | undefined;
      NODE_ENV?: "development" | "production" | "test";
      POSTGRES_URL: string;
      REDIS_URL: string;
    }
  }
}
