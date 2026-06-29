export declare global {
  namespace NodeJS {
    interface ProcessEnv {
      [key: string]: string | undefined;
      NODE_ENV?: "development" | "production" | "test";
      SQLITE_PATH: string;
      REDIS_URL: string;
    }
  }
}
