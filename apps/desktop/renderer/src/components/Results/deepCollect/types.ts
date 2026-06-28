import type { ProgressOfferCardItem } from '../ProgressOfferCard';

export type DeepCollectTaskStatus = 'queued' | 'collecting' | 'success' | 'failed';

export type DeepCollectTask = {
  key: string;
  offerId?: string;
  title?: string;
  image?: string;
  status: DeepCollectTaskStatus;
  message?: string;
  profile?: string;
  attempt?: number;
  createdAt: string;
  updatedAt?: string;
  finishedAt?: string;
};

export type DeepCollectTaskPatch = Partial<DeepCollectTask>;

export type DeepQueueEntry = {
  key: string;
  item: ProgressOfferCardItem;
};

export type OfferBatchJson = {
  mode?: string;
  total?: number;
  success?: number;
  failed?: number;
  offerIds?: string[];
  offers?: Array<Record<string, unknown>>;
  failures?: Array<Record<string, unknown>>;
};

export type DeepTasksChangeHandler = (tasks: DeepCollectTask[]) => void;
