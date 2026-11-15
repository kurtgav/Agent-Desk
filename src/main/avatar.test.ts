import { describe, expect, it } from 'vitest'
import { squareCrop } from './avatar'

describe('squareCrop', () => {
  it('centres the largest square in a landscape picture', () => {
    expect(squareCrop(1600, 900)).toEqual({ x: 350, y: 0, width: 900, height: 900 })
  })

  it('and in a portrait one', () => {
    expect(squareCrop(600, 1000)).toEqual({ x: 0, y: 200, width: 600, height: 600 })
  })

  it('leaves a square alone and rounds an odd margin down', () => {
    expect(squareCrop(300, 300)).toEqual({ x: 0, y: 0, width: 300, height: 300 })
    expect(squareCrop(101, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })
})
