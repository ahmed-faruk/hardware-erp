import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, UserCog } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { saveWorker } from '@/db/commands/save-master';
import type { Worker } from '@/db/types';

import { PermissionGroups } from './PermissionGroups';
import { SegmentedControl } from '../components/SegmentedControl';
import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';
import { useSaver } from './useSaver';

export function WorkersScreen() {
  const { db } = useServices();
  const { can } = useSession();
  const [tab, setTab] = useState<'workers' | 'groups'>('workers');
  const [editing, setEditing] = useState<Worker | 'new' | null>(null);
  const workers = useLiveQuery(() => db.workers.filter((w) => !w.deletedAt).toArray(), [db]);
  const columns: Column<Worker>[] = [
    { key: 'name', header: strings.workers.name, cell: (w) => w.name },
    { key: 'role', header: strings.workers.role, cell: (w) => strings.roles[w.role] },
    {
      key: 'active',
      header: strings.common.active,
      cell: (w) => (w.active ? strings.common.active : strings.common.inactive),
    },
  ];
  return (
    <section>
      <h1 className={styles.title}>{strings.workers.title}</h1>
      {can('manageGroups') === 'yes' && (
        <div className={styles.toolbar}>
          <div className={styles.fixed}>
            <SegmentedControl
              label={strings.workers.title}
              options={[
                { key: 'workers', label: strings.permissions.workersTab },
                { key: 'groups', label: strings.permissions.groups },
              ]}
              value={tab}
              onChange={setTab}
              testIdPrefix="workers-tab-"
            />
          </div>
        </div>
      )}
      {tab === 'groups' ? (
        <PermissionGroups />
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.fixed}>
              <ActionButton
                label={strings.workers.newWorker}
                icon={Plus}
                onClick={() => setEditing('new')}
                testId="new-worker"
              />
            </div>
          </div>
          {!workers ? (
            <Skeleton />
          ) : workers.length === 0 ? (
            <EmptyState icon={UserCog} word={strings.workers.noWorkers} />
          ) : (
            <DataTable
              label={strings.workers.title}
              rows={[...workers].sort(
                (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ar'),
              )}
              columns={columns}
              rowKey={(w) => w.id}
              onRowClick={setEditing}
            />
          )}
        </>
      )}
      <Dialog
        title={editing === 'new' ? strings.workers.newWorker : strings.workers.editWorker}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <WorkerForm worker={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </section>
  );
}

function WorkerForm({ worker, onDone }: { worker: Worker | null; onDone: () => void }) {
  const { db } = useServices();
  const { context } = useSession();
  const [name, setName] = useState(worker?.name ?? '');
  const [role, setRole] = useState<Worker['role']>(worker?.role ?? 'cashier');
  const [active, setActive] = useState(worker?.active ?? true);
  const [groupId, setGroupId] = useState(worker?.groupId ?? '');
  const groups = useLiveQuery(() => db.permissionGroups.filter((g) => !g.deletedAt).toArray(), [db]);
  const [changePin, setChangePin] = useState(!worker);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saver = useSaver(onDone);
  return (
    <form
      className={styles.form}
      style={{ gridTemplateColumns: '1fr' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError(strings.common.required);
        if (changePin && !/^\d{6,12}$/.test(pin)) return setError(strings.workers.pinShort);
        if (changePin && pin !== pin2) return setError(strings.workers.pinMismatch);
        setError(null);
        if (!context) return;
        void saver.run(() =>
          saveWorker(context, {
            id: worker?.id,
            baseVersion: worker?.version,
            fields: { name, role, active, groupId: groupId || null, ...(changePin ? { pin } : {}) },
          }),
        );
      }}
    >
      <FormField label={strings.workers.name}>
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="worker-name"
          />
        )}
      </FormField>
      <FormField label={strings.workers.role}>
        {(id) => (
          <select
            id={id}
            className="control"
            value={role}
            onChange={(e) => setRole(e.target.value as Worker['role'])}
            data-testid="worker-role"
          >
            {(['cashier', 'storekeeper', 'manager'] as const).map((r) => (
              <option key={r} value={r}>
                {strings.roles[r]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label={strings.permissions.group}>
        {(id) => (
          <select
            id={id}
            className="control"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            data-testid="worker-group"
          >
            <option value="">{strings.permissions.byRole}</option>
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      {worker && (
        <label className={styles.check}>
          <input type="checkbox" checked={changePin} onChange={(e) => setChangePin(e.target.checked)} />
          {strings.workers.pinChange}
        </label>
      )}
      {changePin && (
        <>
          <FormField label={strings.workers.pin} hint={strings.workers.pinHint}>
            {(id, d) => (
              <input
                id={id}
                className="control"
                dir="ltr"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                aria-describedby={d}
                data-testid="worker-pin"
              />
            )}
          </FormField>
          <FormField label={strings.workers.pinRepeat}>
            {(id) => (
              <input
                id={id}
                className="control"
                dir="ltr"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={pin2}
                onChange={(e) => setPin2(e.target.value)}
                data-testid="worker-pin2"
              />
            )}
          </FormField>
        </>
      )}
      {worker && (
        <label className={styles.check}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {active ? strings.common.active : strings.common.inactive}
        </label>
      )}
      {(error || saver.error) && <BigAlert tone="danger" word={error ?? saver.error ?? ''} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.common.save}
          type="submit"
          variant="ok"
          loading={saver.busy}
          testId="save-worker"
        />
        <ActionButton label={strings.common.cancel} variant="ghost" onClick={onDone} />
      </div>
    </form>
  );
}
