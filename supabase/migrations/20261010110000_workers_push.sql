-- Workers can now be created and edited from a manager's device (phase 5). The permission matrix already limits
-- `manageUsers` to managers, and ingest_row also refuses a manager worker on a device below the manager level.
update sync_tables set push_action = 'manageUsers' where table_name = 'workers';
