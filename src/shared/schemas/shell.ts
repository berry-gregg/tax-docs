import { z } from "zod";

export const documentRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  client: z.string().min(1),
  clientMeta: z.string().min(1),
  date: z.string().min(1),
  status: z.enum(["needs-review", "missing-items", "trusted", "pending"]),
  statusLabel: z.string().min(1),
  initials: z.string().min(1).max(2),
});

export const reviewRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  client: z.string().min(1),
  clientMeta: z.string().min(1),
  date: z.string().min(1),
  amountLabel: z.string().min(1),
  category: z.string().min(1),
  queue: z.enum(["needs-review", "ready", "waiting"]),
  queueLabel: z.string().min(1),
});

export const clientRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.string().min(1),
  firm: z.string().min(1),
  location: z.string().min(1),
  reviewer: z.string().min(1),
  initials: z.string().min(1).max(2),
});

export const inboxItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  when: z.string().min(1),
});

export type DocumentRow = z.infer<typeof documentRowSchema>;
export type ReviewRow = z.infer<typeof reviewRowSchema>;
export type ClientRow = z.infer<typeof clientRowSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
