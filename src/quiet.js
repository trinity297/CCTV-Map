/**
 * Node prints "SQLite is an experimental feature" the first time node:sqlite is
 * loaded. The API this app uses (DatabaseSync) is settled, and the warning only
 * alarms people who are just trying to run the tool, so it is filtered out here.
 * Every other warning is passed through to Node's own handlers untouched.
 *
 * Imported for its side effect *before* node:sqlite - see src/db.js.
 */
const isSqliteExperimental = (warning) =>
  warning?.name === 'ExperimentalWarning' && String(warning.message).includes('SQLite');

const existing = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (isSqliteExperimental(warning)) return;
  for (const listener of existing) listener.call(process, warning);
});
