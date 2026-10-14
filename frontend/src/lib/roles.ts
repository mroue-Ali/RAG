import type { Role } from './types'

/** How each role reads in the UI. What each may do is decided by the server, in backend/app/services/roles.py. */
export const ROLES: Record<Role, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Everything, including the account itself.' },
  admin: { label: 'Admin', description: 'Sets up the model and the prompt, and manages users.' },
  member: { label: 'Member', description: 'Chats with the model the admins set up.' },
}
