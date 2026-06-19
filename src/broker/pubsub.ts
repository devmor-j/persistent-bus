import { createClient } from "redis";

export async function createPubsub(redisUrl: string) {
  const [publisher, subscriber] = await Promise.all([
    createClient({ url: redisUrl }).connect(),
    createClient({ url: redisUrl }).connect(),
  ]);

  let isClosing = false;

  const tryClose = async () => {
    if (isClosing) return;
    isClosing = true;

    await Promise.allSettled([publisher.close(), subscriber.close()]);
  };

  process.on("SIGINT", tryClose);
  process.on("SIGTERM", tryClose);

  return {
    publish: publisher.publish.bind(publisher),
    subscribe: subscriber.subscribe.bind(subscriber),
    tryClose,
  };
}
