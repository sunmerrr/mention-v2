// Isolated real-socket signal fixture. No operational adapters or databases.
import Fastify from "fastify";
import {
  Lifecycle,
  registerDrainHeaders,
} from "../apps/read-api/src/lifecycle";

const app = Fastify();
const lifecycle = new Lifecycle();
registerDrainHeaders(app, lifecycle);
app.get("/save", async () => {
  process.stdout.write("saving\n");
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { saved: true };
});
process.once("SIGTERM", () => {
  void lifecycle
    .stop({
      stopAccepting: () => app.close(),
      drainAdapters: async () => {},
      cleanup: async () => {},
      timeoutMs: 2000,
      onTimeout: () => {},
    })
    .then((clean) => process.exit(clean ? 0 : 1));
});
const address = await app.listen({ host: "127.0.0.1", port: 0 });
process.stdout.write(`${address}\n`);
