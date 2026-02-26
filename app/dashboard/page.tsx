'use client'

import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import { toast } from 'sonner'

type Election = {
  id: string
  election_name: string
  owner_id: string
  election_url: string
  created_at: string
}

type Position = {
  position_name: string
  selection_type: 'single' | 'multiple'
  max_choices: number
  candidates: string[]
}

type Vote = {
  id: string
  election_id: string
  voter_name: string
  vote_data: any
  timestamp: string
  verified?: boolean
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [elections, setElections] = useState<Election[]>([])
  const [selectedElection, setSelectedElection] = useState<string | null>(null)
  const [votes, setVotes] = useState<Vote[]>([])
  const [verifying, setVerifying] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [electionName, setElectionName] = useState('')
  const [positions, setPositions] = useState<Position[]>([])
  const [creating, setCreating] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
      if (!user) router.push('/login')
      else loadElections(user.id)
    })
  }, [])

  const loadElections = async (userId: string) => {
    const { data } = await supabase
      .from('elections')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
    if (data) setElections(data)
  }

  const loadVotes = async (electionId: string) => {
    setSelectedElection(electionId)
    const { data } = await supabase
      .from('votes')
      .select('*')
      .eq('election_id', electionId)
      .order('timestamp', { ascending: false })
    
    if (data) {
      const verified = await Promise.all(
        data.map(async (record) => {
          const { data: proof } = await supabase
            .from('vote_proofs')
            .select('proof_hash')
            .eq('vote_id', record.id)
            .single()
          
          if (!proof) return { ...record, verified: false }
          
          const timestampStr = new Date(record.timestamp).toISOString()
          const voteData = JSON.stringify(record.vote_data)
          const data = `${record.election_id}|${record.voter_name}|${voteData}|${timestampStr}`
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
      setVotes(verified)
    }
  }

  const recheckIntegrity = async () => {
    if (!selectedElection) return
    setVerifying(true)
    await loadVotes(selectedElection)
    toast.success('Integrity check completed')
    setVerifying(false)
  }

  const addPosition = () => {
    setPositions([...positions, {
      position_name: '',
      selection_type: 'single',
      max_choices: 1,
      candidates: ['', '']
    }])
  }

  const updatePosition = (index: number, field: keyof Position, value: any) => {
    const updated = [...positions]
    updated[index] = { ...updated[index], [field]: value }
    setPositions(updated)
  }

  const addCandidate = (posIndex: number) => {
    const updated = [...positions]
    updated[posIndex].candidates.push('')
    setPositions(updated)
  }

  const updateCandidate = (posIndex: number, candIndex: number, value: string) => {
    const updated = [...positions]
    updated[posIndex].candidates[candIndex] = value
    setPositions(updated)
  }

  const removeCandidate = (posIndex: number, candIndex: number) => {
    const updated = [...positions]
    updated[posIndex].candidates.splice(candIndex, 1)
    setPositions(updated)
  }

  const removePosition = (index: number) => {
    setPositions(positions.filter((_, i) => i !== index))
  }

  const createElection = async () => {
    if (!electionName.trim() || !user || positions.length === 0) {
      toast.error('Please fill in election name and add at least one position')
      return
    }

    setCreating(true)
    const electionId = crypto.randomUUID()
    const electionUrl = `${window.location.origin}/vote/${electionId}`

    const { error: electionError } = await supabase.from('elections').insert({
      id: electionId,
      election_name: electionName,
      owner_id: user.id,
      election_url: electionUrl,
    })

    if (electionError) {
      toast.error('Failed to create election')
      setCreating(false)
      return
    }

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      const { data: posData, error: posError } = await supabase
        .from('positions')
        .insert({
          election_id: electionId,
          position_name: pos.position_name,
          selection_type: pos.selection_type,
          max_choices: pos.max_choices,
          position_order: i
        })
        .select()
        .single()

      if (posError) continue

      for (let j = 0; j < pos.candidates.length; j++) {
        if (pos.candidates[j].trim()) {
          await supabase.from('candidates').insert({
            position_id: posData.id,
            candidate_name: pos.candidates[j],
            candidate_order: j
          })
        }
      }
    }

    toast.success('Election created successfully!')
    setElectionName('')
    setPositions([])
    setShowCreateModal(false)
    loadElections(user.id)
    setCreating(false)
  }

  const downloadQR = async (electionUrl: string, electionName: string) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(electionUrl, { width: 512 })
      const link = document.createElement('a')
      link.href = qrDataUrl
      link.download = `${electionName}-qr.png`
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
          <p className="text-gray-600">Create and manage your elections.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-bold text-gray-900">Elections</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              Create Election
            </button>
          </div>

          {elections.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No elections yet. Create your first election!</p>
          ) : (
            <div className="grid gap-4">
              {elections.map((election) => (
                <div key={election.id} className="border border-gray-200 rounded-lg p-4 hover:border-purple-500 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-semibold text-lg text-gray-900">{election.election_name}</h4>
                      <p className="text-sm text-gray-500 mt-1">{new Date(election.created_at).toLocaleDateString()}</p>
                      <p className="text-sm text-gray-600 mt-2 break-all">{election.election_url}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadVotes(election.id)}
                        className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                      >
                        View Votes
                      </button>
                      <button
                        onClick={() => downloadQR(election.election_url, election.election_name)}
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

        {selectedElection && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mt-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Vote Records</h3>
              <button
                onClick={recheckIntegrity}
                disabled={verifying}
                className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
              >
                {verifying ? 'Verifying...' : 'Recheck Integrity'}
              </button>
            </div>

            {votes.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No votes yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Voter Name</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Timestamp</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {votes.map((record) => (
                      <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-900">{record.voter_name}</td>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl my-8">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Create New Election</h3>
            
            <input
              type="text"
              placeholder="Election Name"
              value={electionName}
              onChange={(e) => setElectionName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 mb-4"
            />

            <div className="space-y-4 mb-4">
              {positions.map((pos, posIndex) => (
                <div key={posIndex} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <input
                      type="text"
                      placeholder="Position Name (e.g., President)"
                      value={pos.position_name}
                      onChange={(e) => updatePosition(posIndex, 'position_name', e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <button
                      onClick={() => removePosition(posIndex)}
                      className="ml-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="flex gap-4 mb-3">
                    <select
                      value={pos.selection_type}
                      onChange={(e) => updatePosition(posIndex, 'selection_type', e.target.value)}
                      className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="single">Single Choice</option>
                      <option value="multiple">Multiple Choice</option>
                    </select>

                    {pos.selection_type === 'multiple' && (
                      <input
                        type="number"
                        min="1"
                        placeholder="Max choices"
                        value={pos.max_choices}
                        onChange={(e) => updatePosition(posIndex, 'max_choices', parseInt(e.target.value))}
                        className="w-32 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">Candidates:</p>
                    {pos.candidates.map((cand, candIndex) => (
                      <div key={candIndex} className="flex gap-2">
                        <input
                          type="text"
                          placeholder={`Candidate ${candIndex + 1}`}
                          value={cand}
                          onChange={(e) => updateCandidate(posIndex, candIndex, e.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        {pos.candidates.length > 2 && (
                          <button
                            onClick={() => removeCandidate(posIndex, candIndex)}
                            className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => addCandidate(posIndex)}
                      className="text-sm text-purple-600 hover:underline"
                    >
                      + Add Candidate
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addPosition}
              className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-purple-500 hover:text-purple-600 transition-colors mb-4"
            >
              + Add Position
            </button>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setElectionName('')
                  setPositions([])
                }}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createElection}
                disabled={creating || !electionName.trim() || positions.length === 0}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Election'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
