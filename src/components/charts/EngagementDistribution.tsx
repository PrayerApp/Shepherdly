'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface Props {
  people: { engagement_score: number | null }[]
}

/*
 * Renders only the chart body. Bucket colors map to the existing palette
 * (red → gold → green) so they read as "low → high engagement" without
 * a legend. Wrap with <ChartCard> for title and empty/loading states.
 */
const BUCKETS = [
  { range: '0-20',   min: 0,  max: 20,  color: 'var(--color-red-500)' },
  { range: '21-40',  min: 21, max: 40,  color: 'var(--color-red-300)' },
  { range: '41-60',  min: 41, max: 60,  color: 'var(--color-gold-500)' },
  { range: '61-80',  min: 61, max: 80,  color: 'var(--color-green-500)' },
  { range: '81-100', min: 81, max: 100, color: 'var(--color-green-700)' },
] as const

export default function EngagementDistribution({ people }: Props) {
  const data = BUCKETS.map(b => ({
    range: b.range,
    count: people.filter(p =>
      p.engagement_score !== null
        && p.engagement_score >= b.min
        && p.engagement_score <= b.max,
    ).length,
    color: b.color,
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--foreground-muted)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-muted)' }} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
          }}
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
