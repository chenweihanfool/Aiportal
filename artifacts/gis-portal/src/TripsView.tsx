import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { COLOR, FONT } from './theme'
import { apiFetchFood, formatReceivedAt } from './foodApi'
import { sampleFoodData } from './foodSample'
import type { FoodPlace } from './foodMap'
import { FoodMapGL } from './FoodMapGL'
import { PhotoGallery } from './PhotoGallery'
import { apiFetchTrips, type Trip, type TripDay, type TripData, type TripStatus } from './tripsApi'
import { sampleTripData } from './tripsSample'
import {
  TRIP_STATUS_LABEL, dayHeading, dayRouteText, formatDateRange, isEmptyTrip, photoSummary, tripMapPlaces, tripStats,
} from './tripsView'

// ─────────────────────────────────────────────
// 🧳 遊記（#trips 趟次列表、#trips/<id> 單趟）。2026-10-15 新增。
// 資料：解鎖後讀 /api/hermes-trips（趟次）與 /api/hermes-places（地點，只用來畫這趟的小地圖與路線名稱）；
// 沒解鎖、沒資料、讀取失敗就退回 tripsSample.ts 的示範趟次，畫面標「示範資料」。載入中不先閃示範資料。
// 條目原文一律當純文字顯示（保留換行），不渲染成 HTML。入口網只讀，不寫入。
// ─────────────────────────────────────────────

const STATUS_COLOR: Record<TripStatus, string> = { planned: '#2f80ff', ongoing: COLOR.amber, done: COLOR.steel }

const chip = (color: string = COLOR.steel): CSSProperties => ({
  fontFamily: FONT.mono, fontSize: '0.68rem', padding: '4px 10px', borderRadius: 999, cursor: 'pointer', textDecoration: 'none',
  color, background: 'transparent', border: `1px solid ${color}`, whiteSpace: 'nowrap',
})

interface Source {
  loading: boolean
  /** 真資料（available 且有趟次）；null＝退回示範 */
  trips: TripData | null
  /** 真地點（解鎖後才有）；null＝沒有可用的地點，地圖與路線名稱就不顯示 */
  places: FoodPlace[] | null
  note: string | null
}

function useTripSource(pw: string | null): Source {
  const [got, setGot] = useState<{ pw: string; trips: TripData | null; failed: boolean; places: FoodPlace[] | null } | null>(null)
  useEffect(() => {
    if (!pw) return
    let alive = true
    Promise.all([
      apiFetchTrips(pw).then(d => ({ trips: d, failed: false }), () => ({ trips: null, failed: true })),
      apiFetchFood(pw).then(d => (d.available ? d.places : null), () => null),
    ]).then(([t, places]) => { if (alive) setGot({ pw, trips: t.trips, failed: t.failed, places }) })
    return () => { alive = false }
  }, [pw])
  if (!pw) return { loading: false, trips: null, places: null, note: '解鎖私領域後會顯示你的真實遊記' }
  if (!got || got.pw !== pw) return { loading: true, trips: null, places: null, note: null }
  if (got.failed) return { loading: false, trips: null, places: null, note: '讀取失敗，顯示示範資料' }
  return {
    loading: false,
    trips: got.trips && got.trips.available ? got.trips : null,
    places: got.places,
    note: null,
  }
}

function Shell({ title, back, children, badges }: { title: ReactNode; back: { label: string; hash: string }; children: ReactNode; badges?: ReactNode }) {
  return (
    <div className="tr-page" style={{ position: 'fixed', inset: 0, background: COLOR.panelDeep, display: 'flex', flexDirection: 'column', zIndex: 200, color: COLOR.ink, fontFamily: FONT.body }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', padding: '0.7rem 1.2rem', borderBottom: `1px solid ${COLOR.line}`, flexWrap: 'wrap' }}>
        <a href={back.hash === '' ? '#' : `#${back.hash}`} data-testid="trips-back"
          onClick={e => { e.preventDefault(); window.location.hash = back.hash }}
          style={{ color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.72rem', textDecoration: 'none' }}>{back.label}</a>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, minWidth: 0 }}>{title}</h1>
        {badges}
        <a href="#food" data-testid="trips-to-food" onClick={e => { e.preventDefault(); window.location.hash = 'food' }}
          style={{ ...chip(COLOR.amberDim), marginLeft: 'auto' }}>🍜 美食地圖</a>
      </header>
      {children}
    </div>
  )
}

function TripCard({ t }: { t: Trip }) {
  const s = tripStats(t)
  const href = `trips/${encodeURIComponent(t.id)}`
  return (
    <a href={`#${href}`} className="tr-card" data-testid="trip-card"
      onClick={e => { e.preventDefault(); window.location.hash = href }}>
      {t.cover
        ? <img className="tr-cover" src={t.cover} alt="" loading="lazy" decoding="async" />
        : <div className="tr-cover-ph" aria-hidden>🧳</div>}
      <div className="tr-card-body">
        <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: STATUS_COLOR[t.status], letterSpacing: '0.08em' }}>{TRIP_STATUS_LABEL[t.status]}</span>
        <b style={{ color: COLOR.ink, fontSize: '0.95rem', lineHeight: 1.4 }}>{t.name}</b>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.7rem', color: COLOR.steel }}>{formatDateRange(t.start, t.end)}</span>
        <span style={{ fontSize: '0.7rem', color: COLOR.steelDim }}>
          {s.days} 天 · {s.entries} 個條目 · {photoSummary(s)}
        </span>
        {t.area && <span style={{ fontSize: '0.7rem', color: COLOR.steelDim }}>{t.area}</span>}
        {t.summary && <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: COLOR.steel, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.summary}</p>}
      </div>
    </a>
  )
}

function DayBlock({ trip, day, places }: { trip: Trip; day: TripDay; places: FoodPlace[] }) {
  const route = dayRouteText(day, places)
  return (
    <section className="tr-day" aria-label={dayHeading(trip, day)}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', color: COLOR.amber, fontWeight: 700 }}>{dayHeading(trip, day)}</h3>
        {day.title && <span style={{ fontSize: '0.8rem', color: COLOR.ink }}>{day.title}</span>}
      </header>
      {route && <div style={{ fontSize: '0.72rem', color: COLOR.steel, marginTop: 4 }}>🧭 {route}</div>}
      {day.entries.length === 0
        ? <div style={{ fontSize: '0.74rem', color: COLOR.steelDim, marginTop: 8 }}>這天還沒有條目</div>
        : (
          <ol className="tr-entries">
            {day.entries.map((e, i) => (
              <li key={`${e.time}-${i}`} className="tr-entry">
                <span className="tr-time">{e.time}</span>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {e.text && <p className="tr-text">{e.text}</p>}
                  <PhotoGallery photos={e.photos} label={`${day.date} ${e.time}`} resetKey={`${day.date}-${e.time}-${i}`} />
                  {e.photosPending > 0 && <div style={{ fontSize: '0.7rem', color: COLOR.steelDim }}>📷 {e.photosPending} 張相片（處理中）</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
    </section>
  )
}

function TripDetail({ trip, places }: { trip: Trip; places: FoodPlace[] }) {
  const [mapFailed, setMapFailed] = useState(false)
  const mapPlaces = useMemo(() => tripMapPlaces(trip, places), [trip, places])
  const s = tripStats(trip)
  return (
    <div className="tr-detail">
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: STATUS_COLOR[trip.status], letterSpacing: '0.08em' }}>{TRIP_STATUS_LABEL[trip.status]}</span>
        <h2 data-testid="trip-title" style={{ margin: 0, fontSize: '1.35rem', color: COLOR.ink, lineHeight: 1.35 }}>{trip.name}</h2>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.74rem', color: COLOR.steel }}>
          {formatDateRange(trip.start, trip.end)}{trip.area ? ` · ${trip.area}` : ''}
        </div>
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>
          {s.days} 天 · {s.entries} 個條目 · {photoSummary(s)}
        </div>
        {trip.summary && <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: COLOR.ink, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{trip.summary}</p>}
      </section>

      {mapPlaces.length > 0 && !mapFailed && (
        <div className="tr-map" data-testid="trip-map">
          <FoodMapGL places={mapPlaces} selected={null} onSelect={() => undefined} onFail={() => setMapFailed(true)} />
        </div>
      )}

      {isEmptyTrip(trip)
        ? <p style={{ margin: 0, fontSize: '0.8rem', color: COLOR.steelDim }}>還沒有紀錄。日記寫進來之後會出現在這裡。</p>
        : trip.days.map(d => <DayBlock key={d.date} trip={trip} day={d} places={places} />)}
    </div>
  )
}

export function TripsView({ tripId, unlockedPassword = null }: { tripId: string | null; unlockedPassword?: string | null }) {
  const src = useTripSource(unlockedPassword)
  // 真資料或示範資料只決定一次：有真資料就用真的，否則退回示範
  const data = useMemo<TripData>(() => src.trips ?? sampleTripData(), [src.trips])
  const isSample = src.trips === null
  const places = useMemo<FoodPlace[]>(() => (isSample ? sampleFoodData().places : (src.places ?? [])), [isSample, src.places])
  const receivedLabel = isSample ? null : formatReceivedAt(data.receivedAt)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [tripId])

  if (src.loading) {
    return (
      <Shell title="📖 遊記" back={{ label: '← 返回儀表板', hash: '' }}>
        <div role="status" style={{ flex: 1, display: 'grid', placeItems: 'center', color: COLOR.steelDim, fontFamily: FONT.mono, fontSize: '0.8rem' }}>載入中…</div>
      </Shell>
    )
  }

  const badges = (
    <>
      {isSample && <span data-testid="trips-sample-chip" style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.warn, border: `1px solid ${COLOR.warn}`, borderRadius: 4, padding: '2px 6px' }}>示範資料・尚未接知識庫</span>}
      {src.note && <span data-testid="trips-source-note" style={{ fontSize: '0.66rem', color: COLOR.steelDim }}>{src.note}</span>}
      {receivedLabel && <span data-testid="trips-received" style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>資料：{receivedLabel}</span>}
    </>
  )

  if (tripId === null) {
    return (
      <Shell title="📖 遊記" back={{ label: '← 返回儀表板', hash: '' }} badges={badges}>
        <div ref={bodyRef} className="tr-body">
          <div className="tr-wrap">
            <p style={{ margin: '0 0 0.9rem', fontSize: '0.78rem', color: COLOR.steel, lineHeight: 1.6 }}>
              每趟旅行的每日紀錄，依時間排列，保留日記原文與相片。點任一趟進去看。
            </p>
            <div className="tr-grid" data-testid="trips-list">
              {data.trips.map(t => <TripCard key={t.id} t={t} />)}
            </div>
          </div>
        </div>
      </Shell>
    )
  }

  const trip = data.trips.find(t => t.id === tripId)
  return (
    <Shell title={trip ? trip.name : '遊記'} back={{ label: '← 遊記列表', hash: 'trips' }} badges={badges}>
      <div ref={bodyRef} className="tr-body">
        <div className="tr-wrap">
          {trip
            ? <TripDetail key={trip.id} trip={trip} places={places} />
            : (
              <div data-testid="trip-not-found" style={{ fontSize: '0.84rem', color: COLOR.steel, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                找不到這趟遊記。
                <a href="#trips" onClick={e => { e.preventDefault(); window.location.hash = 'trips' }} style={{ color: COLOR.amberDim }}>回遊記列表 →</a>
              </div>
            )}
        </div>
      </div>
    </Shell>
  )
}
