import type { ConversationInfo } from './types'

export interface ConversationGroup {
  label: string
  conversations: ConversationInfo[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Split a list that is already most recent first into Today, Yesterday,
 * Previous 7 days, Previous 30 days and Older, by last activity. Empty groups are left out.
 */
export function groupByRecency(conversations: ConversationInfo[], now = new Date()): ConversationGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const bounds: [string, number][] = [
    ['Today', today],
    ['Yesterday', today - DAY_MS],
    ['Previous 7 days', today - 7 * DAY_MS],
    ['Previous 30 days', today - 30 * DAY_MS],
    ['Older', -Infinity],
  ]
  const groups = bounds.map(([label]) => ({ label, conversations: [] as ConversationInfo[] }))
  for (const conversation of conversations) {
    const time = new Date(conversation.updated_at).getTime()
    groups[bounds.findIndex(([, start]) => time >= start)].conversations.push(conversation)
  }
  return groups.filter((group) => group.conversations.length > 0)
}

/** Put `conversation` first, replacing the copy already in the list if there is one. */
export function moveToTop(list: ConversationInfo[], conversation: ConversationInfo): ConversationInfo[] {
  return [conversation, ...list.filter((other) => other.id !== conversation.id)]
}
