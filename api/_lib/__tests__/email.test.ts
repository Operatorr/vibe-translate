import { describe, expect, it } from 'vitest'
import { resetPasswordContent, verifyEmailContent } from '../email'

describe('auth email links', () => {
  it('escapes attributes while leaving the text URL usable', () => {
    const url = 'https://vibe.test/verify?token=t&callback="<app>"'
    const content = verifyEmailContent(url)
    expect(content.html).toContain(
      'href="https://vibe.test/verify?token=t&amp;callback=&quot;&lt;app&gt;&quot;"',
    )
    expect(content.text).toContain(url)
  })
  it('states the expiry for verification and reset links', () => {
    expect(verifyEmailContent('https://vibe.test').text).toContain(
      'expires in one hour',
    )
    expect(resetPasswordContent('https://vibe.test').text).toContain(
      'expires in one hour',
    )
  })
})
