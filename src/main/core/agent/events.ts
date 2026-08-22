import type { SDKMessage } from '@cursor/sdk'
import type { AgentChatEvent } from '../../../shared/agent'

function textFromBlocks(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text ?? '')
    .join('')
}

/**
 * SDK-Stream → schmale UI-Events. Unbekannte Felder in tool args/result ignorieren
 * (SDK: Schema der Payloads ist nicht stabil).
 */
export function mapSdkMessage(event: SDKMessage): AgentChatEvent[] {
  switch (event.type) {
    case 'system':
      return []
    case 'user': {
      const text = textFromBlocks(event.message.content)
      return text ? [{ type: 'user', text }] : []
    }
    case 'assistant': {
      const text = textFromBlocks(event.message.content)
      return text ? [{ type: 'assistant', text }] : []
    }
    case 'thinking':
      return event.text ? [{ type: 'thinking', text: event.text }] : []
    case 'tool_call':
      return [{ type: 'tool', callId: event.call_id, name: event.name, status: event.status }]
    case 'status':
      return event.message ? [{ type: 'status', text: event.message }] : []
    case 'request':
      return [{ type: 'request', text: 'Der Agent wartet auf eine Freigabe — in den Einstellungen Auto-Review prüfen oder in der Nachricht fortfahren.' }]
    case 'task':
      return event.text ? [{ type: 'status', text: event.text }] : []
    case 'usage': {
      const u = event.usage
      const inputTokens = u.inputTokens
      const outputTokens = u.outputTokens
      const totalTokens = u.totalTokens
      if (inputTokens == null && outputTokens == null && totalTokens == null) return []
      return [{ type: 'usage', inputTokens, outputTokens, totalTokens }]
    }
    default: {
      const _never: never = event
      void _never
      return []
    }
  }
}
