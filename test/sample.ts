import { createPersistentBus } from "../dist/main.mjs";
import { createDeferred } from "../src/utils/utility.ts";

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
  const publisherName = "sample";

  const { publish, subscribe, tryClose } = await createPersistentBus<
    PublishEvents,
    SubscribeEvents
  >(publisherName);

  const deferred = createDeferred();

  subscribe("started", async (envelope) => {
    console.log(envelope.eventName);
    await publish("finished", { totalTime: 0 });
  });

  subscribe("finished", async (envelope) => {
    console.log(envelope.eventName);
    deferred.resolve(null);
  });

  await publish("started", { userId: "0" });
  await deferred.promise;
  await tryClose();
}

try {
  await sample();
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
