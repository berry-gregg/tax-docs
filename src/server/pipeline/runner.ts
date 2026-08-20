export type PipelineRunner = { start(documentId: string): void };

export const noopRunner: PipelineRunner = {
  start() {},
};
