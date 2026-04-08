'use client'

import { useState, useEffect, useCallback } from 'react'

interface SurveyQuestion {
  id: string
  text: string
  type: 'text' | 'rating' | 'choice'
  options?: string[]
}

interface SurveyRow {
  id: string
  title: string
  questions: SurveyQuestion[]
  target_role: string
  is_active: boolean
  created_at: string
  responses: { count: number }[]
}

export default function SurveysPage() {
  const [surveys, setSurveys] = useState<SurveyRow[]>([])
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [activeSurvey, setActiveSurvey] = useState<string | null>(null)

  const fetchSurveys = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/surveys')
    const data = await res.json()
    setSurveys(data.surveys || [])
    setUserRole(data.userRole || '')
    setLoading(false)
  }, [])

  useEffect(() => { fetchSurveys() }, [fetchSurveys])

  const isAdmin = ['super_admin', 'staff'].includes(userRole)

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-serif" style={{ color: 'var(--foreground)' }}>Surveys</h1>
          <p className="mt-1 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
            {isAdmin ? 'Create and manage surveys for your leaders.' : 'Complete surveys assigned to you.'}
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium sans"
            style={{ background: 'var(--primary)', color: 'white' }}>
            + Create Survey
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading…</div>
      ) : surveys.length === 0 ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
          No surveys yet. {isAdmin ? 'Create your first survey to get started.' : 'Check back later for new surveys.'}
        </div>
      ) : (
        <div className="space-y-4">
          {surveys.map(survey => (
            <div key={survey.id} className="rounded-xl border p-5"
              style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
              <div className="flex items-center gap-3">
                <span className={`text-xs sans px-2 py-0.5 rounded-full font-medium ${survey.is_active ? '' : 'opacity-50'}`}
                  style={{ background: survey.is_active ? '#dcfce7' : '#f3f4f6', color: survey.is_active ? '#166534' : '#6b7280' }}>
                  {survey.is_active ? 'Active' : 'Inactive'}
                </span>
                <h3 className="font-medium sans text-sm" style={{ color: 'var(--foreground)' }}>{survey.title}</h3>
                <span className="text-xs sans ml-auto" style={{ color: 'var(--foreground-muted)' }}>
                  {survey.questions.length} question{survey.questions.length !== 1 ? 's' : ''} · {survey.responses?.[0]?.count || 0} response{(survey.responses?.[0]?.count || 0) !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                {!isAdmin && survey.is_active && (
                  <button onClick={() => setActiveSurvey(survey.id)}
                    className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: 'var(--primary)', color: 'white' }}>
                    Take Survey
                  </button>
                )}
                {isAdmin && (
                  <button onClick={() => setActiveSurvey(survey.id)}
                    className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: 'var(--muted)', color: 'var(--foreground-muted)' }}>
                    View Results
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateSurveyModal onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); fetchSurveys() }} />}
      {activeSurvey && <SurveyModal surveyId={activeSurvey} isAdmin={isAdmin} onClose={() => setActiveSurvey(null)} />}
    </div>
  )
}

function CreateSurveyModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState('')
  const [questions, setQuestions] = useState<{ text: string; type: string }[]>([{ text: '', type: 'text' }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const addQuestion = () => setQuestions([...questions, { text: '', type: 'text' }])
  const removeQuestion = (i: number) => setQuestions(questions.filter((_, idx) => idx !== i))
  const updateQuestion = (i: number, field: string, value: string) => {
    const updated = [...questions]
    updated[i] = { ...updated[i], [field]: value }
    setQuestions(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const formatted = questions.filter(q => q.text.trim()).map((q, i) => ({
      id: `q${i + 1}`,
      text: q.text,
      type: q.type,
    }))
    const res = await fetch('/api/surveys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, questions: formatted }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false) } else onSuccess()
  }

  const inputStyle = { borderColor: 'var(--border)', background: 'var(--muted)', color: 'var(--foreground)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(44,36,22,0.4)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="font-serif text-xl mb-4" style={{ color: 'var(--primary)' }}>Create Survey</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. Monthly Leader Check-in"
              className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none" style={inputStyle} />
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-medium sans" style={{ color: 'var(--foreground)' }}>Questions</label>
            {questions.map((q, i) => (
              <div key={i} className="flex gap-2">
                <input type="text" value={q.text} onChange={e => updateQuestion(i, 'text', e.target.value)}
                  placeholder={`Question ${i + 1}`}
                  className="flex-1 px-3 py-2 rounded-lg border text-sm sans outline-none" style={inputStyle} />
                <select value={q.type} onChange={e => updateQuestion(i, 'type', e.target.value)}
                  className="px-2 py-2 rounded-lg border text-xs sans outline-none" style={inputStyle}>
                  <option value="text">Text</option>
                  <option value="rating">Rating</option>
                  <option value="choice">Choice</option>
                </select>
                {questions.length > 1 && (
                  <button type="button" onClick={() => removeQuestion(i)}
                    className="text-xs px-2 rounded-lg" style={{ color: 'var(--danger)' }}>X</button>
                )}
              </div>
            ))}
            <button type="button" onClick={addQuestion}
              className="text-xs sans font-medium" style={{ color: 'var(--primary)' }}>+ Add question</button>
          </div>
          {error && <p className="text-sm sans rounded-lg px-3 py-2" style={{ background: '#fef2f2', color: 'var(--danger)' }}>{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm sans border"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}>Cancel</button>
            <button type="submit" disabled={loading || !title.trim() || !questions.some(q => q.text.trim())}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium sans disabled:opacity-50"
              style={{ background: 'var(--primary)', color: 'white' }}>
              {loading ? 'Creating…' : 'Create Survey'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SurveyModal({ surveyId, isAdmin, onClose }: { surveyId: string; isAdmin: boolean; onClose: () => void }) {
  const [survey, setSurvey] = useState<any>(null)
  const [responses, setResponses] = useState<any[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    fetch(`/api/surveys/${surveyId}`)
      .then(r => r.json())
      .then(data => {
        setSurvey(data.survey)
        setResponses(data.responses || [])
        setLoading(false)
      })
  }, [surveyId])

  const handleSubmit = async () => {
    setSubmitting(true)
    await fetch(`/api/surveys/${surveyId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    })
    setSubmitted(true)
    setSubmitting(false)
  }

  if (loading) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(44,36,22,0.4)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="font-serif text-xl mb-1" style={{ color: 'var(--primary)' }}>{survey?.title}</h2>
        <p className="text-xs sans mb-5" style={{ color: 'var(--foreground-muted)' }}>
          {isAdmin ? `${responses.length} responses` : 'Answer the questions below'}
        </p>

        {isAdmin ? (
          <div className="space-y-4">
            {survey?.questions?.map((q: any) => (
              <div key={q.id}>
                <div className="text-sm font-medium sans mb-2" style={{ color: 'var(--foreground)' }}>{q.text}</div>
                {responses.length === 0 ? (
                  <div className="text-xs sans" style={{ color: 'var(--foreground-muted)' }}>No responses yet</div>
                ) : (
                  <div className="space-y-1">
                    {responses.map((r, i) => (
                      <div key={i} className="text-xs sans p-2 rounded-lg" style={{ background: 'var(--muted)' }}>
                        {r.answers?.[q.id] || '—'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : submitted ? (
          <div className="text-center py-8 sans text-sm" style={{ color: 'var(--primary)' }}>
            Thank you! Your response has been submitted.
          </div>
        ) : (
          <div className="space-y-4">
            {survey?.questions?.map((q: any) => (
              <div key={q.id}>
                <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>{q.text}</label>
                {q.type === 'rating' ? (
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} type="button" onClick={() => setAnswers({ ...answers, [q.id]: String(n) })}
                        className="w-10 h-10 rounded-lg text-sm font-medium sans border transition-all"
                        style={{
                          background: answers[q.id] === String(n) ? 'var(--primary)' : 'var(--muted)',
                          color: answers[q.id] === String(n) ? 'white' : 'var(--foreground)',
                          borderColor: 'var(--border)',
                        }}>{n}</button>
                    ))}
                  </div>
                ) : (
                  <textarea value={answers[q.id] || ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}
                    rows={2} className="w-full px-3 py-2 rounded-lg border text-sm sans outline-none resize-none"
                    style={{ borderColor: 'var(--border)', background: 'var(--muted)', color: 'var(--foreground)' }} />
                )}
              </div>
            ))}
            <button onClick={handleSubmit} disabled={submitting}
              className="w-full py-2.5 rounded-xl text-sm font-medium sans disabled:opacity-50"
              style={{ background: 'var(--primary)', color: 'white' }}>
              {submitting ? 'Submitting…' : 'Submit Response'}
            </button>
          </div>
        )}
        <button onClick={onClose} className="w-full mt-3 py-2 text-sm sans" style={{ color: 'var(--foreground-muted)' }}>Close</button>
      </div>
    </div>
  )
}
