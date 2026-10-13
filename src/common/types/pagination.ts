import { SortOrder } from '../constants';

export interface PageQuery {
  /** 1-based. */
  page: number;
  limit: number;
  sortOrder: SortOrder;
}

export interface Page<T> {
  items: T[];
  total: number;
}
