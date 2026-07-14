// Board-level drop handling for Pragmatic drag and drop. Components mark
// themselves draggable / drop targets with typed data; this one monitor
// turns the final drop into a store.moveCard / store.moveList.

import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types'
import { moveCard, moveList, store } from './store'

export interface CardDragData { type: 'card'; cardId: number; listId: number; [key: string | symbol]: unknown }
export interface CardsDropData { type: 'cards'; listId: number; [key: string | symbol]: unknown }
export interface ListDragData { type: 'list'; listId: number; [key: string | symbol]: unknown }

export function setupBoardMonitor(): () => void {
  return monitorForElements({
    onDrop({ source, location }) {
      const src = source.data as CardDragData | ListDragData
      const targets = location.current.dropTargets
      if (!targets.length || !store.board) return

      if (src.type === 'card') {
        // innermost card target wins; a bare list surface appends
        const overCard = targets.find((t) => t.data.type === 'card')
        const overCards = targets.find((t) => t.data.type === 'cards')
        if (overCard) {
          const data = overCard.data as CardDragData
          const dest = store.board.lists.find((l) => l.id === data.listId)
          if (!dest) return
          const others = dest.cards.filter((c) => c.id !== src.cardId)
          let index = others.findIndex((c) => c.id === data.cardId)
          if (index < 0) return
          if (extractClosestEdge(data) === 'bottom') index++
          moveCard(src.cardId, data.listId, index)
        } else if (overCards) {
          const listId = (overCards.data as CardsDropData).listId
          const dest = store.board.lists.find((l) => l.id === listId)
          if (!dest) return
          moveCard(src.cardId, listId, dest.cards.filter((c) => c.id !== src.cardId).length)
        }
      } else if (src.type === 'list') {
        const overList = targets.find((t) => t.data.type === 'list' && t.data.listId !== src.listId)
        if (!overList) return
        const data = overList.data as ListDragData
        const others = store.board.lists.filter((l) => l.id !== src.listId)
        let index = others.findIndex((l) => l.id === data.listId)
        if (index < 0) return
        if (extractClosestEdge(data) === 'right') index++
        moveList(src.listId, index)
      }
    },
  })
}

export type { Edge }
