"use client"

import dynamic from "next/dynamic"

const ClientHome = dynamic(() => import("./ClientHome"), { ssr: false })

export default function Home() {
  return <ClientHome />
}
