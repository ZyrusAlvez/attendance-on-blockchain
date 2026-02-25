'use client'

import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import { toast } from 'sonner'

type Event = {
  id: string
  event_name: string
  owner_id: string
  event_url: string
  created_at: string
}

type Attendance = {
  id: string
  event_id: string
  name: string
  timestamp: string
  verified?: boolean
}

async function verifyHash(eventId: string, name: string, timestamp: string, storedHash: string) {
  const data = `${eventId}|${name}|${timestamp}`
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return computedHash === storedHash
}

async function verifyAttendanceRecord(record: any, supabase: any) {
  const { data: proof } = await supabase
    .from('integrity_proofs')
    .select('proof_hash')
    .eq('attendance_id', record.id)
    .single()
  
  if (!proof) return false
  return await verifyHash(record.event_id, record.name, record.timestamp, proof.proof_hash)
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [verifying, setVerifying] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [eventName, setEventName] = useState('')
  const [creating, setCreating] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
      if (!user) router.push('/login')
      else loadEvents(user.id)
    })
  }, [])

  const loadEvents = async (userId: string) => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
    if (data) setEvents(data)
  }

  const loadAttendance = async (eventId: string) => {
    setSelectedEvent(eventId)
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .eq('event_id', eventId)
      .order('timestamp', { ascending: false })
    
    if (data) {
      const verified = await Promise.all(
        data.map(async (record) => {
          const { data: proof } = await supabase
            .from('integrity_proofs')
            .select('proof_hash')
            .eq('attendance_id', record.id)
            .single()
          
          if (!proof) {
            return { ...record, verified: false }
          }
          
          // Use exact timestamp from database for verification
          const timestampStr = new Date(record.timestamp).toISOString()
          const data = `${record.event_id}|${record.name}|${timestampStr}`
          const encoder = new TextEncoder()
          const dataBuffer = encoder.encode(data)
          const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
          
          return {
            ...record,
            verified: computedHash === proof.proof_hash
          }
        })
      )
      setAttendance(verified)
    }
  }

  const recheckIntegrity = async () => {
    if (!selectedEvent) return
    setVerifying(true)
    await loadAttendance(selectedEvent)
    toast.success('Integrity check completed')
    setVerifying(false)
  }

  const createEvent = async () => {
    if (!eventName.trim() || !user) return
    setCreating(true)

    const eventId = crypto.randomUUID()
    const eventUrl = `${window.location.origin}/event/${eventId}`

    const { error } = await supabase.from('events').insert({
      id: eventId,
      event_name: eventName,
      owner_id: user.id,
      event_url: eventUrl,
    })

    if (error) {
      toast.error('Failed to create event')
    } else {
      toast.success('Event created successfully!')
      setEventName('')
      setShowCreateModal(false)
      loadEvents(user.id)
    }
    setCreating(false)
  }

  const downloadQR = async (eventUrl: string, eventName: string) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(eventUrl, { width: 512 })
      const link = document.createElement('a')
      link.href = qrDataUrl
      link.download = `${eventName}-qr.png`
      link.click()
      toast.success('QR code downloaded!')
    } catch (error) {
      toast.error('Failed to generate QR code')
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  const userName = user?.user_metadata?.username || user?.email?.split('@')[0]

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Kalahok
            </h1>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Hello, {userName}!</h2>
          <p className="text-gray-600">Welcome to your attendance dashboard.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-bold text-gray-900">Events</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              Create Event
            </button>
          </div>

          {events.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No events yet. Create your first event!</p>
          ) : (
            <div className="grid gap-4">
              {events.map((event) => (
                <div key={event.id} className="border border-gray-200 rounded-lg p-4 hover:border-purple-500 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-semibold text-lg text-gray-900">{event.event_name}</h4>
                      <p className="text-sm text-gray-500 mt-1">{new Date(event.created_at).toLocaleDateString()}</p>
                      <p className="text-sm text-gray-600 mt-2 break-all">{event.event_url}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadAttendance(event.id)}
                        className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                      >
                        View Attendance
                      </button>
                      <button
                        onClick={() => downloadQR(event.event_url, event.event_name)}
                        className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                      >
                        Download QR
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedEvent && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Attendance Records</h3>
              <button
                onClick={recheckIntegrity}
                disabled={verifying}
                className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
              >
                {verifying ? 'Verifying...' : 'Recheck Integrity'}
              </button>
            </div>

            {attendance.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No attendance records yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Name</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Timestamp</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((record) => (
                      <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-900">{record.name}</td>
                        <td className="py-3 px-4 text-gray-600">
                          {new Date(record.timestamp).toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          {record.verified ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              ✓ Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              ✗ Tampered
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Create New Event</h3>
            <input
              type="text"
              placeholder="Event Name"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createEvent}
                disabled={creating || !eventName.trim()}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}