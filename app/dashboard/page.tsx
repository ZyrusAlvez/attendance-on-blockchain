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
  const [showQRModal, setShowQRModal] = useState(false)
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [currentElectionUrl, setCurrentElectionUrl] = useState('')
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

  const showQR = async (electionUrl: string) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(electionUrl, { width: 512 })
      setQrCodeUrl(qrDataUrl)
      setCurrentElectionUrl(electionUrl)
      setShowQRModal(true)
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <nav className="bg-white/80 backdrop-blur-md shadow-sm border-b border-gray-200/50 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <img src="/Pasya on Chain.png" alt="Pasya on Chain" className="w-15 h-15" />
              <h1 className="text-2xl font-bold">
                <span className="text-gray-900 -ml-4">asya on Chain</span>
              </h1>
            </div>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Welcome back, {userName}! 👋</h2>
          <p className="text-gray-600">Manage your blockchain-verified elections</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 h-[calc(100vh-16rem)]">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6 flex flex-col h-full">
            <div className="flex justify-between items-center mb-6 flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Elections</h3>
                <p className="text-sm text-gray-500 mt-1">{elections.length} total</p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium rounded-xl hover:shadow-lg hover:scale-105 transition-all duration-200"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create
                </span>
              </button>
            </div>

            {elections.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-gray-600 font-medium">No elections yet</p>
                  <p className="text-sm text-gray-500 mt-1">Create your first election to get started</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto flex-1 pr-2">
                {elections.map((election) => (
                  <div
                    key={election.id}
                    className={`group border rounded-xl p-4 cursor-pointer transition-all duration-200 ${
                      selectedElection === election.id
                        ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-purple-50 shadow-md'
                        : 'border-gray-200 hover:border-indigo-300 hover:shadow-md bg-white'
                    }`}
                    onClick={() => loadVotes(election.id)}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="font-semibold text-gray-900 flex-1 pr-2 group-hover:text-indigo-600 transition-colors">
                        {election.election_name}
                      </h4>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            showQR(election.election_url)
                          }}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors"
                          title="Show QR Code"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            downloadQR(election.election_url, election.election_name)
                          }}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors"
                          title="Download QR Code"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {new Date(election.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6 flex flex-col h-full">
            <div className="flex justify-between items-center mb-6 flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Vote Records</h3>
                {selectedElection && votes.length > 0 && (
                  <p className="text-sm text-gray-500 mt-1">{votes.length} votes</p>
                )}
              </div>
              {selectedElection && votes.length > 0 && (
                <button
                  onClick={recheckIntegrity}
                  disabled={verifying}
                  className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50 font-medium"
                >
                  {verifying ? 'Verifying...' : '🔒 Verify'}
                </button>
              )}
            </div>

            {!selectedElection ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-gray-600 font-medium">Select an election</p>
                  <p className="text-sm text-gray-500 mt-1">Click on an election to view votes</p>
                </div>
              </div>
            ) : votes.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-gray-600 font-medium">No votes yet</p>
                  <p className="text-sm text-gray-500 mt-1">Votes will appear here once submitted</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto flex-1 pr-2">
                {votes.map((record) => (
                  <div key={record.id} className="border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-md transition-all duration-200 bg-white">
                    <div className="flex justify-between items-center">
                      <div className="flex-1 pr-2">
                        <p className="font-semibold text-gray-900">{record.voter_name}</p>
                        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {new Date(record.timestamp).toLocaleString()}
                        </p>
                      </div>
                      {record.verified ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 flex-shrink-0">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Valid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 flex-shrink-0">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Tampered
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

      {showQRModal && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">QR Code</h3>
              <button
                onClick={() => setShowQRModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex justify-center mb-4">
              <img src={qrCodeUrl} alt="QR Code" className="w-64 h-64" />
            </div>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Election URL:</p>
              <a
                href={currentElectionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-purple-600 hover:underline break-all"
              >
                {currentElectionUrl}
              </a>
            </div>
            <button
              onClick={() => {
                const link = document.createElement('a')
                link.href = qrCodeUrl
                link.download = 'qr-code.png'
                link.click()
                toast.success('QR code downloaded!')
              }}
              className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Download QR Code
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl my-8 shadow-2xl">
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