export interface PageQuery {
  /** 1-based. */
  page: number;
  limit: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}
