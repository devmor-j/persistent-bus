import { createClient } from "redis";

const { REDIS_URL } = process.env;

export async function createPubsub() {
  const publisher = await createClient({
    url: REDIS_URL,
  }).connect();

  const subscriber = await createClient({
    url: REDIS_URL,
  }).connect();

  const tryClose = async () => {
    await publisher.close().catch(() => void {});
    await subscriber.close().catch(() => void {});
  };

  process.on("SIGINT", tryClose);
  process.on("SIGTERM", tryClose);

  return {
    publish: publisher.publish.bind(publisher),
    subscribe: subscriber.subscribe.bind(subscriber),
  };
}
