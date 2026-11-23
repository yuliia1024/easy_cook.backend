/** What `npm run search:index` does. */
export interface IndexArgs {
  /** Rebuild and re-embed every recipe. */
  force: boolean;
  /** Print the state of every index and change nothing. */
  status: boolean;
  /** After the sync, drop the vectors of models no longer in `EMBEDDING_PROVIDERS`. */
  prune: boolean;
}

const FLAGS: Record<string, keyof IndexArgs> = {
  '--force': 'force',
  '--status': 'status',
  '--prune': 'prune',
};

export function parseIndexArgs(argv: string[]): IndexArgs {
  const args: IndexArgs = { force: false, status: false, prune: false };
  for (const arg of argv) {
    const flag = FLAGS[arg];
    if (!flag) {
      throw new Error(`Unknown argument ${arg}; use ${Object.keys(FLAGS).join(', ')}`);
    }
    args[flag] = true;
  }
  if (args.status && (args.force || args.prune)) {
    throw new Error('--status changes nothing: it goes alone');
  }
  return args;
}
