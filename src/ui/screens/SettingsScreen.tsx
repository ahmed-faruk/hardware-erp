import { useLiveQuery } from 'dexie-react-hooks';
import { Save } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { saveSetting } from '@/db/commands/save-setting';
import { loadDeviceSettings, loadSettings, saveDeviceSetting } from '@/db/settings';
import { formatMoney, toPiasters } from '@/domain/money';
import { DEFAULT_SETTINGS, SETTING_KEYS, type Settings } from '@/domain/settings';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { Skeleton } from '../components/Skeleton';
import { BackupSection } from './BackupSection';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

export function SettingsScreen() {
  const { db } = useServices();
  const settings = useLiveQuery(() => loadSettings(db), [db]);
  const device = useLiveQuery(() => loadDeviceSettings(db), [db]);
  if (!settings || !device) return <Skeleton />;
  return <SettingsForm initial={settings} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const { db } = useServices();
  const { context } = useSession();
  const device = useLiveQuery(() => loadDeviceSettings(db), [db]);
  const [mayDiscount, setMayDiscount] = useState(initial.cashierMayDiscount);
  const [limitBp, setLimitBp] = useState<number | null>(initial.cashierDiscountLimitBp);
  const [mayPrice, setMayPrice] = useState(initial.cashierMayChangePrice);
  const [phone, setPhone] = useState(initial.phone);
  const [address, setAddress] = useState(initial.address);
  const [footer, setFooter] = useState(initial.footer);
  const [returnDays, setReturnDays] = useState(String(initial.returnPeriodDays));
  const [purchaseReturnDays, setPurchaseReturnDays] = useState(String(initial.purchaseReturnPeriodDays));
  const [stockLimit, setStockLimit] = useState<number | null>(initial.stockApprovalAbove);
  const [scaleOn, setScaleOn] = useState(initial.scaleEnabled);
  const [scalePrefix, setScalePrefix] = useState(initial.scalePrefix);
  const [scaleMode, setScaleMode] = useState(initial.scaleMode);
  const [negPolicy, setNegPolicy] = useState(initial.stockNegativePolicy);
  const [varianceLimit, setVarianceLimit] = useState<number | null>(initial.shiftVarianceAbove);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (!context) return;
    setBusy(true);
    const values: Record<keyof Settings, unknown> = {
      cashierMayDiscount: mayDiscount,
      cashierDiscountLimitBp: limitBp ?? DEFAULT_SETTINGS.cashierDiscountLimitBp,
      cashierMayChangePrice: mayPrice,
      phone,
      address,
      footer,
      stockNegativePolicy: negPolicy,
      scaleEnabled: scaleOn,
      scalePrefix: /^\d{1,2}$/.test(scalePrefix) ? scalePrefix : DEFAULT_SETTINGS.scalePrefix,
      scaleMode,
      shiftVarianceAbove: varianceLimit ?? DEFAULT_SETTINGS.shiftVarianceAbove,
      stockApprovalAbove: stockLimit ?? DEFAULT_SETTINGS.stockApprovalAbove,
      returnPeriodDays: /^\d{1,4}$/.test(returnDays) ? Number(returnDays) : DEFAULT_SETTINGS.returnPeriodDays,
      purchaseReturnPeriodDays: /^\d{1,4}$/.test(purchaseReturnDays)
        ? Number(purchaseReturnDays)
        : DEFAULT_SETTINGS.purchaseReturnPeriodDays,
    };
    for (const name of Object.keys(values) as (keyof Settings)[])
      await saveSetting(context, SETTING_KEYS[name], values[name]);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <section>
      <h1 className={styles.title}>{strings.settings.title}</h1>
      <div className={styles.form}>
        <div className={styles.section}>
          <h2>{strings.settings.saleRules}</h2>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={mayDiscount}
              onChange={(e) => setMayDiscount(e.target.checked)}
              data-testid="may-discount"
            />
            {strings.settings.mayDiscount}
          </label>
          {mayDiscount && (
            <NumberField
              label={strings.settings.discountLimit}
              value={limitBp}
              onChange={setLimitBp}
              parse={toPiasters}
              format={formatMoney}
              required
            />
          )}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={mayPrice}
              onChange={(e) => setMayPrice(e.target.checked)}
              data-testid="may-price"
            />
            {strings.settings.mayChangePrice}
          </label>
          <FormField label={strings.settings.returnDays}>
            {(id) => (
              <input
                id={id}
                className="control"
                inputMode="numeric"
                dir="ltr"
                value={returnDays}
                onChange={(e) => setReturnDays(e.target.value.replace(/\D/g, ''))}
                data-testid="return-days"
              />
            )}
          </FormField>
          <FormField label={strings.settings.purchaseReturnDays}>
            {(id) => (
              <input
                id={id}
                className="control"
                inputMode="numeric"
                dir="ltr"
                value={purchaseReturnDays}
                onChange={(e) => setPurchaseReturnDays(e.target.value.replace(/\D/g, ''))}
                data-testid="purchase-return-days"
              />
            )}
          </FormField>
        </div>
        <div className={styles.section}>
          <h2>{strings.settings.stockRules}</h2>
          <FormField label={strings.settings.negativePolicy}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={negPolicy}
                onChange={(e) => setNegPolicy(e.target.value as typeof negPolicy)}
                data-testid="negative-policy"
              >
                <option value="allow">{strings.settings.negAllow}</option>
                <option value="warn">{strings.settings.negWarn}</option>
                <option value="block">{strings.settings.negBlock}</option>
              </select>
            )}
          </FormField>
          <NumberField
            label={strings.settings.stockApprovalAbove}
            value={stockLimit}
            onChange={setStockLimit}
            parse={toPiasters}
            format={formatMoney}
            required
          />
          <NumberField
            label={strings.settings.shiftVarianceAbove}
            value={varianceLimit}
            onChange={setVarianceLimit}
            parse={toPiasters}
            format={formatMoney}
            required
          />
        </div>
        <div className={styles.section}>
          <h2>{strings.settings.scale}</h2>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={scaleOn}
              onChange={(e) => setScaleOn(e.target.checked)}
              data-testid="scale-on"
            />
            {strings.settings.scaleOn}
          </label>
          {scaleOn && (
            <>
              <FormField label={strings.settings.scalePrefix}>
                {(id) => (
                  <input
                    id={id}
                    className="control"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={2}
                    value={scalePrefix}
                    onChange={(e) => setScalePrefix(e.target.value.replace(/\D/g, ''))}
                    data-testid="scale-prefix"
                  />
                )}
              </FormField>
              <FormField label={strings.settings.scaleModeLabel}>
                {(id) => (
                  <select
                    id={id}
                    className="control"
                    value={scaleMode}
                    onChange={(e) => setScaleMode(e.target.value as typeof scaleMode)}
                    data-testid="scale-mode"
                  >
                    <option value="weight">{strings.settings.scaleWeight}</option>
                    <option value="price">{strings.settings.scalePrice}</option>
                  </select>
                )}
              </FormField>
            </>
          )}
        </div>
        <div className={styles.section}>
          <h2>{strings.settings.receipt}</h2>
          <FormField label={strings.settings.phone}>
            {(id) => (
              <input
                id={id}
                className="control"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={strings.settings.address}>
            {(id) => (
              <input
                id={id}
                className="control"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={strings.settings.footer}>
            {(id) => (
              <input id={id} className="control" value={footer} onChange={(e) => setFooter(e.target.value)} />
            )}
          </FormField>
        </div>
        {saved && <BigAlert tone="ok" word={strings.settings.savedAll} />}
        <div className={styles.actions}>
          <ActionButton
            label={strings.common.save}
            icon={Save}
            variant="ok"
            onClick={() => void save()}
            loading={busy}
            testId="save-settings"
          />
        </div>
        {device && (
          <div className={styles.section}>
            <h2>{strings.settings.device}</h2>
            <FormField label={strings.settings.paper}>
              {(id) => (
                <select
                  id={id}
                  className="control"
                  value={device.paper}
                  onChange={(e) => void saveDeviceSetting(db, 'paper', e.target.value)}
                  data-testid="paper"
                >
                  <option value="80">{strings.settings.paper80}</option>
                  <option value="58">{strings.settings.paper58}</option>
                </select>
              )}
            </FormField>
            <FormField label={strings.settings.copies}>
              {(id) => (
                <select
                  id={id}
                  className="control"
                  value={device.copies}
                  onChange={(e) => void saveDeviceSetting(db, 'copies', Number(e.target.value))}
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={strings.settings.idleLock}>
              {(id) => (
                <select
                  id={id}
                  className="control"
                  value={device.idleLockMinutes}
                  onChange={(e) => void saveDeviceSetting(db, 'idleLockMinutes', Number(e.target.value))}
                  data-testid="idle-lock"
                >
                  {[5, 10, 15, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {`${n} ${strings.settings.minutes}`}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={strings.settings.digits}>
              {(id) => (
                <select
                  id={id}
                  className="control"
                  value={device.digits}
                  onChange={(e) => void saveDeviceSetting(db, 'digits', e.target.value)}
                >
                  <option value="latn">{strings.settings.digitsLatn}</option>
                  <option value="arab">{strings.settings.digitsArab}</option>
                </select>
              )}
            </FormField>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={device.sounds}
                onChange={(e) => void saveDeviceSetting(db, 'sounds', e.target.checked)}
              />
              {strings.settings.sounds}
            </label>
          </div>
        )}
        {device && <BackupSection device={device} />}
      </div>
    </section>
  );
}
