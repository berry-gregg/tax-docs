import { runPipeline, type PipelineDeps } from "./orchestrator.ts";

export type PipelineRunner = { start(documentId: string): void };

export const noopRunner: PipelineRunner = {
  start() {},
};

/**
 * Fire-and-forget wrapper around `runPipeline`. Stage failures are already recorded on the
 * document; this catch only covers the cases that never reached a document (a missing id, a
 * dead database) so a background run can never take the server down with it.
 */
export function createRunner(deps: PipelineDeps): PipelineRunner {
  return {
    start(documentId: string) {
      void runPipeline(documentId, deps).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Pipeline run for document ${documentId} failed: ${message}`);
      });
    },
  };
}
