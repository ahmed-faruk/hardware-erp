import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newFixture } from './helpers';

test('@smoke the manager sets a passphrase, downloads an encrypted backup, and a wrong passphrase cannot restore it', async ({
  page,
}) => {
  const f = newFixture();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await page.getByRole('button', { name: strings.nav.settings }).click();

  // the banner nags until a backup exists
  await expect(page.getByText(strings.health.noBackup)).toBeVisible();
  await page.getByTestId('backup-pass').fill('short');
  await page.getByTestId('backup-pass2').fill('short');
  await page.getByTestId('backup-save-pass').click();
  await expect(page.getByText(strings.backup.short)).toBeVisible();
  await page.getByTestId('backup-pass').fill('a long passphrase');
  await page.getByTestId('backup-pass2').fill('a long passphrase');
  await page.getByTestId('backup-save-pass').click();
  await expect(page.getByText(strings.backup.saved)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('backup-download').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^hanafy-[A-Z0-9]+-\d{8}-\d{4}\.hanafybak$/);
  const path = await download.path();
  expect(readFileSync(path).subarray(0, 4).toString('latin1')).toBe('HPB1');
  await expect(page.getByText(strings.health.noBackup)).toHaveCount(0);

  await page.getByTestId('backup-file').setInputFiles(path);
  await page.getByTestId('restore-pass').fill('not the passphrase');
  await page.getByTestId('backup-restore').click();
  await expect(page.getByText(strings.backup.wrongPass)).toBeVisible();
});
