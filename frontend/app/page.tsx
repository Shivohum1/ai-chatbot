"use client"
import { useEffect, useRef, useState } from "react"

type Message = {
  role: "user" | "assistant"
  content: string
}

type Conversation = {
  id: string
  title: string
  messages: Message[]
}

type UploadStatus = "idle" | "uploading" | "success" | "error"

function getApiKey(): string {
  if (typeof window === "undefined") return ""
  return localStorage.getItem("api_key") ?? ""
}

function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = getApiKey()
  return {
    ...(key ? { "X-API-Key": key } : {}),
    ...extra,
  }
}

export default function Home() {
  const [apiKey, setApiKey] = useState(() => getApiKey())
  const [apiKeyInput, setApiKeyInput] = useState(() => getApiKey())
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)

  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    if (typeof window === "undefined") return []
    const savedConvs = localStorage.getItem("conversations")
    if (!savedConvs) return []
    try {
      return JSON.parse(savedConvs) as Conversation[]
    } catch {
      return []
    }
  })
  const [currentConversationId, setCurrentConversationId] =
    useState<string | null>(null)

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle")
  const [uploadMessage, setUploadMessage] = useState("")
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Persist conversations
  useEffect(() => {
    localStorage.setItem("conversations", JSON.stringify(conversations))
  }, [conversations])

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [conversations, currentConversationId])

  const saveApiKey = () => {
    const trimmed = apiKeyInput.trim()
    localStorage.setItem("api_key", trimmed)
    setApiKey(trimmed)
    setShowApiKeyModal(false)
  }

  const currentConversation = conversations.find(
    (c) => c.id === currentConversationId
  )

  const createNewConversation = () => {
    const newConversation: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      messages: [],
    }
    setConversations((prev) => [newConversation, ...prev])
    setCurrentConversationId(newConversation.id)
  }

  const sendMessage = async () => {
    if (!message.trim()) return

    if (!apiKey) {
      setShowApiKeyModal(true)
      return
    }

    if (!currentConversationId) {
      createNewConversation()
      return
    }

    setLoading(true)

    const userMessage: Message = { role: "user", content: message }

    let updatedConversations = conversations.map((conv) => {
      if (conv.id === currentConversationId) {
        const updatedMessages = [...conv.messages, userMessage]
        return {
          ...conv,
          title: conv.messages.length === 0 ? message.slice(0, 30) : conv.title,
          messages: updatedMessages,
        }
      }
      return conv
    })

    setConversations(updatedConversations)

    const currentMessages =
      updatedConversations.find((c) => c.id === currentConversationId)
        ?.messages ?? []

    const currentMessage = message
    setMessage("")

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...apiHeaders(),
          },
          body: JSON.stringify({
            message: currentMessage,
            session_id: currentConversationId,
          }),
        }
      )

      if (response.status === 401) {
        setShowApiKeyModal(true)
        setLoading(false)
        return
      }

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let streamedText = ""

      updatedConversations = updatedConversations.map((conv) => {
        if (conv.id === currentConversationId) {
          return {
            ...conv,
            messages: [...currentMessages, { role: "assistant" as const, content: "" }],
          }
        }
        return conv
      })
      setConversations(updatedConversations)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        streamedText += decoder.decode(value)

        updatedConversations = updatedConversations.map((conv) => {
          if (conv.id === currentConversationId) {
            return {
              ...conv,
              messages: [
                ...currentMessages,
                { role: "assistant" as const, content: streamedText },
              ],
            }
          }
          return conv
        })
        setConversations([...updatedConversations])
      }
    } catch (err) {
      console.error(err)
      updatedConversations = updatedConversations.map((conv) => {
        if (conv.id === currentConversationId) {
          return {
            ...conv,
            messages: [
              ...currentMessages,
              { role: "assistant" as const, content: "Something went wrong." },
            ],
          }
        }
        return conv
      })
      setConversations(updatedConversations)
    }

    setLoading(false)
  }

  const deleteConversation = (id: string) => {
    const filtered = conversations.filter((conv) => conv.id !== id)
    setConversations(filtered)
    if (currentConversationId === id) {
      setCurrentConversationId(filtered.length > 0 ? filtered[0].id : null)
    }
  }

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault()
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
    for (const file of Array.from(files)) {
      formData.append("files", file)
    }

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/knowledge/upload`,
        {
          method: "POST",
          headers: apiHeaders(),
          body: formData,
        }
      )

      if (res.status === 401) {
        setUploadStatus("error")
        setUploadMessage("Invalid API key.")
        setShowApiKeyModal(true)
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setUploadStatus("error")
        setUploadMessage(data?.detail ?? `Upload failed (${res.status}).`)
        return
      }

      const data = await res.json()
      setUploadStatus("success")
      setUploadMessage(
        `Indexed ${data.chunks_indexed} chunks from ${data.files_processed} file(s).`
      )
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err) {
      console.error(err)
      setUploadStatus("error")
      setUploadMessage("Upload failed. Check the console for details.")
    }
  }

  return (
    <main className="flex h-screen bg-black text-white">

      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 w-96 flex flex-col gap-4">
            <h2 className="text-xl font-bold">Enter your API key</h2>
            <p className="text-zinc-400 text-sm">
              You need an API key to use this chatbot. Your key is stored in
              browser localStorage only.
            </p>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveApiKey() }}
              placeholder="ak_…"
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
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="w-72 border-r border-zinc-800 flex flex-col">

        <div className="p-4 border-b border-zinc-800 flex flex-col gap-2">
          <button
            onClick={createNewConversation}
            className="w-full bg-white text-black py-3 rounded-xl font-semibold"
          >
            + New Chat
          </button>
          <button
            onClick={() => setShowUploadPanel((v) => !v)}
            className="w-full bg-zinc-800 text-white py-2 rounded-xl text-sm hover:bg-zinc-700"
          >
            {showUploadPanel ? "Hide Knowledge Upload" : "Upload Knowledge"}
          </button>
        </div>

        {/* File Upload Panel */}
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
                    uploadStatus === "error" ? "text-red-400" : "text-green-400"
                  }`}
                >
                  {uploadMessage}
                </p>
              )}
            </form>
          </div>
        )}

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`
                group flex items-center justify-between p-3 rounded-xl cursor-pointer transition
                ${currentConversationId === conv.id ? "bg-zinc-800" : "hover:bg-zinc-900"}
              `}
              onClick={() => setCurrentConversationId(conv.id)}
            >
              <div className="truncate text-sm">{conv.title}</div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* API key indicator */}
        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={() => setShowApiKeyModal(true)}
            className="w-full text-xs text-zinc-500 hover:text-zinc-300 truncate text-left"
          >
            {apiKey ? `🔑 Key set (…${apiKey.slice(-6)})` : "⚠️ No API key set"}
          </button>
        </div>

      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col">

        {/* Header */}
        <div className="border-b border-zinc-800 p-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Groq AI Chatbot</h1>
            <p className="text-zinc-400 text-sm mt-1">FastAPI + Groq + Qdrant RAG + Arize OTEL</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {!currentConversation && (
            <div className="text-zinc-500 text-center mt-20">
              Create a new conversation to get started
            </div>
          )}

          {currentConversation?.messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`
                  max-w-3xl px-5 py-4 rounded-2xl whitespace-pre-wrap
                  ${msg.role === "user" ? "bg-blue-600" : "bg-zinc-800"}
                `}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 px-5 py-4 rounded-2xl">Thinking…</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-zinc-800 p-6">
          <div className="flex gap-4">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) sendMessage() }}
              placeholder="Type your message…"
              className="
                flex-1 bg-zinc-900 border border-zinc-700
                rounded-2xl px-5 py-4 outline-none focus:border-blue-500
              "
            />
            <button
              onClick={sendMessage}
              disabled={loading}
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
