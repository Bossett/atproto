import { Generated } from 'kysely'
import {
  REVIEWCLOSED,
  REVIEWOPEN,
  REVIEWESCALATED,
  REVIEWNONE,
} from '../../lexicon/types/com/atproto/admin/defs'

export const subjectStatusTableName = 'moderation_subject_status'

export interface ModerationSubjectStatus {
  id: Generated<number>
  did: string
  recordPath: string
  recordCid: string | null
  blobCids: string[] | null
  reviewState:
    | typeof REVIEWCLOSED
    | typeof REVIEWOPEN
    | typeof REVIEWESCALATED
    | typeof REVIEWNONE
  createdAt: string
  updatedAt: string
  lastReviewedBy: string | null
  lastReviewedAt: string | null
  lastReportedAt: string | null
  lastAppealedAt: string | null
  muteUntil: string | null
  suspendUntil: string | null
  takendown: boolean
  appealed: boolean | null
  comment: string | null
  tags: string[] | null
}

export type PartialDB = {
  [subjectStatusTableName]: ModerationSubjectStatus
}
