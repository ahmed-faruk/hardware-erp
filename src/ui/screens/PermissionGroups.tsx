import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { savePermissionGroup } from '@/db/commands/save-master';
import type { PermissionGroup } from '@/db/types';
import {
  ACTIONS,
  PERMISSION_SECTIONS,
  defaultsFor,
  type Access,
  type Action,
  type Permissions,
  type Role,
} from '@/domain/permissions';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';
import { useSaver } from './useSaver';

const t = strings.permissions;
const ACCESS: Access[] = ['yes', 'pin', 'no'];

/** Every action explicit: what a group stores, so that "missing" never has to be guessed. */
const complete = (p: Permissions): Permissions =>
  Object.fromEntries(ACTIONS.map((a) => [a, p[a] ?? 'no'])) as Permissions;

/** Manager: the list of permission groups, each one a full yes / pin / no map for every screen and button. */
export function PermissionGroups() {
  const { db } = useServices();
  const [editing, setEditing] = useState<PermissionGroup | 'new' | null>(null);
  const data = useLiveQuery(async () => {
    const groups = (await db.permissionGroups.toArray()).filter((g) => !g.deletedAt);
    const workers = (await db.workers.toArray()).filter((w) => !w.deletedAt);
    return { groups, workers };
  }, [db]);
  const columns: Column<PermissionGroup>[] = [
    { key: 'name', header: t.groupName, cell: (g) => g.name },
    {
      key: 'members',
      header: t.members,
      numeric: true,
      cell: (g) => String(data?.workers.filter((w) => w.groupId === g.id).length ?? 0),
    },
  ];
  return (
    <section>
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <ActionButton label={t.newGroup} icon={Plus} onClick={() => setEditing('new')} testId="new-group" />
        </div>
      </div>
      <p className={styles.muted}>{t.hint}</p>
      {!data ? (
        <Skeleton />
      ) : data.groups.length === 0 ? (
        <EmptyState icon={ShieldCheck} word={t.noGroups} />
      ) : (
        <DataTable
          label={t.groups}
          rows={[...data.groups].sort((a, b) => a.name.localeCompare(b.name, 'ar'))}
          columns={columns}
          rowKey={(g) => g.id}
          onRowClick={setEditing}
        />
      )}
      <Dialog
        title={editing === 'new' ? t.newGroup : t.editGroup}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <GroupForm
            group={editing === 'new' ? null : editing}
            groups={data?.groups ?? []}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </section>
  );
}

function GroupForm({
  group,
  groups,
  onDone,
}: {
  group: PermissionGroup | null;
  groups: PermissionGroup[];
  onDone: () => void;
}) {
  const { context } = useSession();
  const [name, setName] = useState(group?.name ?? '');
  const [perms, setPerms] = useState<Permissions>(() => complete(group?.permissions ?? {}));
  const [error, setError] = useState<string | null>(null);
  const saver = useSaver(onDone);
  const copyFrom = (value: string): void => {
    if (value.startsWith('role:')) setPerms(complete(defaultsFor(value.slice(5) as Role)));
    else {
      const g = groups.find((x) => x.id === value);
      if (g) setPerms(complete(g.permissions));
    }
  };
  return (
    <form
      className={styles.form}
      style={{ gridTemplateColumns: '1fr' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError(strings.common.required);
        setError(null);
        if (!context) return;
        void saver.run(() =>
          savePermissionGroup(context, {
            id: group?.id,
            baseVersion: group?.version,
            fields: { name, permissions: perms },
          }),
        );
      }}
    >
      <FormField label={t.groupName}>
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="group-name"
          />
        )}
      </FormField>
      <FormField label={t.copyFrom}>
        {(id) => (
          <select
            id={id}
            className="control"
            value=""
            onChange={(e) => copyFrom(e.target.value)}
            data-testid="group-copy"
          >
            <option value="">{t.copyPick}</option>
            {(['cashier', 'storekeeper', 'manager'] as const).map((r) => (
              <option key={r} value={`role:${r}`}>
                {t.copyRole}: {strings.roles[r]}
              </option>
            ))}
            {groups
              .filter((g) => g.id !== group?.id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        )}
      </FormField>
      {PERMISSION_SECTIONS.map((s) => (
        <div key={s.key} className={styles.section} data-testid={`perm-section-${s.key}`}>
          <h2>{t.sections[s.key as keyof typeof t.sections]}</h2>
          {s.actions.map((a: Action) => (
            <div key={a} className={styles.permRow}>
              <span>{t.actions[a]}</span>
              <SegmentedControl
                label={t.actions[a]}
                options={ACCESS.map((k) => ({ key: k, label: t[k] }))}
                value={perms[a] ?? 'no'}
                onChange={(v) => setPerms((p) => ({ ...p, [a]: v }))}
                testIdPrefix={`perm-${a}-`}
              />
            </div>
          ))}
        </div>
      ))}
      {(error || saver.error) && <BigAlert tone="danger" word={error ?? saver.error ?? ''} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.common.save}
          type="submit"
          variant="ok"
          loading={saver.busy}
          testId="save-group"
        />
        {group && (
          <ActionButton
            label={t.delete}
            variant="danger"
            onClick={() =>
              context &&
              void saver.run(() =>
                savePermissionGroup(context, {
                  id: group.id,
                  baseVersion: group.version,
                  fields: { deletedAt: new Date().toISOString() },
                }),
              )
            }
            testId="delete-group"
          />
        )}
        <ActionButton label={strings.common.cancel} variant="ghost" onClick={onDone} />
      </div>
    </form>
  );
}
