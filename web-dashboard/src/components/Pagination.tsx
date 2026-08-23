import { Button } from './Button';
import type { Pagination as PaginationInfo } from '../types/api';

export function Pagination({
  pagination,
  onPageChange,
}: {
  pagination: PaginationInfo | undefined;
  onPageChange: (page: number) => void;
}) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>
        Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
