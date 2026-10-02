import { initializeSolver, solve } from "./domain/engine";
import wasmUrl from "highs/runtime?url";
import { documentSchema } from "./domain/model";
self.onmessage = async (event) => {
  try {
    const d = documentSchema.parse(event.data);
    await initializeSolver({ locateFile: () => wasmUrl });
    const result = await solve(d, (progress) =>
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
