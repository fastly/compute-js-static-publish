export type Merge<T, U> = {
  [TKey in keyof T]: TKey extends keyof U ? (T[TKey] | U[TKey]) : T[TKey];
};

export type Unmerge<T, U> = Required<{
  [TKey in keyof T]: TKey extends keyof U ? (Exclude<T[TKey], U[TKey]>) : T[TKey];
}>;
