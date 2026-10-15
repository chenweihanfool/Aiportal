// 🧳 遊記的示範資料——趟次、內文與地點都是虛構的，只用來讓版面有東西可看。
// 接上知識庫（/api/hermes-trips）後就不再使用；畫面上會標「示範資料」。
// 相片用內嵌 SVG 佔位圖（不打網路）；data: 網址不會通過正式驗證，所以跟 foodSample.ts 一樣，在驗證之後才掛上去。
import type { FoodPhoto } from './foodMap'
import { tripDataFromResponse, type TripData } from './tripsApi'

function placeholder(label: string, hue: number, takenAt: string): FoodPhoto {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,50%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},50%,25%)"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><text x="320" y="250" font-size="36" text-anchor="middle" fill="rgba(255,255,255,.85)" font-family="sans-serif">${label}</text></svg>`
  return { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, thumb: null, w: 640, h: 480, takenAt, caption: `${label}（示範相片）` }
}

const RAW = {
  receivedAt: '2026-10-15T08:00:00+08:00',
  trips: [
    {
      id: 'DEMO-TRIP-1', name: '示範・北部週末小旅行', area: '台北・新竹・新北', status: 'done', start: '2026-09-19', end: '2026-09-21',
      summary: '示範：河岸早午餐、山城步道、海邊燈塔，三天兩夜的版面示意。', cover: null,
      placeIds: ['FOOD-0002', 'FOOD-0011', 'FOOD-0012', 'FOOD-0001'],
      days: [
        {
          date: '2026-09-19', title: '出發・河岸早午餐', placeIds: ['FOOD-0002'],
          entries: [
            { time: '08:40', text: '示範：從大稻埕搭車到河岸，先找窗邊的位子。\n今天人不多，早餐比預期快上桌。', photos: [], photosPending: 0 },
            { time: '12:30', text: '示範：午後沿河走一段，風很大，決定晚上換行程。', photos: [], photosPending: 1 },
          ],
        },
        {
          date: '2026-09-20', title: '山城與老街', placeIds: ['FOOD-0011', 'FOOD-0012'],
          entries: [
            { time: '10:15', text: '示範：山城老街步道，階梯比想像多，走到一半就後悔穿了新鞋。', photos: [], photosPending: 0 },
            { time: '17:50', text: '示範：海邊燈塔看日落，拍了很多張，只留下這幾張。', photos: [], photosPending: 2 },
          ],
        },
        {
          date: '2026-09-21', title: '回程', placeIds: ['FOOD-0001'],
          entries: [
            { time: '11:20', text: '示範：回程前在大安吃了一碗牛肉麵，湯頭清。', photos: [], photosPending: 0 },
          ],
        },
      ],
    },
    {
      id: 'DEMO-TRIP-2', name: '示範・下個月的台南', area: '台南', status: 'planned', start: '2026-11-07', end: '2026-11-09',
      summary: null, cover: null, placeIds: ['FOOD-0005'], days: [],
    },
  ],
}

// 驗證之後才掛上去的示範相片（key＝趟次 id｜日期｜時間）
const DEMO_PHOTOS: Record<string, FoodPhoto[]> = {
  'DEMO-TRIP-1|2026-09-19|08:40': [placeholder('河岸早餐', 28, '2026-09-19'), placeholder('窗景', 200, '2026-09-19')],
  'DEMO-TRIP-1|2026-09-20|10:15': [placeholder('步道', 120, '2026-09-20'), placeholder('老街', 35, '2026-09-20'), placeholder('山景', 205, '2026-09-20')],
  'DEMO-TRIP-1|2026-09-20|17:50': [placeholder('燈塔', 12, '2026-09-20'), placeholder('日落', 18, '2026-09-20')],
  'DEMO-TRIP-1|2026-09-21|11:20': [placeholder('牛肉麵', 22, '2026-09-21')],
}
const DEMO_COVER: Record<string, string> = {
  'DEMO-TRIP-1': placeholder('北部小旅行', 205, '2026-09-19').url,
}

export function sampleTripData(): TripData {
  const data = tripDataFromResponse({ available: true, trips: RAW.trips, receivedAt: RAW.receivedAt })
  const trips = data.trips.map(t => ({
    ...t,
    cover: DEMO_COVER[t.id] ?? null,
    days: t.days.map(d => ({
      ...d,
      entries: d.entries.map(e => {
        const ph = DEMO_PHOTOS[`${t.id}|${d.date}|${e.time}`]
        return ph ? { ...e, photos: ph } : e
      }),
    })),
  }))
  return { ...data, trips, sample: true }
}
