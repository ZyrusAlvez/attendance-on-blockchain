'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    router.push('/dashboard')
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <div className="flex items-center mb-8">
        <img src="/Pasya on Chain.png" alt="Pasya on Chain" className="w-20 h-20" />
        <h1 className="text-4xl font-bold text-gray-900 -ml-5">asya on Chain</h1>
      </div>
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
    </div>
  )
}