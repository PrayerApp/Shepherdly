'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface Props {
  people: { engagement_score: number | null }[]
}

export default function EngagementDistribution({ people }: Props) {
  const buckets = [
    { range: '0-20', min: 0, max: 20, color: '#9b3a3a' },
    { range: '21-40', min: 21, max: 40, color: '#c17f3e' },
    { range: '41-60', min: 41, max: 60, color: '#c9943a' },
    { range: '61-80', min: 61, max: 80, color: '#6b9a5e' },
    { range: '81-100', min: 81, max: 100, color: '#2d6047' },
  ]

  const data = buckets.map(b => ({
    range: b.range,
    count: people.filter(p =>
      p.engagement_score !== null && p.engagement_score >= b.min && p.engagement_score <= b.max
    ).length,
    color: b.color,
  }))

  if (people.length === 0) {
    return (
      <div className="text-center py-12 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
        No engagement data yet.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--foreground-muted)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-muted)' }} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} name="People">
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
