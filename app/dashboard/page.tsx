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
      <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Hello, {userName}!</h2>
          <p className="text-gray-600">Create and manage your elections.</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Elections</h3>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                + Create
              </button>
            </div>

            {elections.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">No elections yet</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {elections.map((election) => (
                  <div
                    key={election.id}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      selectedElection === election.id
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-purple-300'
                    }`}
                    onClick={() => loadVotes(election.id)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-gray-900">{election.election_name}</h4>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          downloadQR(election.election_url, election.election_name)
                        }}
                        className="text-purple-600 hover:text-purple-700"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">{new Date(election.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Vote Records</h3>
              {selectedElection && (
                <button
                  onClick={recheckIntegrity}
                  disabled={verifying}
                  className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                >
                  {verifying ? 'Verifying...' : 'Verify'}
                </button>
              )}
            </div>

            {!selectedElection ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">Select an election to view votes</p>
              </div>
            ) : votes.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">No votes yet</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {votes.map((record) => (
                  <div key={record.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium text-gray-900">{record.voter_name}</p>
                        <p className="text-xs text-gray-500">{new Date(record.timestamp).toLocaleString()}</p>
                      </div>
                      {record.verified ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ✓ Valid
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          ✗ Tampered
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
