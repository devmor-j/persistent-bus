import "@dotenvx/dotenvx/config";
import { createPersistentBus, type PersistentBusOptions } from "./dist/main.mjs";
import { createRedisClient } from "./test/utils.ts";

const { SQLITE_PATH } = process.env;

type PublishEvents = {
  started: {
    userId: string;
  };
  finished: {
    totalTime: number;
  };
};

type SubscribeEvents = {
  started: {
    userId: string;
  };
  finished: {
    totalTime: number;
  };
};

async function sample() {
  const pubsub = await createRedisClient();

  const options = {
    publisherName: "sample",
    pubsub,
    sqlitePath: SQLITE_PATH,
  } as const satisfies PersistentBusOptions;

  const { publish, subscribe } = createPersistentBus<
    PublishEvents,
    SubscribeEvents
  >(options);

  const done = new Promise<void>((resolve) => {
    subscribe("finished", async (envelope) => {
      console.log(envelope.eventName);
      resolve();
    });
  });

  subscribe("started", async (envelope) => {
    console.log(envelope.eventName);
    await publish("finished", { totalTime: 0 });
  });

  await publish("started", { userId: "0" });
  await done;
  await pubsub.tryClose();
}

try {
  await sample();
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
