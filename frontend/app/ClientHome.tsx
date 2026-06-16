"use client"

import { useEffect, useMemo, useRef, useState } from "react"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  ragUsed?: boolean
  ragSources?: string[]
}

type Conversation = {
  id: string
  title: string
  messages: Message[]
}

type UploadStatus = "idle" | "uploading" | "success" | "error"

const STORAGE_KEYS = {
  apiKey: "api_key",
  conversations: "conversations",
  activeConversationId: "active_conversation_id",
  useRag: "use_rag",
} as const

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getApiUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "")
}

function normalizeMessage(message: Partial<Message>, index: number): Message {
  return {
    id: message.id || `legacy_msg_${index}_${createId()}`,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content ?? "",
    ragUsed: message.ragUsed,
    ragSources: message.ragSources,
  }
}

function normalizeConversations(raw: Conversation[] | null): Conversation[] {
  if (!raw) return []

  const seen = new Set<string>()
  const normalized: Conversation[] = []

  for (const conv of raw) {
    const id = conv.id || createId()
    if (seen.has(id)) continue
    seen.add(id)

    normalized.push({
      id,
      title: conv.title || "New Chat",
      messages: (conv.messages ?? []).map((msg, index) => normalizeMessage(msg, index)),
    })
  }

  return normalized
}

export default function ClientHome() {
  const apiUrl = useMemo(() => getApiUrl(), [])

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEYS.apiKey) ?? "")
  const [apiKeyInput, setApiKeyInput] = useState(
    () => localStorage.getItem(STORAGE_KEYS.apiKey) ?? ""
  )
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)

  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [useRag, setUseRag] = useState(
    () => localStorage.getItem(STORAGE_KEYS.useRag) !== "false"
  )
  const [knowledgeChunks, setKnowledgeChunks] = useState<number | null>(null)

  const [conversations, setConversations] = useState<Conversation[]>(() =>
    normalizeConversations(
      safeJsonParse<Conversation[]>(localStorage.getItem(STORAGE_KEYS.conversations))
    )
  )
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => {
    const active = localStorage.getItem(STORAGE_KEYS.activeConversationId)
    return active || null
  })

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle")
  const [uploadMessage, setUploadMessage] = useState("")
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(conversations))
  }, [conversations])

  useEffect(() => {
    if (currentConversationId) {
      localStorage.setItem(STORAGE_KEYS.activeConversationId, currentConversationId)
    } else {
      localStorage.removeItem(STORAGE_KEYS.activeConversationId)
    }
  }, [currentConversationId])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.useRag, String(useRag))
  }, [useRag])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [conversations, currentConversationId])

  const authHeaders = (extra?: Record<string, string>): Record<string, string> => ({
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    ...extra,
  })

  const currentConversation =
    conversations.find((c) => c.id === currentConversationId) ?? null

  const refreshKnowledgeStatus = async () => {
    if (!apiUrl || !apiKey) return
    try {
      const res = await fetch(`${apiUrl}/knowledge/status`, {
        headers: authHeaders(),
      })
      if (!res.ok) return
      const data = await res.json()
      setKnowledgeChunks(data.chunk_count ?? 0)
    } catch {
      // ignore status fetch errors in UI
    }
  }

  useEffect(() => {
    if (!apiKey || !apiUrl) return

    let cancelled = false

    fetch(`${apiUrl}/knowledge/status`, {
      headers: {
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setKnowledgeChunks(data.chunk_count ?? 0)
        }
      })
      .catch(() => {
        // ignore status fetch errors in UI
      })

    return () => {
      cancelled = true
    }
  }, [apiKey, apiUrl])

  const saveApiKey = () => {
    const trimmed = apiKeyInput.trim()
    localStorage.setItem(STORAGE_KEYS.apiKey, trimmed)
    setApiKey(trimmed)
    setShowApiKeyModal(false)
  }

  const createNewConversation = () => {
    const newConversation: Conversation = {
      id: createId(),
      title: "New Chat",
      messages: [],
    }
    setConversations((prev) => [newConversation, ...prev])
    setCurrentConversationId(newConversation.id)
  }

  const deleteConversation = (id: string) => {
    setConversations((prev) => {
      const filtered = prev.filter((conv) => conv.id !== id)
      setCurrentConversationId((prevId) => {
        if (prevId !== id) return prevId
        return filtered.length > 0 ? filtered[0].id : null
      })
      return filtered
    })
  }

  const ensureApiReady = (): boolean => {
    if (!apiUrl) {
      setUploadStatus("error")
      setUploadMessage("NEXT_PUBLIC_API_URL is missing. Set it in frontend env.")
      return false
    }
    return true
  }

  const sendMessage = async () => {
    if (loading) return
    if (!message.trim()) return
    if (!ensureApiReady()) return

    if (!apiKey) {
      setShowApiKeyModal(true)
      return
    }

    streamAbortRef.current?.abort()
    const abort = new AbortController()
    streamAbortRef.current = abort

    setLoading(true)

    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: message,
    }

    const assistantMessageId = createId()
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
    }

    const outgoingText = message
    setMessage("")

    const sessionId = currentConversationId ?? createId()
    const isNewSession = !currentConversationId

    if (isNewSession) {
      setCurrentConversationId(sessionId)
    }

    setConversations((prev) => {
      const withSession = isNewSession
        ? [{ id: sessionId, title: outgoingText.slice(0, 30), messages: [] }, ...prev]
        : prev

      return withSession.map((conv) => {
        if (conv.id !== sessionId) return conv
        return {
          ...conv,
          title: conv.messages.length === 0 ? outgoingText.slice(0, 30) : conv.title,
          messages: [...conv.messages, userMessage, assistantPlaceholder],
        }
      })
    })

    try {
      const response = await fetch(`${apiUrl}/chat`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: outgoingText,
          session_id: sessionId,
          use_rag: useRag,
        }),
        signal: abort.signal,
      })

      if (response.status === 401) {
        setShowApiKeyModal(true)
        return
      }

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const ragUsed = response.headers.get("X-RAG-Used") === "true"
      const ragSources =
        response.headers
          .get("X-RAG-Sources")
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? []

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response body.")

      const decoder = new TextDecoder()
      let streamedText = ""
      let rafPending = false

      const flush = () => {
        rafPending = false
        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== sessionId) return conv
            return {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: streamedText, ragUsed, ragSources }
                  : m
              ),
            }
          })
        )
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        streamedText += decoder.decode(value, { stream: true })
        if (!rafPending) {
          rafPending = true
          requestAnimationFrame(flush)
        }
      }

      flush()
    } catch (err: unknown) {
      const isAbortError =
        err instanceof DOMException ? err.name === "AbortError" : false

      if (!isAbortError) {
        console.error(err)
        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== sessionId) return conv
            return {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: "Something went wrong." }
                  : m
              ),
            }
          })
        )
      }
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ensureApiReady()) return

    const files = fileInputRef.current?.files
    if (!files || files.length === 0) {
      setUploadMessage("Please select at least one file.")
      return
    }

    if (!apiKey) {
      setShowApiKeyModal(true)
      return
    }

    setUploadStatus("uploading")
    setUploadMessage("Uploading and indexing…")

    const formData = new FormData()
    for (const file of Array.from(files)) formData.append("files", file)

    try {
      const res = await fetch(`${apiUrl}/knowledge/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      })

      if (res.status === 401) {
        setUploadStatus("error")
        setUploadMessage("Invalid API key.")
        setShowApiKeyModal(true)
        return
      }

      if (!res.ok) {
        const text = await res.text()
        const parsed = safeJsonParse<{ detail?: string }>(text)
        setUploadStatus("error")
        setUploadMessage(parsed?.detail ?? `Upload failed (${res.status}).`)
        return
      }

      const data = await res.json()
      setUploadStatus("success")
      setUploadMessage(
        `Indexed ${data.chunks_indexed} chunks from ${data.files_processed} file(s).`
      )
      if (fileInputRef.current) fileInputRef.current.value = ""
      await refreshKnowledgeStatus()
    } catch (err) {
      console.error(err)
      setUploadStatus("error")
      setUploadMessage("Upload failed. Check the console for details.")
    }
  }

  const selectConversation = (id: string) => {
    streamAbortRef.current?.abort()
    setCurrentConversationId(id)
  }

  const ragModeLabel = useRag ? "RAG enabled" : "Direct LLM"
  const hasKnowledge = (knowledgeChunks ?? 0) > 0

  return (
    <main className="flex h-screen bg-zinc-950 text-white">
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 w-full max-w-md flex flex-col gap-4">
            <h2 className="text-xl font-bold">Connect your API key</h2>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Paste the key from your backend bootstrap config or from{" "}
              <code className="text-zinc-300">python scripts/create_api_key.py demo-user</code>.
              It is stored only in this browser.
            </p>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveApiKey()
              }}
              placeholder="ak_… or bootstrap secret"
              className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500"
            />
            <div className="flex gap-3 justify-end">
              {apiKey && (
                <button
                  onClick={() => setShowApiKeyModal(false)}
                  className="px-4 py-2 rounded-xl border border-zinc-700 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={saveApiKey}
                className="px-4 py-2 bg-white text-black rounded-xl font-semibold"
              >
                Save key
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-80 border-r border-zinc-800 flex flex-col bg-zinc-900/40">
        <div className="p-4 border-b border-zinc-800 flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Arizee Chatbot</h2>
            <p className="text-xs text-zinc-500 mt-1">Groq + Qdrant RAG</p>
          </div>
          <button
            onClick={createNewConversation}
            className="w-full bg-white text-black py-3 rounded-xl font-semibold hover:bg-zinc-100 transition"
          >
            + New Chat
          </button>
          <button
            onClick={() => setShowUploadPanel((v) => !v)}
            className="w-full bg-zinc-800 text-white py-2.5 rounded-xl text-sm hover:bg-zinc-700 transition"
          >
            {showUploadPanel ? "Hide Knowledge Upload" : "Upload Knowledge"}
          </button>
        </div>

        <div className="px-4 py-3 border-b border-zinc-800 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Retrieval mode</p>
              <p className="text-sm text-zinc-200 mt-1">{ragModeLabel}</p>
            </div>
            <button
              onClick={() => setUseRag((v) => !v)}
              className={`relative w-12 h-7 rounded-full transition ${
                useRag ? "bg-emerald-500" : "bg-zinc-700"
              }`}
              aria-label="Toggle RAG"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition ${
                  useRag ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2">
            <p className="text-xs text-zinc-500">Knowledge base</p>
            <p className="text-sm text-zinc-200 mt-1">
              {knowledgeChunks === null
                ? "Checking…"
                : hasKnowledge
                  ? `${knowledgeChunks} indexed chunks`
                  : "No documents indexed yet"}
            </p>
          </div>
        </div>

        {showUploadPanel && (
          <div className="p-4 border-b border-zinc-800">
            <form onSubmit={handleFileUpload} className="flex flex-col gap-3">
              <label className="text-xs text-zinc-400 uppercase tracking-wide">
                Upload PDF / TXT
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                multiple
                className="text-sm text-zinc-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:text-white hover:file:bg-zinc-600"
              />
              <button
                type="submit"
                disabled={uploadStatus === "uploading"}
                className="bg-blue-600 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {uploadStatus === "uploading" ? "Uploading…" : "Index Files"}
              </button>
              {uploadMessage && (
                <p
                  className={`text-xs ${
                    uploadStatus === "error" ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {uploadMessage}
                </p>
              )}
            </form>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {conversations.length === 0 && (
            <p className="text-xs text-zinc-500 px-2 py-4">No conversations yet.</p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition ${
                currentConversationId === conv.id ? "bg-zinc-800" : "hover:bg-zinc-900"
              }`}
              onClick={() => selectConversation(conv.id)}
            >
              <div className="truncate text-sm">{conv.title}</div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteConversation(conv.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={() => setShowApiKeyModal(true)}
            className="w-full text-xs text-zinc-500 hover:text-zinc-300 truncate text-left"
          >
            {apiKey ? `API key set (…${apiKey.slice(-6)})` : "Set API key"}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-zinc-800 px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Chat</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {useRag
                ? "Answers will use your uploaded knowledge when relevant."
                : "Answers use the model only, without document retrieval."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`text-xs px-3 py-1.5 rounded-full border ${
                useRag
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-300"
              }`}
            >
              {useRag ? "RAG ON" : "RAG OFF"}
            </span>
            <span
              className={`text-xs px-3 py-1.5 rounded-full border ${
                hasKnowledge
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              {hasKnowledge ? "KB ready" : "KB empty"}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {!currentConversation && (
            <div className="text-zinc-500 text-center mt-20 max-w-md mx-auto leading-relaxed">
              Start a new chat, upload knowledge, and toggle RAG on to get grounded answers with
              source citations.
            </div>
          )}

          {currentConversation?.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className="max-w-3xl flex flex-col gap-2">
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2 px-1">
                    {msg.ragUsed ? (
                      <span className="text-[11px] uppercase tracking-wide text-emerald-400">
                        Grounded answer
                      </span>
                    ) : msg.content ? (
                      <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                        Direct answer
                      </span>
                    ) : null}
                  </div>
                )}
                <div
                  className={`px-5 py-4 rounded-2xl whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : msg.ragUsed
                        ? "bg-zinc-800 border border-emerald-500/30"
                        : "bg-zinc-800 border border-zinc-700"
                  }`}
                >
                  {msg.content || (loading ? "…" : "")}
                </div>
                {msg.role === "assistant" && msg.ragUsed && msg.ragSources && msg.ragSources.length > 0 && (
                  <div className="px-1 flex flex-wrap gap-2">
                    {msg.ragSources.map((source) => (
                      <span
                        key={`${msg.id}_${source}`}
                        className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                      >
                        {source}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 border border-zinc-700 px-5 py-4 rounded-2xl text-zinc-300">
                {useRag ? "Searching knowledge and thinking…" : "Thinking…"}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-zinc-800 p-6">
          <div className="flex gap-4">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void sendMessage()
                }
              }}
              placeholder={
                useRag
                  ? "Ask using your knowledge base…"
                  : "Ask the model directly…"
              }
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-2xl px-5 py-4 outline-none focus:border-blue-500"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={loading || !message.trim()}
              className="bg-white text-black px-6 rounded-2xl font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
