export interface ChecklistItem {
  text: string
  done: boolean
}

export interface Card {
  id: number
  list_id: number
  title: string
  notes: string
  labels: string[]
  checklist: ChecklistItem[]
  due: number | null
  done: boolean
  pos: number
  created_at: number
}

export interface List {
  id: number
  title: string
  cards: Card[]
}

export interface Board {
  id: number
  title: string
  background: string
  hasImage: boolean
  labels: Record<string, string>
  lists: List[]
}

export interface BoardStub {
  id: number
  title: string
  background: string
  hasImage: boolean
}

export interface PaletteBoard {
  id: number
  title: string
  lists: { id: number; title: string }[]
}
