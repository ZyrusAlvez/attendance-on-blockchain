'use client'

import { createClient } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type Election = {
  id: string
  election_name: string
}

type Position = {
  id: string
  position_name: string
  selection_type: 'single' | 'multiple'
  max_choices: number
  position_order: number
}

type Candidate = {
  id: string
  position_id: string
  candidate_name: string
  candidate_order: number
}

async function generateHash(electionId: string, voterName: string, voteData: string, timestamp: string) {
  const data = `${electionId}|${voterName}|${voteData}|${timestamp}`
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function VotePage() {
  const params = useParams()
  const electionId = params.electionId as string
  const [election, setElection] = useState<Election | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [voterName, setVoterName] = useState('')
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    loadElection()
  }, [electionId])

  const loadElection = async () => {
    const { data: electionData } = await supabase
      .from('elections')
      .select('id, election_name')
      .eq('id', electionId)
      .single()

    if (!electionData) {
      toast.error('Election not found')
      setLoading(false)
      return
    }

    const { data: positionsData } = await supabase
      .from('positions')
      .select('*')
      .eq('election_id', electionId)
      .order('position_order')

    const { data: candidatesData } = await supabase
      .from('candidates')
      .select('*')
      .order('candidate_order')

    setElection(electionData)
    setPositions(positionsData || [])
    setCandidates(candidatesData || [])
    setLoading(false)
  }

  const handleSelection = (positionId: string, candidateId: string, selectionType: string, maxChoices: number) => {
    const current = selections[positionId] || []

    if (selectionType === 'single') {
      setSelections({ ...selections, [positionId]: [candidateId] })
    } else {
      if (current.includes(candidateId)) {
        setSelections({ ...selections, [positionId]: current.filter(id => id !== candidateId) })
      } else {
        if (current.length < maxChoices) {
          setSelections({ ...selections, [positionId]: [...current, candidateId] })
        } else {
          toast.error(`Maximum ${maxChoices} choices allowed`)
        }
      }
    }
  }

  const submitVote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!voterName.trim() || !election) return

    if (Object.keys(selections).length !== positions.length) {
      toast.error('Please vote for all positions')
      return
    }

    setSubmitting(true)
    const timestamp = new Date().toISOString()
    const voteData = JSON.stringify(selections)
    const hash = await generateHash(election.id, voterName.trim(), voteData, timestamp)

    const { data: voteRecord, error: voteError } = await supabase
      .from('votes')
      .insert({
        election_id: election.id,
        voter_name: voterName.trim(),
        vote_data: selections,
        timestamp,
      })
      .select()
      .single()

    if (voteError) {
      toast.error('Failed to submit vote')
      setSubmitting(false)
      return
    }

    const { error: proofError } = await supabase
      .from('vote_proofs')
      .insert({
        vote_id: voteRecord.id,
        proof_hash: hash,
      })

    if (proofError) {
      toast.error('Failed to create vote proof')
      setSubmitting(false)
    } else {
      toast.success('Vote submitted successfully!')
      setSubmitted(true)
    }
    setSubmitting(false)
  }

  const resetForm = () => {
    setVoterName('')
    setSelections({})
    setSubmitted(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  if (!election) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Election Not Found</h2>
          <p className="text-gray-600">This election does not exist or has been removed.</p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center max-w-md">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Vote Submitted!</h2>
          <p className="text-gray-600 mb-6">Thank you for participating in {election.election_name}.</p>
          <button
            onClick={resetForm}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            Submit Another Response
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 py-12">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-2">
              <img src="/Pasya on Chain.png" alt="Pasya on Chain" className="w-16 h-16" />
              <h1 className="text-4xl font-bold -ml-5">
                <span className="text-gray-900">asya on Chain</span>
              </h1>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{election.election_name}</h2>
            <p className="text-gray-600">Cast your vote</p>
          </div>

          <form onSubmit={submitVote} className="space-y-6">
            <div>
              <input
                type="text"
                placeholder="Enter your name"
                value={voterName}
                onChange={(e) => setVoterName(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {positions.map((position) => {
              const positionCandidates = candidates.filter(c => c.position_id === position.id)
              const selected = selections[position.id] || []

              return (
                <div key={position.id} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-lg text-gray-900 mb-2">{position.position_name}</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {position.selection_type === 'single' 
                      ? 'Select one' 
                      : `Select up to ${position.max_choices}`}
                  </p>

                  <div className="space-y-2">
                    {positionCandidates.map((candidate) => {
                      const isSelected = selected.includes(candidate.id)

                      return (
                        <label
                          key={candidate.id}
                          className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                            isSelected 
                              ? 'border-purple-500 bg-purple-50' 
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          <input
                            type={position.selection_type === 'single' ? 'radio' : 'checkbox'}
                            name={position.id}
                            checked={isSelected}
                            onChange={() => handleSelection(position.id, candidate.id, position.selection_type, position.max_choices)}
                            className="mr-3"
                          />
                          <span className="text-gray-900">{candidate.candidate_name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            <button
              type="submit"
              disabled={submitting || !voterName.trim()}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Vote'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
