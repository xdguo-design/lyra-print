import { describe, expect, it } from 'vitest'
import { parseLyraHubOrigin } from './lyra-hub'

describe('Lyra Hub bridge', () => {
  it('accepts an explicit Hub origin from the embed URL', () => {
    expect(
      parseLyraHubOrigin('?lyraHub=1&lyraHubOrigin=http%3A%2F%2F127.0.0.1%3A5173'),
    ).toBe('http://127.0.0.1:5173')
  })

  it('does not activate without the Hub marker', () => {
    expect(parseLyraHubOrigin('?lyraHubOrigin=http%3A%2F%2F127.0.0.1%3A5173')).toBeNull()
  })
})
