'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface TrendPoint {
  week_start: string
  unique_attenders: number
  total_checkins: number
}

export default function AttendanceTrend({ data }: { data: TrendPoint[] }) {
  if (!data.length) {
    return (
      <div className="text-center py-12 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
        No attendance data yet. Sync from PCO to see trends.
      </div>
    )
  }

  const formatted = data.map(d => ({
    ...d,
    label: new Date(d.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={formatted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--foreground-muted)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-muted)' }} />
        <Tooltip
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
          labelStyle={{ fontWeight: 600 }}
        />
        <Line type="monotone" dataKey="unique_attenders" stroke="#2d6047" strokeWidth={2} dot={false} name="Unique Attenders" />
        <Line type="monotone" dataKey="total_checkins" stroke="#c9943a" strokeWidth={2} dot={false} name="Total Check-ins" />
      </LineChart>
    </ResponsiveContainer>
  )
}
