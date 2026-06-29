import type { OzonDraft } from '../../../services/api';
import type { ProgressOfferCardItem } from '../ProgressOfferCard';

export type OzonListingTaskStatus =
  | 'queued'
  | 'waiting_deep_collect'
  | 'deep_collecting'
  | 'generating_draft'
  | 'draft_ready'
  | 'needs_manual'
  | 'deep_failed'
  | 'failed';

export type OzonListingTask = {
  key: string;
  sidebarKey?: string;
  offerId?: string;
  title?: string;
  image?: string;
  status: OzonListingTaskStatus;
  message?: string;
  missingFields?: string[];
  draftId?: string;
  draft?: OzonDraft;
  createdAt: string;
  updatedAt?: string;
  finishedAt?: string;
};

export type OzonListingTaskPatch = Partial<OzonListingTask>;

export type OzonListingQueueEntry = {
  key: string;
  item: ProgressOfferCardItem;
};

export type OzonListingTasksChangeHandler = (tasks: OzonListingTask[]) => void;
