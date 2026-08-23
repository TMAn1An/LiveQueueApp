export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  pagination?: Pagination;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
