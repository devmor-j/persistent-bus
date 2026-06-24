export type OutboxStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "DEAD";

export interface OutboxRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  eventName: string;
  eventId: string;
  publishedBy: string;
  publishedAt: string;
  processedBy: string | null;
  processedAt: string | null;
  payload: string;
  data: string;
  status: OutboxStatus;
  retries: number;
  error: string | null;
}

export interface RetriesResult {
  retries: number;
}
