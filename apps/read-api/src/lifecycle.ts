import type { FastifyInstance } from "fastify";

/** Owns only this web process; shutdown never manages the Kakao connection. */
export class Lifecycle {
  draining = false;
  private jobs = new Set<Promise<unknown>>();
  private shutdown?: Promise<boolean>;

  run<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this.draining) return Promise.resolve(undefined);
    const job = Promise.resolve().then(work);
    this.jobs.add(job);
    void job.then(
      () => this.jobs.delete(job),
      () => this.jobs.delete(job),
    );
    return job;
  }

  stop(options: {
    stopAccepting: () => Promise<unknown>;
    drainAdapters: () => Promise<unknown>;
    cleanup: () => Promise<unknown>;
    timeoutMs: number;
    onTimeout: () => void;
  }): Promise<boolean> {
    if (this.shutdown) return this.shutdown;
    this.draining = true;
    this.shutdown = this.finish(options);
    return this.shutdown;
  }

  private async finish(options: Parameters<Lifecycle["stop"]>[0]) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = (async () => {
      // Close the listener before dependencies: in-flight saves can still finish.
      await options.stopAccepting();
      await Promise.allSettled([...this.jobs]);
      await options.drainAdapters();
      return true;
    })();
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        options.onTimeout();
        resolve(false);
      }, options.timeoutMs);
    });
    try {
      return await Promise.race([completed, deadline]);
    } finally {
      clearTimeout(timer);
      await options.cleanup();
    }
  }
}

export function registerDrainHeaders(
  app: FastifyInstance,
  lifecycle: Lifecycle,
) {
  app.addHook("onSend", async (_request, reply, payload) => {
    // An accepted request must not keep its socket idle after its response finishes.
    if (lifecycle.draining) reply.header("Connection", "close");
    return payload;
  });
}
