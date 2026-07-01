import type { SplitSession } from '../types'

const SESSIONS_KEY = 'splitsia_sessions'
const DRAFT_KEY = 'splitsia_draft'

export function loadSessions(): SplitSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    return raw ? (JSON.parse(raw) as SplitSession[]) : []
  } catch {
    return []
  }
}

export function saveSession(session: SplitSession): void {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === session.id)
  if (idx >= 0) {
    sessions[idx] = session
  } else {
    sessions.unshift(session)
  }
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

export function deleteSession(id: string): void {
  const sessions = loadSessions().filter((s) => s.id !== id)
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

export function loadDraft(): SplitSession | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as SplitSession) : null
  } catch {
    return null
  }
}

export function saveDraft(session: SplitSession): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(session))
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY)
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
