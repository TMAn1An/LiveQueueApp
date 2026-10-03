import { useAdmins } from '../hooks/useStaff';

/** ADR-069: the Organization Head and Managers may look at one Admin's
 * workspace at a time. */
export function AdminFilter({
  value,
  onChange,
  id = 'admin-filter',
}: {
  value: string;
  onChange: (adminId: string) => void;
  id?: string;
}) {
  const { admins } = useAdmins();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Filter by Admin
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500"
      >
        <option value="">All workspaces</option>
        {admins.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}&apos;s workspace
          </option>
        ))}
      </select>
    </>
  );
}
