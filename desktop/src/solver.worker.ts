import { solve } from "./domain/engine";
import { documentSchema } from "./domain/model";
self.onmessage = (event) => {
  try {
    const d = documentSchema.parse(event.data);
    const result = solve(d, (progress) =>
      self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
