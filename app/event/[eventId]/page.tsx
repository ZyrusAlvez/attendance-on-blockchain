'use client'

import { createClient } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type Event = {
  id: string
  event_name: string
  event_url: string
}

async function generateHash(eventId: string, name: string, timestamp: string) {
  const data = `${eventId}${name}${timestamp}`
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function AttendancePage() {
  const params = useParams()
  const router = useRouter()
  const eventId = params.eventId as string
  const [event, setEvent] = useState<Event | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    loadEvent()
  }, [eventId])

  const loadEvent = async () => {
    const { data } = await supabase
      .from('events')
      .select('id, event_name, event_url')
      .eq('id', eventId)
      .single()

    if (data) {
      setEvent(data)
    } else {
      toast.error('Event not found')
    }
    setLoading(false)
  }

  const submitAttendance = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !event) return

    setSubmitting(true)
    const timestamp = new Date().toISOString()
    const hash = await generateHash(event.id, name, timestamp)

    const { error } = await supabase.from('attendance').insert({
      event_id: event.id,
      name: name.trim(),
      timestamp,
      hash,
    })

    if (error) {
      toast.error('Failed to submit attendance')
    } else {
      toast.success('Attendance submitted successfully!')
      setName('')
      setTimeout(() => router.push('/'), 2000)
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Event Not Found</h2>
          <p className="text-gray-600">This event does not exist or has been removed.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2">
            Kalahok
          </h1>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{event.event_name}</h2>
          <p className="text-gray-600">Submit your attendance</p>
        </div>

        <form onSubmit={submitAttendance} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Attendance'}
          </button>
        </form>
      </div>
    </div>
  )
}
