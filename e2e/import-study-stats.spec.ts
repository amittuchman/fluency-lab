import { expect, test, type Page } from '@playwright/test'

/** Answer whatever card is showing, whatever its kind. */
async function answerOne(page: Page) {
  const reveal = page.getByRole('button', { name: /Show answer/ })
  const box = page.getByRole('textbox', { name: 'Your answer' })
  if (await reveal.isVisible()) {
    await page.keyboard.press('Space')
  } else if (await box.isVisible()) {
    await box.fill('my answer')
    await page.keyboard.press('Enter')
  } else {
    await page.keyboard.press('1')
  }
  await expect(page.getByRole('button', { name: /Again/ })).toBeVisible()
  await page.keyboard.press('Enter')
}

test('import a package, study, see it in stats, and it persists', async ({ page }) => {
  await page.goto('/#/add')
  await page.getByRole('button', { name: 'Paste the sample' }).click()
  await expect(page.getByText(/48 new notes/)).toBeVisible()
  await page.getByRole('button', { name: 'Confirm and save' }).click()
  await expect(page.getByText(/Saved “Sample/)).toBeVisible()

  await page.goto('/#/study')
  await expect(page.getByText(/0 done/)).toBeVisible()
  for (let i = 0; i < 3; i++) {
    await answerOne(page)
    await expect(page.getByText(new RegExp(`${i + 1} done`))).toBeVisible()
  }

  await page.goto('/#/stats')
  const today = page.locator('.card', { hasText: 'Today' }).first()
  await expect(today).toContainText('3')

  await page.reload()
  await page.goto('/#/')
  await expect(page.getByText('3 answers today')).toBeVisible()
  await expect(page.getByText(/Ready for next voice session/)).toBeVisible()
})
