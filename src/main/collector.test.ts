import { describe, expect, it } from 'vitest'
import { restartDelay } from './collector'

describe('restartDelay (ARCHITECTURE § Crash restart)', () => {
  it('doubles from 500 ms and caps at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(restartDelay)).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  })
})
