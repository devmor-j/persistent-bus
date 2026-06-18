import { createPersistentBus } from "./src/main.js";

type PublishEvents = {
  started: {
    userId: string;
  };
};

type SubscribeEvents = {
  finished: {
    totalTime: number;
  };
};

const { publish, subscribe } = await createPersistentBus<
  PublishEvents,
  SubscribeEvents
>("sample");

publish.started({ userId: "me" });

subscribe.finished(async (envelope) => {
  console.log(envelope.eventName === "finished");
});
