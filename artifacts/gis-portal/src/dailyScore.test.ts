import { readFileSync } from 'node:fs'
import type { Counts } from './milestones'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACHIEVEMENT_WEIGHT, AI_WEIGHT, HALF_POINTS, IDEA_DONE_POINTS, NEW_PLACE_POINTS, SOCIAL_POINTS, TRIP_DAY_POINTS, WORKOUT_POINTS, achievementPoints, achievementScore, dailyScore, dailyScoreLine } from './dailyScore'

const c = (tasks: number, ideasNew: number, ideasDone: number, life: Partial<Counts> = {}): Counts =>
  ({ tasks, ideasNew, ideasDone, social: 0, newPlaces: 0, tripDay: 0, workout: 0, ...life })

describe('前後端公式一致', () => {
  it('常數與 api-server lib/dailyScore.ts 相同', () => {
    const src = readFileSync(resolve(__dirname, '../../api-server/src/lib/dailyScore.ts'), 'utf8')
    for (const [name, v] of Object.entries({ ACHIEVEMENT_WEIGHT, AI_WEIGHT, IDEA_DONE_POINTS, HALF_POINTS, SOCIAL_POINTS, NEW_PLACE_POINTS, TRIP_DAY_POINTS, WORKOUT_POINTS })) {
      expect(src, name).toContain(`export const ${name} = ${v};`)
    }
  })
})

describe('成果分（遞減曲線）', () => {
  it('想法實行算 2 點；3 點 50、6 點 75、0 點 0', () => {
    expect(achievementPoints(c(4, 1, 1))).toBe(7)
    expect([0, 1, 3, 6, 9].map(achievementScore)).toEqual([0, 21, 50, 75, 88])
  })
  it('生活面向：見人 2、新店每間 1、旅行 2、運動 2', () => {
    expect(achievementPoints(c(0, 0, 0, { social: 1 }))).toBe(2)
    expect(achievementPoints(c(0, 0, 0, { newPlaces: 2 }))).toBe(2)
    expect(achievementPoints(c(0, 0, 0, { tripDay: 1 }))).toBe(2)
    expect(achievementPoints(c(0, 0, 0, { workout: 1 }))).toBe(2)
    // 旅行日陪家人吃新店：5 點 → 成果 69，不再是 0
    expect(achievementScore(achievementPoints(c(0, 0, 0, { social: 1, tripDay: 1, newPlaces: 1 })))).toBe(69)
  })
  it('做越多越高、不會超過 100', () => {
    expect(achievementScore(30)).toBeLessThanOrEqual(100)
    expect(achievementScore(12)).toBeGreaterThan(achievementScore(9))
  })
})

describe('dailyScore', () => {
  it('兩邊都有：0.8×成果＋0.2×AI', () => {
    // 4 任務＋1 新想法＝5 點 → 成果 69；0.8×69＋0.2×60＝67.2
    expect(dailyScore(60, c(4, 1, 0))).toMatchObject({ total: 67, achievement: 69, points: 5, ai: 60 })
  })
  it('只有一邊就用那一邊；都沒有＝null', () => {
    expect(dailyScore(null, c(3, 0, 0))?.total).toBe(50)
    expect(dailyScore(70, null)?.total).toBe(70)
    expect(dailyScore(undefined, null)).toBeNull()
    expect(dailyScore(Number.NaN, null)).toBeNull()
  })
  it('沒成果的日子 AI 再高也只有 20 分', () => {
    expect(dailyScore(100, c(0, 0, 0))?.total).toBe(20)
  })
  it('說明文字', () => {
    expect(dailyScoreLine(dailyScore(60, c(4, 1, 0))!)).toBe('67＝成果 69×80%＋AI 60×20%（任務 4・新想法 1・實行 0）')
    expect(dailyScoreLine(dailyScore(null, c(3, 0, 0))!)).toContain('沒有 AI 自評')
    expect(dailyScoreLine(dailyScore(70, null)!)).toBe('70＝AI 自評（成果資料讀不到）')
    expect(dailyScoreLine(dailyScore(null, c(0, 0, 0, { social: 1, workout: 1 }))!)).toContain('（任務 0・新想法 0・實行 0・見人 1・運動 1）')
  })
})
