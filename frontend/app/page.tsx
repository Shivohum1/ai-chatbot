"use client"

import { useEffect, useState } from "react"
import axios from "axios"

type Message = {
  role: "user" | "assistant"
  content: string
}

type Conversation = {
  id: string
  title: string
  messages: Message[]
}

export default function Home() {

  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversationId, setCurrentConversationId] =
    useState<string | null>(null)

  // Load saved chats
  useEffect(() => {

    const saved = localStorage.getItem("conversations")

    if (saved) {
      const parsed = JSON.parse(saved)

      setConversations(parsed)

      if (parsed.length > 0) {
        setCurrentConversationId(parsed[0].id)
      }
    }

  }, [])

  // Save chats
  useEffect(() => {

    localStorage.setItem(
      "conversations",
      JSON.stringify(conversations)
    )

  }, [conversations])

  const currentConversation = conversations.find(
    (c) => c.id === currentConversationId
  )

  const createNewConversation = () => {

    const newConversation: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      messages: [],
    }

    setConversations((prev) => [
      newConversation,
      ...prev,
    ])

    setCurrentConversationId(newConversation.id)
  }

  const sendMessage = async () => {

    if (!message.trim()) return

    if (!currentConversationId) {
      createNewConversation()
      return
    }

    setLoading(true)

    const userMessage: Message = {
      role: "user",
      content: message,
    }

    let updatedConversations = conversations.map((conv) => {

      if (conv.id === currentConversationId) {

        const updatedMessages = [
          ...conv.messages,
          userMessage,
        ]

        return {
          ...conv,
          title:
            conv.messages.length === 0
              ? message.slice(0, 30)
              : conv.title,
          messages: updatedMessages,
        }
      }

      return conv
    })

    setConversations(updatedConversations)

    const currentMessages =
      updatedConversations.find(
        (c) => c.id === currentConversationId
      )?.messages || []

    const currentMessage = message

    setMessage("")

    try {

      const res = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/chat`,
        {
          message: currentMessage,
          session_id: currentConversationId,
        }
      )

      const botMessage: Message = {
        role: "assistant",
        content: res.data.response,
      }

      updatedConversations = updatedConversations.map((conv) => {

        if (conv.id === currentConversationId) {

          return {
            ...conv,
            messages: [
              ...currentMessages,
              botMessage,
            ],
          }
        }

        return conv
      })

      setConversations(updatedConversations)

    } catch (err) {

      console.error(err)

      updatedConversations = updatedConversations.map((conv) => {

        if (conv.id === currentConversationId) {

          return {
            ...conv,
            messages: [
              ...currentMessages,
              {
                role: "assistant",
                content: "Something went wrong.",
              },
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

    const filtered = conversations.filter(
      (conv) => conv.id !== id
    )

    setConversations(filtered)

    if (currentConversationId === id) {

      if (filtered.length > 0) {
        setCurrentConversationId(filtered[0].id)
      } else {
        setCurrentConversationId(null)
      }
    }
  }

  return (
    <main className="flex h-screen bg-black text-white">

      {/* Sidebar */}
      <div className="w-72 border-r border-zinc-800 flex flex-col">

        <div className="p-4 border-b border-zinc-800">

          <button
            onClick={createNewConversation}
            className="
              w-full
              bg-white
              text-black
              py-3
              rounded-xl
              font-semibold
            "
          >
            + New Chat
          </button>

        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">

          {conversations.map((conv) => (

            <div
              key={conv.id}
              className={`
                group
                flex
                items-center
                justify-between
                p-3
                rounded-xl
                cursor-pointer
                transition
                ${
                  currentConversationId === conv.id
                    ? "bg-zinc-800"
                    : "hover:bg-zinc-900"
                }
              `}
              onClick={() =>
                setCurrentConversationId(conv.id)
              }
            >

              <div className="truncate text-sm">
                {conv.title}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteConversation(conv.id)
                }}
                className="
                  opacity-0
                  group-hover:opacity-100
                  text-zinc-400
                  hover:text-red-500
                "
              >
                ✕
              </button>

            </div>

          ))}

        </div>

      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col">

        {/* Header */}
        <div className="border-b border-zinc-800 p-6">

          <h1 className="text-2xl font-bold">
            Groq AI Chatbot
          </h1>

          <p className="text-zinc-400 text-sm mt-1">
            FastAPI + Groq + Arize OTEL
          </p>

        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {!currentConversation && (
            <div className="text-zinc-500 text-center mt-20">
              Create a new conversation
            </div>
          )}

          {currentConversation?.messages.map((msg, index) => (

            <div
              key={index}
              className={`flex ${
                msg.role === "user"
                  ? "justify-end"
                  : "justify-start"
              }`}
            >

              <div
                className={`
                  max-w-3xl
                  px-5
                  py-4
                  rounded-2xl
                  whitespace-pre-wrap
                  ${
                    msg.role === "user"
                      ? "bg-blue-600"
                      : "bg-zinc-800"
                  }
                `}
              >
                {msg.content}
              </div>

            </div>

          ))}

          {loading && (

            <div className="flex justify-start">

              <div className="bg-zinc-800 px-5 py-4 rounded-2xl">
                Thinking...
              </div>

            </div>

          )}

        </div>

        {/* Input */}
        <div className="border-t border-zinc-800 p-6">

          <div className="flex gap-4">

            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  sendMessage()
                }
              }}
              placeholder="Type your message..."
              className="
                flex-1
                bg-zinc-900
                border
                border-zinc-700
                rounded-2xl
                px-5
                py-4
                outline-none
                focus:border-blue-500
              "
            />

            <button
              onClick={sendMessage}
              disabled={loading}
              className="
                bg-white
                text-black
                px-6
                rounded-2xl
                font-semibold
              "
            >
              Send
            </button>

          </div>

        </div>

      </div>

    </main>
  )
}