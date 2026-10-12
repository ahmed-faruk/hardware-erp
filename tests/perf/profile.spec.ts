import { test } from '@playwright/test';

import { newCashierFixture } from '../e2e/helpers';

// CPU profile of one screen: PROFILE_HASH=reports npm run perf:profile -> top functions by self time.
test('cpu profile of a screen', async ({ page }) => {
  test.setTimeout(300_000);
  const hash = process.env.PROFILE_HASH ?? 'reports';
  const f = newCashierFixture();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click({ timeout: 300_000 });
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await page.getByTestId('sync-status').waitFor();
  await page.waitForTimeout(2000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.evaluate((h) => (window.location.hash = `#/${h}`), hash);
  await page.waitForTimeout(4000);
  const { profile } = (await cdp.send('Profiler.stop')) as {
    profile: {
      nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[];
      samples: number[];
      timeDeltas: number[];
    };
  };
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byName = new Map<string, number>();
  for (const n of profile.nodes) {
    const key = `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
    byName.set(key, (byName.get(key) ?? 0) + (self.get(n.id) ?? 0) / 1000);
  }
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  console.log(
    `PROFILE #/${hash}\n` + top.map(([k, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${k}`).join('\n'),
  );
});
