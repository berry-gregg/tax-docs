import { reclassifyDocument, runPipeline, type PipelineDeps } from "./orchestrator.ts";

export type PipelineRunner = {
  /** Full quality → classify → extract pipeline for a freshly received document. */
  start(documentId: string): void;
  /**
   * Extract-only continuation after a reviewer overrides the document type. Never re-runs
   * classification — the human's choice must not be second-guessed by the model.
   */
  startReclassify(documentId: string, documentTypeId: string): void;
};

export const noopRunner: PipelineRunner = {
  start() {},
  startReclassify() {},
};

function logBackgroundFailure(kind: string, documentId: string): (error: unknown) => void {
  return (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${kind} for document ${documentId} failed: ${message}`);
  };
}

/**
 * Fire-and-forget wrapper around the orchestrator entry points. Stage failures are already
 * recorded on the document; this catch only covers the cases that never reached a document (a
 * missing id, a dead database) so a background run can never take the server down with it.
 */
export function createRunner(deps: PipelineDeps): PipelineRunner {
  return {
    start(documentId: string) {
      void runPipeline(documentId, deps).catch(logBackgroundFailure("Pipeline run", documentId));
    },
    startReclassify(documentId: string, documentTypeId: string) {
      void reclassifyDocument(documentId, documentTypeId, deps).catch(
        logBackgroundFailure("Reclassify run", documentId),
      );
    },
  };
}
